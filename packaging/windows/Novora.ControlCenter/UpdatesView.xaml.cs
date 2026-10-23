using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Win32;
using Novora.Update;

namespace Novora.ControlCenter;

public partial class UpdatesView : UserControl
{
    public static bool OperationRunning { get; private set; }
    public Func<bool>? CanStartOperation { get; set; }
    public Func<Task<bool>>? CanInstallUpdateAsync { get; set; }
    private bool installationReady;
    private readonly string cache = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Novora", "updates");
    private string? downloaded;
    private VerifiedRelease? release;
    private UpdateTrust? trust;
    // LoadState reads the running version from this installation (the build-stamped payload
    // package.json, or active-version.json after an application update). Empty until read:
    // a version this process cannot prove must never enable an install action.
    private string version = "";
    private CancellationTokenSource? cancellation;
    private readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromSeconds(1) };
    private readonly Stopwatch elapsed = new();
    private string item = "";
    private bool installing;
    private bool observing;
    private string? checkAttemptId;
    private bool loadingSettings;
    private UpdateTelemetry? telemetry;
    private string? setupDownload;

    private void ShowResult(string title, string hint, string tone = "info")
    {
        ResultTitle.Text = title;
        ResultHint.Text = hint;
        // Semantic colours must come from the palette. Hard-coded light hex values left a pale
        // card inside the dark theme, and a live theme switch could never repaint them.
        var (background, foreground) = tone switch
        {
            "success" => ("SuccessSoft", "Success"),
            "warning" => ("WarningSoft", "Warning"),
            "error" => ("DangerSoft", "Danger"),
            _ => ("AccentSoft", "Accent")
        };
        ResultCard.SetResourceReference(Border.BackgroundProperty, background);
        ResultTitle.SetResourceReference(System.Windows.Documents.TextElement.ForegroundProperty, foreground);
    }

    private void RefreshTelemetryStatus() => TelemetryStatus.Text = trust is null
        ? "更新通道启用后可设置匿名统计。"
        : TelemetryOptIn.IsChecked == true ? "已开启；可随时取消勾选，关闭时会清除待发送统计。" : "已关闭，不发送更新统计。";

    private static string SourceLabel(string? source) => source switch
    { "author" => "作者端推荐", "github" => "GitHub 兜底", "offline" => "离线导入", _ => "来源未记录" };

    private static string PhaseLabel(string phase) => phase switch
    {
        "succeeded" => "更新成功", "failed" => "更新失败", "rolled-back" => "已回退",
        "repair-required" => "需要修复", "preparing" => "准备中", "backing-up" => "备份中",
        "stopping" => "暂停服务", "migrating" => "迁移中", "switching" => "切换版本",
        "verifying" => "验证中", "rolling-back" => "回退中", _ => "未知状态（" + phase + "）"
    };

    private void ShowInstallerResult(UpdateState? state)
    {
        if (state is null) { ShowResult("更新程序已退出", "请查看更新记录确认结果。", "warning"); return; }
        ShowResult(PhaseLabel(state.Phase), state.Detail, state.Phase == "succeeded" ? "success" : "warning");
    }

    public UpdatesView()
    {
        InitializeComponent();
        Loaded += (_, _) => { LoadState(); timer.Start(); };
        Unloaded += (_, _) => { timer.Stop(); if (!installing) cancellation?.Cancel(); };
        timer.Tick += (_, _) =>
        {
            if (observing && !UpdaterRunning())
            {
                observing = false; OperationRunning = false; Actions.IsEnabled = true;
                UpdateBar.Visibility = Visibility.Collapsed; LoadState();
                ShowInstallerResult(ReadState());
                ProgressText.Text = "";
            }
            if (installing) ReadInstallerProgress();
            if (observing) ReadInstallerProgress();
            if (OperationRunning) ProgressText.Text = $"{item} · 已等待 {(int)elapsed.Elapsed.TotalSeconds} 秒";
        };
        RefreshInstallAvailability();
    }

    public void SetInstallationReady(bool ready)
    {
        installationReady = ready;
        RefreshInstallAvailability();
    }

    private void RefreshInstallAvailability()
    {
        var ready = installationReady && CanInstallUpdateAsync is not null;
        InstallReadinessHint.Visibility = ready || trust is null ? Visibility.Collapsed : Visibility.Visible;
        DownloadButton.Visibility = release is not null && downloaded is null ? Visibility.Visible : Visibility.Collapsed;
        InstallButton.Visibility = downloaded is not null ? Visibility.Visible : Visibility.Collapsed;
        ImportButton.IsEnabled = trust is not null && !OperationRunning;
        ClearCacheButton.IsEnabled = !OperationRunning;
        CheckButton.ToolTip = trust is null ? "需先安装带可信公钥的完整安装包。" : "优先检查作者端推荐；不可达时检查 GitHub。";
        ImportButton.ToolTip = trust is null ? "需先配置信任公钥才能验证离线包。" : "选择 .nvu 文件，校验后手动安装。";
        InstallButton.ToolTip = release is not null && version.Length > 0 && !UpdatePackage.SupportsApplicationUpdate(release.Manifest, version)
            ? "当前环境不满足应用包兼容要求，请使用完整安装包。"
            : ready ? "确认后备份数据库并安装。" : InstallReadinessHint.Text;
        InstallButton.IsEnabled = ready && trust is not null && downloaded is not null && release is not null && version.Length > 0 &&
            UpdatePackage.SupportsApplicationUpdate(release.Manifest, version);
    }

    private async Task<bool> RequireInstallationReadyAsync()
    {
        var ready = false;
        try { if (CanInstallUpdateAsync is not null) ready = await CanInstallUpdateAsync(); }
        catch { /* Missing or failed live checks must not allow installation. */ }
        SetInstallationReady(ready);
        if (ready) return true;
        ShowResult("暂不满足安装条件", InstallReadinessHint.Text, "warning");
        ProgressText.Text = "";
        return false;
    }
    private void LoadState()
    {
        try
        {
            version = UpdateEngine.ReadActive(Runtime.Root).Version;
            CurrentVersion.Text = version;
            var trustPath = Path.Combine(Runtime.Root, "updater", "trust.json");
            trust = File.Exists(trustPath) ? JsonSerializer.Deserialize<UpdateTrust>(File.ReadAllText(trustPath), UpdatePackage.Json) : null;
            if (trust is null || string.IsNullOrWhiteSpace(trust.PublicKeyPem)) throw new InvalidDataException("更新通道尚未启用：发布方需要配置可信签名公钥。可使用完整安装包升级。");
            UpdatePackage.ValidateTrust(trust);
            telemetry?.Dispose(); telemetry = new UpdateTelemetry(trust);
            loadingSettings = true;
            TelemetryOptIn.IsChecked = telemetry.ReadSettings() is not null;
            TelemetryOptIn.IsEnabled = true;
            loadingSettings = false;
            ChannelStatus.Text = "稳定通道 · 作者端优先，不可达时 GitHub 兜底 · 可信签名公钥已配置";
            ChannelLabel.Text = "稳定通道已启用";
            ChannelBadge.SetResourceReference(Border.BackgroundProperty, "SuccessSoft");
            ChannelLabel.SetResourceReference(System.Windows.Documents.TextElement.ForegroundProperty, "Success");
            TrustHint.Visibility = ImportHint.Visibility = Visibility.Collapsed;
            CheckButton.IsEnabled = ImportButton.IsEnabled = true;
        }
        catch (Exception error) when (error is IOException or JsonException or InvalidDataException or UnauthorizedAccessException)
        {
            ChannelStatus.Text = error.Message;
            ChannelLabel.Text = "更新通道未启用";
            ChannelBadge.SetResourceReference(Border.BackgroundProperty, "WarningSoft");
            ChannelLabel.SetResourceReference(System.Windows.Documents.TextElement.ForegroundProperty, "Warning");
            TrustHint.Visibility = ImportHint.Visibility = Visibility.Visible;
            ShowResult("需要配置信任公钥", "请联系发布方提供带信任配置的完整安装包。配置完成前，在线检查和离线导入均不可用。", "warning");
            ReleaseNotes.Visibility = Visibility.Collapsed;
            trust = null; release = null; downloaded = null;
            telemetry?.Dispose(); telemetry = null;
            CheckButton.IsEnabled = ImportButton.IsEnabled = InstallButton.IsEnabled = DownloadButton.IsEnabled = SetupButton.IsEnabled = TelemetryOptIn.IsEnabled = false;
        }
        var state = ReadState();
        RefreshTelemetryStatus();
        RecoverButton.Visibility = state is not null && UpdateEngine.NeedsRecovery(state.Phase) ? Visibility.Visible : Visibility.Collapsed;
        if (!OperationRunning && RecoverButton.Visibility == Visibility.Visible)
            ShowResult("上次更新需要恢复", state!.Detail + " 请使用“恢复未完成更新”入口。", "warning");
        if (!installing && UpdaterRunning())
        {
            observing = OperationRunning = true; Actions.IsEnabled = TelemetryOptIn.IsEnabled = false;
            ShowResult("更新程序正在运行", "正在读取安装进度。安装期间请勿关闭计算机。");
            UpdateBar.Visibility = Visibility.Visible; UpdateBar.IsIndeterminate = true; elapsed.Restart();
        }
        RefreshInstallAvailability();
    }
    private static bool UpdaterRunning()
    {
        var processes = Process.GetProcessesByName("NovoraUpdater");
        try { return processes.Any(x => !x.HasExited); }
        finally { foreach (var process in processes) process.Dispose(); }
    }
    private UpdateState? ReadState()
    {
        try
        {
            var path = Path.Combine(Runtime.Root, "updater", "state.json");
            return File.Exists(path) ? JsonSerializer.Deserialize<UpdateState>(File.ReadAllText(path), UpdatePackage.Json) : null;
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException) { return null; }
    }
    private IProgress<UpdateProgress> Progress() => new Progress<UpdateProgress>(value =>
    {
        item = value.Item;
        UpdateBar.IsIndeterminate = value.Total is not > 0;
        if (value.Total is > 0) UpdateBar.Value = Math.Clamp(value.Current * 100d / value.Total.Value, 0, 100);
        ProgressText.Text = item;
    });
    private async Task ExecuteAsync(Func<CancellationToken, Task> action, bool install = false)
    {
        if (OperationRunning) return;
        if (CanStartOperation?.Invoke() == false) { ProgressText.Text = "请等待当前系统操作完成后更新。"; return; }
        OperationRunning = true; installing = install;
        cancellation = new CancellationTokenSource();
        elapsed.Restart(); item = install ? "等待管理员授权" : "正在准备";
        Actions.IsEnabled = ImportButton.IsEnabled = ClearCacheButton.IsEnabled = TelemetryOptIn.IsEnabled = false;
        ShowResult(install ? "正在准备安装" : "正在处理", install ? "正在检查安装条件；确认安装后会先备份数据库。" : "请稍候，可使用下方按钮取消当前操作。");
        UpdateBar.Visibility = Visibility.Visible; UpdateBar.IsIndeterminate = true;
        CancelButton.Visibility = install ? Visibility.Collapsed : Visibility.Visible;
        try { await action(cancellation.Token); }
        catch (OperationCanceledException) { ShowResult("操作已取消", "可重新检查更新或下载；当前服务保持运行。", "warning"); ProgressText.Text = ""; }
        catch (Exception error) { ShowResult("更新未完成", error.Message + " 请重试；安装异常可查看更新记录，未完成更新请使用恢复入口。", "error"); ProgressText.Text = ""; }
        finally
        {
            var outcome = ProgressText.Text;
            item = "正在记录更新结果";
            await FlushTelemetryAsync(cancellation.Token);
            OperationRunning = installing = false; elapsed.Stop(); cancellation.Dispose(); cancellation = null;
            TelemetryOptIn.IsEnabled = trust is not null;
            Actions.IsEnabled = true; CancelButton.Visibility = UpdateBar.Visibility = Visibility.Collapsed;
            LoadState();
            RefreshInstallAvailability();
            if (HistoryPanel.Visibility == Visibility.Visible) LoadHistory();
            ProgressText.Text = outcome;
        }
    }
    private async void Check_Click(object sender, RoutedEventArgs e) => await ExecuteAsync(async token =>
    {
        if (trust is null) return;
        downloaded = null; release = null; InstallButton.IsEnabled = DownloadButton.IsEnabled = false;
        SetupButton.Visibility = ReleaseNotes.Visibility = Visibility.Collapsed; SetupButton.IsEnabled = false;
        ReleaseNotes.Text = "";
        RefreshInstallAvailability();
        ShowResult("正在检查更新", "优先获取作者端推荐，并在本机验证发布签名。");
        var attempt = Guid.NewGuid().ToString();
        checkAttemptId = attempt;
        if (TelemetryOptIn.IsChecked == true)
            await ReportEventAsync(new(Guid.NewGuid().ToString(), GetInstallationId(), attempt, "check", version));
        item = "检查作者端 Windows 稳定版推荐";
        using var client = new UpdateClient();
        try
        {
            var result = await client.CheckAsync(trust, version, token);
            if (!result.Available || result.Release is null)
            {
                ShowResult(result.Source == "github" ? "GitHub 未发现较新版本" : "当前没有推荐更新",
                    result.Source == "github" ? "作者端暂不可达，已检查 GitHub 稳定发布。可稍后重新检查。" : "作者端没有推荐高于当前版本的可用更新，可继续使用当前版本。", "success");
                ProgressText.Text = "检查完成 · " + DateTime.Now.ToString("HH:mm:ss"); return;
            }
            release = result.Release;
            if (TelemetryOptIn.IsChecked == true)
                await ReportEventAsync(new(Guid.NewGuid().ToString(), GetInstallationId(), attempt, "available", version, release.Manifest.Version, Source: release.Source));
            ReleaseNotes.Visibility = Visibility.Visible;
            ShowResult("发现新版本 " + release.Manifest.Version, $"{SourceLabel(release.Source)} · {release.Manifest.Size / 1024d / 1024:0.##} MB · 发布签名已验证", "success");
            ReleaseNotes.Text = $"新版本 {release.Manifest.Version} · {release.Manifest.Size / 1024d / 1024:0.##} MB · {(release.Source == "github" ? "GitHub 兜底（作者端暂不可达）" : "作者端推荐")}\n{release.Manifest.Notes}";
            if (release.Manifest.Setup is { } setup)
            {
                SetupButton.Visibility = Visibility.Visible; SetupButton.IsEnabled = true;
                if (!UpdatePackage.SupportsApplicationUpdate(release.Manifest, version))
                    ReleaseNotes.Text += "\n当前环境不满足应用包兼容条件，请下载完整安装包。";
            }
            else if (!UpdatePackage.SupportsApplicationUpdate(release.Manifest, version))
                ReleaseNotes.Text += "\n当前环境不满足应用包兼容条件，请联系发布方提供完整安装包。";
            DownloadButton.IsEnabled = UpdatePackage.SupportsApplicationUpdate(release.Manifest, version);
            RefreshInstallAvailability();
            if (!DownloadButton.IsEnabled) ShowResult("需要完整安装包", "当前环境不满足应用包兼容条件，请下载完整安装包或联系发布方。", "warning");
            ProgressText.Text = DownloadButton.IsEnabled ? "发现已验签更新，可下载后择时安装。" : "请按提示使用完整安装包或联系管理员。";
        }
        catch (Exception error)
        {
            if (error is not OperationCanceledException)
            {
                if (TelemetryOptIn.IsChecked == true)
                    await ReportEventAsync(new(Guid.NewGuid().ToString(), GetInstallationId(), attempt, "failed", version, null, "CHECK_FAILED"));
            }
            throw;
        }
    });
    private async void Download_Click(object sender, RoutedEventArgs e) => await ExecuteAsync(async token =>
    {
        if (release is null) return;
        var directory = Path.Combine(cache, release.Manifest.Version);
        using var client = new UpdateClient();
        await client.DownloadAsync(release, directory, Progress(), token);
        downloaded = directory; RefreshInstallAvailability();
        ShowResult("下载与校验完成", "签名和 SHA256 校验通过。请在方便暂停服务时确认安装。", "success");
        ProgressText.Text = InstallButton.IsEnabled ? "下载和校验完成，业务服务继续运行。" : "下载和校验完成；请先完成初始化并确认服务健康，再安装更新。";
        if (TelemetryOptIn.IsChecked == true)
            await ReportEventAsync(new(Guid.NewGuid().ToString(), GetInstallationId(), checkAttemptId ?? Guid.NewGuid().ToString(), "verified", version, release.Manifest.Version, Source: release.Source));
    });

    private async void Setup_Click(object sender, RoutedEventArgs e)
    {
        if (release?.Manifest.Setup is not { } setup || OperationRunning) return;
        await ExecuteAsync(async token =>
        {
            var filename = $"Novora-Setup-{release.Manifest.Version}.exe";
            setupDownload = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Novora", "updates", filename);
            Directory.CreateDirectory(Path.GetDirectoryName(setupDownload)!);
            using var client = new UpdateClient();
            await client.DownloadSetupAsync(setup, setupDownload, Progress(), token);
            ShowResult("完整安装包已校验", "文件所在位置已打开，请择时手动运行安装程序。", "success");
            ProgressText.Text = File.Exists(Path.Combine(Runtime.Root, "active-version.json"))
                ? "完整安装包下载且校验通过。此安装已切换应用版本，请使用支持活动版本迁移的完整升级流程，避免旧安装器保留旧指针。"
                : "完整安装包下载且校验通过，可择时运行安装程序。";
            Process.Start(new ProcessStartInfo("explorer.exe") { UseShellExecute = false, ArgumentList = { "/select,", setupDownload } });
        });
    }

    private void Telemetry_Changed(object sender, RoutedEventArgs e)
    {
        if (!IsLoaded) return;
        if (loadingSettings) return;
        try
        {
            if (telemetry is null && trust is not null) telemetry = new UpdateTelemetry(trust);
            telemetry?.Configure(TelemetryOptIn.IsChecked == true);
            if (!TelemetryOptIn.IsChecked.GetValueOrDefault()) { telemetry?.Dispose(); telemetry = null; }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            loadingSettings = true;
            TelemetryOptIn.IsChecked = telemetry?.ReadSettings() is not null;
            loadingSettings = false;
            TelemetryStatus.Text = "无法保存匿名统计偏好，已显示实际保存状态；请重试。更新不受影响。";
            return;
        }
        RefreshTelemetryStatus();
    }

    private string GetInstallationId() => telemetry?.ReadSettings()?.InstallationId ?? "00000000-0000-4000-8000-000000000000";

    private Task ReportEventAsync(UpdateEvent updateEvent)
    {
        if (TelemetryOptIn.IsChecked == true)
            telemetry?.Queue(updateEvent.Stage, updateEvent.CurrentVersion, updateEvent.TargetVersion, updateEvent.ErrorCode, updateEvent.AttemptId, updateEvent.Source);
        return Task.CompletedTask;
    }

    private async Task FlushTelemetryAsync(CancellationToken token) { try { if (telemetry is not null) await telemetry.FlushAsync(token); } catch (Exception error) when (error is HttpRequestException or TaskCanceledException or IOException) { } }
    private async void Import_Click(object sender, RoutedEventArgs e)
    {
        if (OperationRunning || trust is null) return;
        var dialog = new OpenFileDialog { Filter = "Novora 离线更新包|*.nvu", CheckFileExists = true };
        if (dialog.ShowDialog(Window.GetWindow(this)) != true) return;
        await ExecuteAsync(async token =>
        {
            downloaded = null; release = null; InstallButton.IsEnabled = DownloadButton.IsEnabled = SetupButton.IsEnabled = false;
            SetupButton.Visibility = ReleaseNotes.Visibility = Visibility.Collapsed;
            RefreshInstallAvailability();
            ShowResult("正在校验离线包", "验证发布签名和文件完整性，导入不会自动安装。");
            checkAttemptId = Guid.NewGuid().ToString();
            var directory = Path.Combine(cache, "import-" + Guid.NewGuid().ToString("N"));
            var progress = Progress();
            release = await Task.Run(() => UpdateClient.ImportAsync(dialog.FileName, directory, trust, version, progress, token), token);
            downloaded = directory; RefreshInstallAvailability();
            ReleaseNotes.Visibility = Visibility.Visible;
            ShowResult("离线包校验通过", $"版本 {release.Manifest.Version} · {release.Manifest.Size / 1024d / 1024:0.##} MB · 离线导入 · 请手动确认安装", "success");
            if (!UpdatePackage.SupportsApplicationUpdate(release.Manifest, version))
                ShowResult("离线包需要完整安装包升级", "签名已验证，但当前环境不满足应用包兼容要求。", "warning");
            ReleaseNotes.Text = $"离线更新 {release.Manifest.Version}\n{release.Manifest.Notes}";
            ProgressText.Text = !UpdatePackage.SupportsApplicationUpdate(release.Manifest, version)
                ? "离线包已验签，但当前环境不满足应用包兼容要求，请使用完整安装包。"
                : InstallButton.IsEnabled ? "离线包签名和完整性校验通过，可安装。" : "离线包已校验；请先完成初始化并确认服务健康，再安装更新。";
            await ReportEventAsync(new(Guid.NewGuid().ToString(), GetInstallationId(), checkAttemptId, "verified", version, release.Manifest.Version, Source: "offline"));
        });
    }
    private async void Install_Click(object sender, RoutedEventArgs e)
    {
        if (downloaded is null || release is null || OperationRunning) return;
        await ExecuteAsync(async _ =>
        {
            item = "检查初始化状态与服务健康";
            if (!await RequireInstallationReadyAsync()) return;
            if (MessageBox.Show(Window.GetWindow(this), $"安装 {release.Manifest.Version}？\n\n将先创建数据库保护备份，再暂停业务服务。迁移仅允许与上一版兼容的变更。安装阶段不能强制取消。", "Novora 软件更新", MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No) != MessageBoxResult.Yes)
            { ShowResult("已取消安装", "已校验的更新包仍保留，可稍后安装。", "warning"); ProgressText.Text = ""; return; }
            if (!await RequireInstallationReadyAsync()) return;
            var installArguments = TelemetryOptIn.IsChecked == true
                ? new[] { "--install", downloaded, "--installation-id", GetInstallationId(), "--attempt-id", checkAttemptId ?? Guid.NewGuid().ToString(), "--source", release.Source }
                : new[] { "--install", downloaded };
            item = "等待管理员授权";
            await RunUpdaterAsync(installArguments);
        }, install: true);
    }
    private async void Recover_Click(object sender, RoutedEventArgs e)
    {
        if (MessageBox.Show(Window.GetWindow(this), "恢复更新前的应用版本并验证服务？不会自动覆盖数据库。", "Novora 更新恢复", MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No) != MessageBoxResult.Yes) return;
        var recoverArguments = TelemetryOptIn.IsChecked == true
            ? new[] { "--recover", "--installation-id", GetInstallationId() } : new[] { "--recover" };
        await ExecuteAsync(_ => RunUpdaterAsync(recoverArguments), install: true);
    }
    private async Task RunUpdaterAsync(params string[] arguments)
    {
        var path = Path.Combine(Runtime.Root, "updater", "NovoraUpdater.exe");
        if (!File.Exists(path)) throw new FileNotFoundException("缺少更新程序，请使用完整安装包。", path);
        var start = new ProcessStartInfo(path) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("无法启动更新程序。");
        // Do not kill an elevated update if the control center closes.
        await process.WaitForExitAsync();
        ReadInstallerProgress();
        var state = ReadState();
        if (process.ExitCode != 0)
        {
            var resultPath = Path.Combine(Runtime.Root, "updater", "result.json");
            if (File.Exists(resultPath))
            {
                using var result = JsonDocument.Parse(File.ReadAllText(resultPath));
                throw new InvalidOperationException(result.RootElement.GetProperty("error").GetString());
            }
            throw new InvalidOperationException(state?.Detail ?? "更新失败，请查看更新记录。");
        }
        ShowInstallerResult(state);
        ProgressText.Text = "";
        downloaded = null;
        release = null;
        SetupButton.Visibility = Visibility.Collapsed;
        SetupButton.IsEnabled = false;
        ReleaseNotes.Visibility = Visibility.Collapsed;
    }
    private void ReadInstallerProgress()
    {
        try
        {
            var path = Path.Combine(Runtime.Root, "updater", "progress.json");
            if (File.Exists(path))
            {
                var value = JsonSerializer.Deserialize<UpdateProgress>(File.ReadAllText(path), UpdatePackage.Json);
                if (value is not null) { item = value.Item; UpdateBar.IsIndeterminate = value.Total is not > 0; if (value.Total is > 0) UpdateBar.Value = value.Current * 100d / value.Total.Value; }
            }
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException) { }
    }
    private void Cancel_Click(object sender, RoutedEventArgs e) { if (!installing) cancellation?.Cancel(); }
    private void History_Click(object sender, RoutedEventArgs e)
    {
        HistoryPanel.Visibility = HistoryPanel.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible;
        if (HistoryPanel.Visibility == Visibility.Visible) LoadHistory();
    }

    private void LoadHistory()
    {
        HistoryItems.ItemsSource = null;
        HistoryText.Visibility = Visibility.Visible;
        try
        {
            var path = Path.Combine(Runtime.Root, "updater", "history.json");
            var entries = File.Exists(path)
                ? JsonSerializer.Deserialize<UpdateState[]>(UpdatePackage.ReadBounded(path, 256 * 1024), UpdatePackage.Json) ?? [] : [];
            if (entries.Length == 0 && ReadState() is { } latest) entries = [latest];
            HistoryItems.ItemsSource = entries.OrderByDescending(x => x.Time).Take(50).Select(x => new HistoryEntry(
                $"{x.Previous.Version} → {x.TargetVersion} · {PhaseLabel(x.Phase)}",
                $"{x.Time.ToLocalTime():yyyy-MM-dd HH:mm:ss} · {SourceLabel(x.Source)}", x.Detail)).ToArray();
            HistoryText.Text = "暂无更新记录。完成一次安装后，会在这里显示版本、来源和结果。";
            HistoryText.Visibility = entries.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException)
        { HistoryText.Text = "无法读取更新记录，请重试：" + error.Message; }
    }

    private async void ClearCache_Click(object sender, RoutedEventArgs e)
    {
        if (OperationRunning) return;
        if (MessageBox.Show(Window.GetWindow(this), "清理已下载的更新包和完整安装包？之后需要重新下载或导入。不会删除更新记录、已安装应用或数据库备份。", "清理下载缓存", MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No) != MessageBoxResult.Yes) return;
        await ExecuteAsync(token => Task.Run(() =>
        {
            var expected = Path.GetFullPath(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Novora", "updates"));
            if (Path.GetFullPath(cache) != expected) throw new InvalidDataException("缓存清理路径无效。");
            if (Directory.Exists(expected)) Directory.Delete(expected, true);
            Dispatcher.Invoke(() =>
            {
                downloaded = setupDownload = null;
                RefreshInstallAvailability();
                ShowResult("下载缓存已清理", "需要时可重新下载或导入更新包。更新记录和数据库备份已保留。", "success");
                ProgressText.Text = "";
            });
        }, token));
    }

    public sealed record HistoryEntry(string Heading, string Metadata, string Detail);
}
