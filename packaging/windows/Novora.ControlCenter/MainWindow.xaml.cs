using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using Microsoft.Win32;

namespace Novora.ControlCenter;

public partial class MainWindow : Window
{
    private readonly CancellationTokenSource lifetime = new();
    private readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromSeconds(10) };
    private readonly DispatcherTimer searchTimer = new() { Interval = TimeSpan.FromMilliseconds(200) };
    private RuntimeSnapshot? snapshot;
    private bool refreshing, inspecting, readingLogs, busy;
    private string currentPage = "overview";
    private int wizardStep;
    private string[] logLines = Array.Empty<string>();
    private string logFile = "";
    private string? initialPassword;
    private readonly DispatcherTimer progressTimer = new() { Interval = TimeSpan.FromMilliseconds(500) };
    private readonly Stopwatch operationWatch = new();
    private readonly Stopwatch itemWatch = new();
    private IProgress<OperationProgress> operationProgress = null!;
    private Func<Task>? retryAction;
    private string retryMessage = "", retryItem = "", activeItem = "";
    private bool progressFailed;
    private int itemTimeout;
    private bool initializedAndReady;
    private bool inspectionPassed;
    private IReadOnlyList<InspectionItem> inspectionItems = Array.Empty<InspectionItem>();
    private LogRow[] logRows = Array.Empty<LogRow>();
    private string? logNotice;

    private void ReportProgress(OperationProgress progress)
    {
        if (!busy) return;
        if (activeItem != progress.Item) { activeItem = progress.Item; itemWatch.Restart(); }
        itemTimeout = progress.TimeoutSeconds;
        OperationItem.Text = progress.Item;
        OperationBar.IsIndeterminate = progress.Total is null or <= 0;
        if (progress.Total is > 0) { OperationBar.Maximum = progress.Total.Value; OperationBar.Value = Math.Clamp(progress.Current, 0, progress.Total.Value); }
        UpdateProgressClock();
    }

    private void UpdateProgressClock()
    {
        if (busy) OperationDetail.Text = $"本项已等待 {(int)itemWatch.Elapsed.TotalSeconds} 秒 · 总计 {(int)operationWatch.Elapsed.TotalSeconds} 秒" +
            (itemTimeout > 0 ? $" · 本项检查上限 {itemTimeout} 秒" : " · 请等待操作结束");
        else if (inspecting) OperationDetail.Text = "正在读取 Windows 实际状态 · 检查上限 20 秒";
    }

    private void UpdatePassiveProgress()
    {
        var waiting = !busy && (refreshing || inspecting);
        PassiveWait.Visibility = waiting ? Visibility.Visible : Visibility.Hidden;
        PassiveBar.IsIndeterminate = waiting;
        if (waiting)
            PassiveItem.Text = inspecting ? "检查服务、防火墙、入口 · 上限 20 秒" : currentPage == "logs" ? "读取日志与运行状态" : currentPage == "backups" ? "读取备份列表与运行状态" : "检查服务与 HTTP · 上限 3 秒";
        if (!busy && !progressFailed) OperationPanel.Visibility = Visibility.Collapsed;
    }

    private static string StateTone(string state) => state switch
    {
        "运行中" => "Success",
        "未安装" or "正在启动" => "Warning",
        "已停止" => "Danger",
        _ => "TextSecondary"
    };

    private void Tone(TextBlock target, string tone) => target.Foreground = (Brush)FindResource(tone);
    private void ToneDots(System.Windows.Shapes.Shape target, string tone) => target.Fill = (Brush)FindResource(tone);

    // 首帧之前用骨架条占位，避免四张卡同时显示"—"看起来像数据丢了；只收起一次，不做来回闪烁。
    private bool overviewLoaded;
    private void HideOverviewSkeleton()
    {
        if (overviewLoaded) return;
        overviewLoaded = true;
        ServiceSkeleton.Visibility = DatabaseSkeleton.Visibility = HealthSkeleton.Visibility = LanSkeleton.Visibility = ProcessSkeleton.Visibility = Visibility.Collapsed;
    }

    // 窄窗口只收窄导航，指标卡保持两列：MinWidth 1000 下内容列仍够放两张卡，不必改成单列拉长页面。
    private void UpdateResponsive()
    {
        SidePanel.Width = ActualWidth < 1120 ? 168 : 208;
    }

    /// <summary>1366×768 这类教学机放不下 820 高的默认窗口，按工作区收敛而不是改小 MinHeight。</summary>
    private void ClampToWorkArea()
    {
        var area = SystemParameters.WorkArea;
        Width = Math.Min(Width, Math.Max(MinWidth, area.Width - 60));
        Height = Math.Min(Height, Math.Max(MinHeight, area.Height - 60));
    }

    public MainWindow(string page = "overview")
    {
        Theme.Apply(Theme.SystemPrefersDark());
        Theme.ApplyTextRendering(this);
        InitializeComponent();
        operationProgress = new Progress<OperationProgress>(ReportProgress);
        UpdatesPanel.CanStartOperation = () => !busy && !inspecting && !refreshing;
        UpdatesPanel.CanInstallUpdateAsync = async () =>
        {
            if (!await Task.Run(Runtime.InitializationCompleted, lifetime.Token)) return false;
            var state = await Runtime.ReadAsync(lifetime.Token);
            initializedAndReady = state.Healthy && state.Service.State == "运行中" && state.Database.State == "运行中" &&
                await Task.Run(Runtime.InitializationCompleted, lifetime.Token);
            return initializedAndReady;
        };
        progressTimer.Tick += (_, _) => UpdateProgressClock();
        Loaded += async (_, _) => { ClampToWorkArea(); UpdateResponsive(); await LoadSettingsAsync(); ShowPage(page); await RefreshAsync(); timer.Start(); };
        SizeChanged += (_, _) => UpdateResponsive();
        timer.Tick += async (_, _) => { if (IsVisible && WindowState != WindowState.Minimized && !busy && !UpdatesView.OperationRunning) { Theme.Apply(Theme.SystemPrefersDark()); await RefreshAsync(); } };
        searchTimer.Tick += (_, _) => { searchTimer.Stop(); FilterLogs(); };
        StateChanged += async (_, _) => { if (WindowState == WindowState.Minimized) timer.Stop(); else { timer.Start(); await RefreshAsync(); } };
        Closing += (_, e) => { if (busy) { e.Cancel = true; MessageText.Text = "操作正在执行，请等待结果后关闭。"; } };
        Closed += (_, _) => { timer.Stop(); searchTimer.Stop(); progressTimer.Stop(); lifetime.Cancel(); };
    }

    public void ShowPage(string page)
    {
        if (busy || UpdatesView.OperationRunning) { MessageText.Text = "当前操作正在执行，请等待结束。"; Activate(); return; }
        currentPage = page is "setup" or "settings" or "updates" or "logs" or "backups" ? page : "overview";
        OverviewPage.Visibility = currentPage == "overview" ? Visibility.Visible : Visibility.Collapsed;
        SettingsPage.Visibility = currentPage is "settings" or "setup" ? Visibility.Visible : Visibility.Collapsed;
        UpdatesPage.Visibility = currentPage == "updates" ? Visibility.Visible : Visibility.Collapsed;
        LogsPage.Visibility = currentPage == "logs" ? Visibility.Visible : Visibility.Collapsed;
        BackupsPage.Visibility = currentPage == "backups" ? Visibility.Visible : Visibility.Collapsed;
        Mark.SetSelected(NavOverview, currentPage == "overview");
        Mark.SetSelected(NavSetup, currentPage == "setup");
        Mark.SetSelected(NavSettings, currentPage == "settings");
        Mark.SetSelected(NavUpdates, currentPage == "updates");
        Mark.SetSelected(NavLogs, currentPage == "logs");
        Mark.SetSelected(NavBackups, currentPage == "backups");
        if (currentPage is "settings" or "setup")
        {
            wizardStep = 0;
            RenderWizard();
            _ = InspectWindowsAsync(true);
        }
        if (SystemParameters.ClientAreaAnimation)
            PageHost.BeginAnimation(OpacityProperty, new DoubleAnimation(0.85, 1, TimeSpan.FromMilliseconds(120)));
        Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
        if (IsLoaded) _ = RefreshAsync();
    }

    private async Task RefreshAsync()
    {
        if (UpdatesView.OperationRunning) { MessageText.Text = "软件更新正在执行，请等待更新结束。"; return; }
        if (refreshing || busy || lifetime.IsCancellationRequested) return;
        refreshing = true;
        UpdatePassiveProgress();
        try
        {
            var pageTask = currentPage == "logs" ? RefreshLogsAsync() : currentPage == "backups" ? RefreshBackupsAsync() : Task.CompletedTask;
            var next = await Runtime.ReadAsync(lifetime.Token);
            await pageTask;
            if (lifetime.IsCancellationRequested || busy || UpdatesView.OperationRunning) return;
            snapshot = next;
            var installed = next.Service.State != "未安装" && next.Database.State != "未安装";
            ServiceState.Text = next.Service.State == "未安装" ? "待初始化注册" : next.Service.State;
            ToneDots(ServiceDot, StateTone(next.Service.State));
            DatabaseState.Text = next.Database.State == "未安装" ? "待初始化注册" : next.Database.State;
            ToneDots(DatabaseDot, StateTone(next.Database.State));
            HealthState.Text = next.Healthy ? "正常" : "未连接";
            ToneDots(HealthDot, next.Healthy ? "Success" : "Danger");
            LanState.Text = next.LanAddresses.Count > 0 ? "已检测到地址" : "未检测到";
            ToneDots(LanDot, next.LanAddresses.Count > 0 ? "Success" : "Warning");
            PortText.Text = $"端口 {next.Port}";
            LanText.Text = string.Join("\n", next.LanAddresses.Select(x => $"http://{x}:{next.Port}"));
            CheckedText.Text = $"上次检查：{next.CheckedAt:HH:mm:ss} · {next.HealthDetail}";
            var ready = next.Healthy && next.Service.State == "运行中" && next.Database.State == "运行中";
            // 读不到版本时也要像一条状态，而不是"v未知"这种占位。
            VersionText.Text = next.Version == "未知" ? (ready ? "版本待读取" : "服务未连接 · 版本待读取") : $"v{next.Version} · {(ready ? "运行中" : "未连接")}";
            RailStatusText.Text = $"上次检查 {next.CheckedAt:HH:mm:ss} · 端口 {next.Port}";
            // 系统标题栏接管了版本/状态展示的位置，任务栏和 Alt+Tab 里也能直接看出是哪台机器什么状态。
            var windowTitle = (next.Version == "未知" ? "Novora 控制中心" : $"Novora 控制中心 · v{next.Version}") + (ready ? " · 运行中" : " · 未连接");
            if (Title != windowTitle) Title = windowTitle;
            initializedAndReady = ready && await Task.Run(Runtime.InitializationCompleted, lifetime.Token);
            UpdatesPanel.SetInstallationReady(initializedAndReady);
            OpenWebButton.IsEnabled = ready;
            BannerStartButton.IsEnabled = StartButton.IsEnabled = installed && !ready;
            RestartButton.IsEnabled = installed;
            StopButton.IsEnabled = ready;
            var starting = next.Service.State == "正在启动" || next.Database.State == "正在启动";
            var stopped = next.Service.State == "已停止" || next.Database.State == "已停止";
            var overallTone = ready ? "Success" : !installed || starting ? "Warning" : "Danger";
            OverallState.Text = ready ? "运行正常" : !installed ? "待初始化" : starting ? "正在启动" : stopped ? "服务已停止" : "健康异常";
            Tone(OverallState, overallTone);
            ToneDots(NavOverviewDot, overallTone);
            OverallBanner.Background = (Brush)FindResource(overallTone + "Soft");
            OverallBanner.BorderBrush = (Brush)FindResource(overallTone);
            ProcessText.Text = await Task.Run(() => $"Novora PID {next.Service.ProcessId} · 运行 {Runtime.ProcessUptime(next.Service.ProcessId)}   |   PostgreSQL PID {next.Database.ProcessId} · 运行 {Runtime.ProcessUptime(next.Database.ProcessId)}", lifetime.Token);
            ToneDots(VersionDot, ready ? "Success" : "Warning");
            HideOverviewSkeleton();
            DiagnosisText.Text = ready ? "本机服务和数据库健康。其他电脑访问异常时，请检查 Windows 设置中的防火墙规则及网络连接。" :
                next.Service.State == "未安装" || next.Database.State == "未安装" ? "服务尚未注册，请前往初始化；初始化会准备数据库、注册并启动服务。" :
                next.Database.State != "运行中" ? "数据库尚未运行，可尝试启动服务；首次使用请完成初始化，失败时查看初始化日志。" :
                next.Service.State != "运行中" ? "业务服务尚未运行，可尝试启动服务。" : "服务已启动但 HTTP 未就绪，请查看业务日志和端口设置。";
        }
        catch (OperationCanceledException) { }
        catch (Exception exception) { MessageText.Text = $"状态检查失败：{exception.Message}"; }
        finally { refreshing = false; UpdatePassiveProgress(); }
    }

    private async Task ExecuteAsync(Func<Task> action, string message, string item = "执行操作", bool allowRetry = true)
    {
        if (UpdatesView.OperationRunning) { MessageText.Text = "软件更新正在执行，请等待更新结束。"; return; }
        if (busy || inspecting) { MessageText.Text = "请等待当前操作或系统检查完成。"; return; }
        busy = true;
        UpdatePassiveProgress();
        progressFailed = false;
        retryAction = allowRetry ? action : null;
        retryMessage = message; retryItem = item;
        activeItem = item; itemTimeout = 0;
        operationWatch.Restart(); itemWatch.Restart(); progressTimer.Start();
        PageHost.IsEnabled = false;
        OpenWebButton.IsEnabled = false;
        FailureActions.Visibility = Visibility.Collapsed;
        OperationPanel.Visibility = Visibility.Visible;
        OperationItem.Text = item;
        OperationBar.IsIndeterminate = true;
        MessageText.Text = "正在执行操作…";
        UpdateProgressClock();
        try
        {
            await action();
            MessageText.Text = message;
            OperationBar.IsIndeterminate = false; OperationBar.Maximum = 1; OperationBar.Value = 1;
        }
        catch (Exception exception)
        {
            progressFailed = true;
            var error = exception is System.ComponentModel.Win32Exception { NativeErrorCode: 1223 } ? "已取消管理员授权，尚未执行此次操作。" : exception.Message;
            MessageText.Text = "操作未完成：" + (error.Length > 220 ? error[..220] + "… 请查看详细结果或日志。" : error);
            OperationItem.Text = "操作未完成 · " + activeItem;
            OperationDetail.Text = error.Length > 360 ? error[..360] + "… 请查看页面结果或日志。" : error;
            OperationBar.IsIndeterminate = false; OperationBar.Value = 0;
            RetryOperation.Visibility = retryAction is null ? Visibility.Collapsed : Visibility.Visible;
            FailureActions.Visibility = Visibility.Visible;
        }
        finally
        {
            progressTimer.Stop(); busy = false; PageHost.IsEnabled = true;
            await RefreshAsync();
            UpdatePassiveProgress();
        }
    }

    private async void RetryOperation_Click(object sender, RoutedEventArgs e)
    {
        if (retryAction is { } action) await ExecuteAsync(action, retryMessage, retryItem);
    }

    private async void ExportDiagnosis_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new SaveFileDialog { FileName = $"novora-diagnosis-{DateTime.Now:yyyyMMdd-HHmmss}.txt", Filter = "文本文件|*.txt" };
        if (dialog.ShowDialog(this) != true) return;
        var summary = $"Novora {VersionText.Text} · {CheckedText.Text}\n服务：{ServiceState.Text} · 数据库：{DatabaseState.Text}\n{PortText.Text}\n{DiagnosisText.Text}\n当前操作：{activeItem}\n安装目录：{Runtime.Root}\n日志目录：{Path.Combine(Runtime.Data, "logs")}\n此摘要不包含配置文件、凭据、学校业务数据或完整日志。";
        try { await File.WriteAllTextAsync(dialog.FileName, summary, lifetime.Token); MessageText.Text = "诊断摘要已导出。"; }
        catch (Exception exception) { MessageText.Text = "导出失败：" + exception.Message; }
    }

    private async Task LoadSettingsAsync()
    {
        try
        {
            PortInput.Text = (await Task.Run(Runtime.ReadPort, lifetime.Token)).ToString();
            var path = Path.Combine(Runtime.Data, "config", "windows-initialized.json");
            if (!File.Exists(path)) return;
            using var document = JsonDocument.Parse(await File.ReadAllTextAsync(path, lifetime.Token));
            var s = document.RootElement.GetProperty("settings");
            if (s.TryGetProperty("backupKeep", out var keep) && keep.TryGetInt32(out var count) && count is >= 1 and <= 365) KeepInput.Text = count.ToString();
        }
        catch (OperationCanceledException) { }
        catch (Exception exception) { MessageText.Text = $"读取备份策略失败：{exception.Message}"; }
    }

    private async Task InspectWindowsAsync(bool readBack)
    {
        if (UpdatesView.OperationRunning) { MessageText.Text = "软件更新正在执行，请等待更新结束。"; return; }
        if (inspecting || busy || lifetime.IsCancellationRequested) return;
        inspecting = true;
        inspectionPassed = false;
        inspectionItems = Array.Empty<InspectionItem>();
        InspectionItems.ItemsSource = null;
        InspectionCount.Text = "";
        InspectionProgress.Visibility = Visibility.Visible;
        InspectButton.IsEnabled = false;
        OptionsPanel.IsEnabled = false;
        WizardNext.IsEnabled = false; ApplyButton.IsEnabled = false;
        UpdatePassiveProgress();
        if (readBack)
            foreach (var option in new[] { ServiceAuto, DatabaseAuto, AutoRestart, LanAccess, TrayStartup, DesktopShortcut, StartMenuShortcut, DailyBackup }) option.IsChecked = null;
        InspectionSummary.Text = "正在检查运行文件、服务与系统配置，最多等待 20 秒…";
        try
        {
            var state = await WindowsManagement.InspectAsync(lifetime.Token);
            if (lifetime.IsCancellationRequested) return;
            var inspection = InspectionResult.From(state);
            inspectionItems = inspection.Items.OrderBy(Severity).ToList();
            ApplyInspectionFilter();
            InspectionSummary.Text = inspection.Summary;
            inspectionPassed = inspection.CanContinue;
            if (readBack)
            {
                ServiceAuto.IsChecked = StartMode(state, "service");
                DatabaseAuto.IsChecked = StartMode(state, "database");
                if (currentPage == "setup" && !state.GetProperty("initialized").GetBoolean())
                {
                    ServiceAuto.IsChecked = true;
                    DatabaseAuto.IsChecked = true;
                }
                AutoRestart.IsChecked = state.GetProperty("service").GetProperty("recovery").GetString() switch { "已启用" => true, "未启用" => false, _ => null };
                if (currentPage == "setup" && state.GetProperty("service").GetProperty("state").GetString() == "未安装")
                    AutoRestart.IsChecked = true;
                LanAccess.IsChecked = state.GetProperty("lanAccess").ValueKind switch { JsonValueKind.True => true, JsonValueKind.False => false, _ => null };
                TrayStartup.IsChecked = state.GetProperty("trayStartup").GetBoolean();
                DesktopShortcut.IsChecked = state.GetProperty("desktopShortcut").GetBoolean();
                StartMenuShortcut.IsChecked = state.GetProperty("startMenuShortcut").GetBoolean();
                DailyBackup.IsChecked = state.GetProperty("backupDaily").ValueKind switch { JsonValueKind.True => true, JsonValueKind.False => false, _ => null };
                PortInput.Text = (await Task.Run(Runtime.ReadPort, lifetime.Token)).ToString();
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception exception) { InspectionSummary.Text = "检查未完成：" + exception.Message + " 请点击重新检查系统。"; }
        finally { inspecting = false; InspectionProgress.Visibility = Visibility.Collapsed; InspectButton.IsEnabled = true; OptionsPanel.IsEnabled = true; WizardNext.IsEnabled = inspectionPassed; ApplyButton.IsEnabled = inspectionPassed; UpdatePassiveProgress(); }
    }

    private static bool? StartMode(JsonElement state, string service) => state.GetProperty(service).GetProperty("startMode").GetString() switch { "Auto" => true, "Manual" or "Disabled" => false, _ => null };

    /// <summary>0 阻断、1 需处理、2 待准备、3 通过；列表按严重程度排序，通过项排在最后。</summary>
    private static int Severity(InspectionItem item) => item.Blocking ? 0 : item.Status switch
    {
        "正常" => 3,
        "需要处理" or "未能读取" => 1,
        _ => 2
    };

    private void ApplyInspectionFilter()
    {
        var hidePassed = OnlyProblems?.IsChecked == true;
        var shown = hidePassed ? inspectionItems.Where(x => Severity(x) != 3).ToList() : inspectionItems;
        if (InspectionItems is not null) InspectionItems.ItemsSource = shown;
        if (InspectionCount is null || inspectionItems.Count == 0) return;
        var needs = inspectionItems.Count(x => Severity(x) <= 1);
        var pending = inspectionItems.Count(x => Severity(x) == 2);
        var passed = inspectionItems.Count - needs - pending;
        InspectionCount.Text = $"共 {inspectionItems.Count} 项 · 需处理 {needs} · 待准备 {pending} · 通过 {passed}" + (hidePassed ? $" · 只显示 {shown.Count} 项" : "");
    }

    private void OnlyProblems_Changed(object sender, RoutedEventArgs e) { if (IsLoaded) ApplyInspectionFilter(); }

    private WindowsOptions? ReadOptions()
    {
        if (UpdatesView.OperationRunning) { MessageText.Text = "软件更新正在执行，请等待更新结束。"; return null; }
        if (inspecting) { MessageText.Text = "请等待系统检查完成。"; return null; }
        if (!inspectionPassed) { MessageText.Text = "请先完成环境检查并处理阻断项目。"; return null; }
        if (!int.TryParse(PortInput.Text, out var port) || port is < 1 or > 65535)
        { MessageText.Text = "端口必须为 1–65535。"; PortInput.Focus(); return null; }
        if (!int.TryParse(KeepInput.Text, out var keep) || keep is < 1 or > 365)
        { MessageText.Text = "备份保留份数必须为 1–365。"; KeepInput.Focus(); return null; }
        if (new[] { ServiceAuto, DatabaseAuto, AutoRestart, LanAccess, TrayStartup, DesktopShortcut, StartMenuShortcut, DailyBackup }.Any(x => x.IsChecked is null))
        { MessageText.Text = "部分系统状态无法读取，请明确勾选或取消对应选项后应用。"; return null; }
        return new(ServiceAuto.IsChecked == true, DatabaseAuto.IsChecked == true, AutoRestart.IsChecked == true,
            LanAccess.IsChecked == true, port, TrayStartup.IsChecked == true, DesktopShortcut.IsChecked == true,
            StartMenuShortcut.IsChecked == true, DailyBackup.IsChecked == true, keep);
    }

    private void RenderWizard()
    {
        var wizard = currentPage == "setup";
        SettingsTitle.Text = wizard ? $"Windows 初始化 · 第 {wizardStep + 1} 步" : "Windows 设置";
        ApplyButton.Content = wizard ? "开始初始化并验证服务" : "应用设置并验证服务";
        WizardProgress.Visibility = wizard ? Visibility.Visible : Visibility.Collapsed;
        if (wizard) RenderStepBar();
        InspectionPanel.Visibility = !wizard || wizardStep == 0 ? Visibility.Visible : Visibility.Collapsed;
        OptionsPanel.Visibility = !wizard || wizardStep == 1 ? Visibility.Visible : Visibility.Collapsed;
        ReviewText.Visibility = wizard && wizardStep == 2 ? Visibility.Visible : Visibility.Collapsed;
        ApplyResult.Visibility = (!wizard && !string.IsNullOrEmpty(ApplyResult.Text)) || (wizard && wizardStep == 3) ? Visibility.Visible : Visibility.Collapsed;
        WizardBack.Visibility = wizard && wizardStep > 0 ? Visibility.Visible : Visibility.Collapsed;
        WizardNext.Visibility = wizard && wizardStep < 2 ? Visibility.Visible : Visibility.Collapsed;
        ApplyButton.Visibility = !wizard || wizardStep == 2 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void RenderStepBar()
    {
        var tracks = new[] { Step1, Step2, Step3, Step4 };
        var badges = new[] { Step1Badge, Step2Badge, Step3Badge, Step4Badge };
        var numbers = new[] { Step1Number, Step2Number, Step3Number, Step4Number };
        var checks = new[] { Step1Check, Step2Check, Step3Check, Step4Check };
        for (var index = 0; index < tracks.Length; index++)
        {
            var phase = index < wizardStep ? "done" : index == wizardStep ? "now" : "todo";
            Mark.SetPhase(tracks[index], phase);
            Mark.SetPhase(badges[index], phase);
            numbers[index].Visibility = phase == "done" ? Visibility.Collapsed : Visibility.Visible;
            checks[index].Visibility = phase == "done" ? Visibility.Visible : Visibility.Collapsed;
        }
    }

    private void WizardBack_Click(object sender, RoutedEventArgs e) { wizardStep = Math.Max(0, wizardStep - 1); RenderWizard(); }
    private void WizardNext_Click(object sender, RoutedEventArgs e)
    {
        if (inspecting) { MessageText.Text = "请等待系统检查完成。"; return; }
        if (!inspectionPassed) { MessageText.Text = "请先完成环境检查并处理阻断项目。"; return; }
        if (wizardStep == 1)
        {
            var o = ReadOptions();
            if (o is null) return;
            static string On(bool value) => value ? "启用" : "关闭";
            ReviewText.Text = $"请确认以下设置：\n\n服务自动启动：{On(o.serviceAutoStart)}\n数据库自动启动：{On(o.databaseAutoStart)}\n异常自动重启：{On(o.serviceAutoRestart)}\n本地子网访问：{On(o.lanAccess)}\n服务端口：{o.port}\n登录托盘：{On(o.trayStartup)}\n桌面快捷方式：{On(o.desktopShortcut)}\n开始菜单：{On(o.startMenuShortcut)}\n每日 02:00 备份：{On(o.backupDaily)} · 普通备份保留 {o.backupKeep} 份\n\n初始化会准备数据库配置、注册 Windows 服务、检查连接并准备业务库，然后启动并验证业务服务。修改端口会重启正在运行的业务服务。点击应用后请求管理员权限。";
        }
        wizardStep = Math.Min(2, wizardStep + 1);
        RenderWizard();
    }

    private async void Apply_Click(object sender, RoutedEventArgs e)
    {
        var options = ReadOptions();
        if (options is null) return;
        initialPassword = null;
        CredentialButton.Visibility = Visibility.Collapsed;
        await ExecuteAsync(async () =>
        {
            try
            {
                var result = await WindowsManagement.ApplyAsync(options, lifetime.Token, operationProgress);
                ApplyResult.Text = (result.Success ? "设置已完成\n\n" : "部分设置需要处理\n\n") + result.Detail;
                if (!result.Success) throw new InvalidOperationException(result.Detail);
                initialPassword = result.InitialPassword;
                CredentialButton.Visibility = string.IsNullOrEmpty(initialPassword) ? Visibility.Collapsed : Visibility.Visible;
            }
            catch (Exception exception) { ApplyResult.Text = "设置未完成：\n" + exception.Message; throw; }
            finally { if (currentPage == "setup") wizardStep = 3; RenderWizard(); }
        }, "设置操作已结束，请查看逐项结果。", "等待管理员授权并应用 Windows 设置");
    }

    private void Credential_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrEmpty(initialPassword)) return;
        var panel = new StackPanel { Margin = new Thickness(24) };
        panel.Children.Add(new TextBlock { Text = "初始账号：admin\n首次登录后请修改密码并保存恢复密钥。", TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 16) });
        var masked = new PasswordBox { Password = initialPassword, IsEnabled = false, Height = 34 };
        var revealed = new TextBox { Text = initialPassword, IsReadOnly = true, Height = 34, Visibility = Visibility.Collapsed };
        System.Windows.Automation.AutomationProperties.SetName(revealed, "初始密码");
        panel.Children.Add(masked); panel.Children.Add(revealed);
        var reveal = new CheckBox { Content = "显示密码", Margin = new Thickness(0, 12, 0, 12) };
        reveal.Checked += (_, _) => { masked.Visibility = Visibility.Collapsed; revealed.Visibility = Visibility.Visible; };
        reveal.Unchecked += (_, _) => { masked.Visibility = Visibility.Visible; revealed.Visibility = Visibility.Collapsed; };
        panel.Children.Add(reveal);
        var dialog = new Window { Owner = this, Title = "Novora · 初始登录凭据", Content = panel, Width = 460, SizeToContent = SizeToContent.Height, ResizeMode = ResizeMode.NoResize, WindowStartupLocation = WindowStartupLocation.CenterOwner };
        Theme.ApplyTextRendering(dialog);
        var close = new Button { Content = "关闭", IsCancel = true, HorizontalAlignment = HorizontalAlignment.Right };
        close.Click += (_, _) => dialog.Close(); panel.Children.Add(close);
        dialog.Closed += (_, _) => { masked.Clear(); revealed.Clear(); };
        dialog.ShowDialog();
    }

    private async Task RefreshLogsAsync()
    {
        if (readingLogs || PauseLogs.IsChecked == true || lifetime.IsCancellationRequested) return;
        var file = (LogSource.SelectedItem as ComboBoxItem)?.Tag as string ?? "novora-service.log";
        readingLogs = true;
        try
        {
            var lines = await Task.Run(() => Runtime.ReadLogTail(Path.Combine(Runtime.Data, "logs", file)), lifetime.Token);
            if (((LogSource.SelectedItem as ComboBoxItem)?.Tag as string ?? "novora-service.log") != file) return;
            logFile = file; logLines = lines; logNotice = null; FilterLogs();
        }
        catch (OperationCanceledException) { }
        catch (FileNotFoundException) { logFile = file; logLines = Array.Empty<string>(); logNotice = "尚未生成此日志。"; FilterLogs(); }
        catch (DirectoryNotFoundException) { logLines = Array.Empty<string>(); logNotice = "尚未生成日志目录。"; FilterLogs(); }
        catch (Exception exception) { MessageText.Text = $"读取日志失败：{exception.Message}"; }
        finally { readingLogs = false; }
    }

    private void FilterLogs()
    {
        if (LogLines is null) return;
        var query = LogSearch.Text.Trim();
        var level = LogLevel.SelectedIndex;
        logRows = logLines
            .Where(line => (query.Length == 0 || line.Contains(query, StringComparison.OrdinalIgnoreCase)) &&
                (level == 0 || (level == 1 ? IsErrorLine(line) : IsWarningLine(line))))
            .Select(line => new LogRow(line, IsErrorLine(line) ? "error" : IsWarningLine(line) ? "warn" : "info"))
            .ToArray();
        LogLines.ItemsSource = logRows;
        LogHits.Text = $"命中 {logRows.Length} / {logLines.Length} 行 · {logFile}";
        if (logRows.Length == 0) { LogEmpty.Text = logNotice ?? "当前筛选条件下没有匹配的日志行。"; LogEmpty.Visibility = Visibility.Visible; }
        else { LogEmpty.Visibility = Visibility.Collapsed; if (AutoScroll.IsChecked == true) LogLines.ScrollIntoView(logRows[^1]); }
    }

    private static bool IsErrorLine(string line) => line.Contains("error", StringComparison.OrdinalIgnoreCase) ||
        line.Contains("fail", StringComparison.OrdinalIgnoreCase) || line.Contains("错误") || line.Contains("失败");

    private static bool IsWarningLine(string line) => line.Contains("warn", StringComparison.OrdinalIgnoreCase) || line.Contains("警告");

    private async void LogOptions_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (!IsLoaded) return;
        if (sender == LogSource) { logLines = Array.Empty<string>(); logFile = ""; logNotice = null; FilterLogs(); await RefreshLogsAsync(); }
        else FilterLogs();
    }
    private void LogSearch_Changed(object sender, TextChangedEventArgs e) { if (IsLoaded) { searchTimer.Stop(); searchTimer.Start(); } }
    private async void ExportLog_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new SaveFileDialog { FileName = $"novora-log-{DateTime.Now:yyyyMMdd-HHmmss}.txt", Filter = "文本文件|*.txt" };
        if (dialog.ShowDialog(this) != true) return;
        var text = $"Novora 日志快照 · {logFile} · {DateTimeOffset.Now:O}{Environment.NewLine}" + string.Join(Environment.NewLine, logRows.Select(x => x.Text));
        await ExecuteAsync(() => File.WriteAllTextAsync(dialog.FileName, text, lifetime.Token), "日志快照已导出。", "导出当前日志筛选结果");
    }

    private async Task RefreshBackupsAsync()
    {
        var selected = (BackupList.SelectedItem as BackupFile)?.Name;
        var files = await Task.Run(Runtime.ReadBackups, lifetime.Token);
        BackupList.ItemsSource = files;
        BackupEmpty.Visibility = files.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        if (selected is not null) BackupList.SelectedItem = BackupList.Items.Cast<BackupFile>().FirstOrDefault(x => x.Name == selected);
        UpdateBackupActions();
    }

    private void UpdateBackupActions()
    {
        if (ValidateBackupButton is null) return;
        var hasSelection = BackupList.SelectedItem is BackupFile;
        ValidateBackupButton.IsEnabled = hasSelection;
        RestoreBackupButton.IsEnabled = hasSelection;
        DeleteBackupButton.IsEnabled = hasSelection;
    }

    private void BackupList_SelectionChanged(object sender, SelectionChangedEventArgs e) => UpdateBackupActions();
    private async void Backup_Click(object sender, RoutedEventArgs e)
    {
        var keep = int.TryParse(KeepInput.Text, out var value) && value is >= 1 and <= 365 ? value : 14;
        await ExecuteAsync(() => RunBackupOperationAsync("backup.ps1", keep: keep), "备份已完成。", "等待管理员授权并创建备份");
    }
    private async Task SelectedBackupAsync(string script, string message, string? confirmation = null)
    {
        if (BackupList.SelectedItem is not BackupFile file) { MessageText.Text = "请先选择一份备份。"; return; }
        if (confirmation is not null && MessageBox.Show($"{confirmation}\n\n{file.Name}", "Novora", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No) != MessageBoxResult.Yes) return;
        await ExecuteAsync(() => RunBackupOperationAsync(script, file.Name), message, "等待管理员授权 · " + (script == "restore-backup.ps1" ? "恢复所选备份" : script == "remove-backup.ps1" ? "删除所选备份" : "校验所选备份"), allowRetry: script == "validate-backup.ps1");
    }
    private async Task RunBackupOperationAsync(string script, string? name = null, int keep = 14)
    {
        BackupResult.Text = "正在执行…";
        try { BackupResult.Text = await WindowsManagement.RunBackupScriptAsync(script, name, keep, operationProgress, lifetime.Token); }
        catch (Exception exception) { BackupResult.Text = "操作未完成：\n" + exception.Message; throw; }
    }
    private async void ValidateBackup_Click(object sender, RoutedEventArgs e) => await SelectedBackupAsync("validate-backup.ps1", "归档结构校验通过；完整可恢复性需通过实际恢复验证。");
    private async void DeleteBackup_Click(object sender, RoutedEventArgs e) => await SelectedBackupAsync("remove-backup.ps1", "所选备份已删除。", "确定永久删除所选备份吗？");
    private async void RestoreBackup_Click(object sender, RoutedEventArgs e) => await SelectedBackupAsync("restore-backup.ps1", "数据库已恢复；恢复前保护备份已保留。请检查服务健康状态。", "恢复会覆盖当前业务数据并暂停服务。系统先创建保护备份；恢复出错时数据库事务回滚。确定继续吗？");

    private async void Inspect_Click(object sender, RoutedEventArgs e) => await InspectWindowsAsync(true);
    private void Nav_Click(object sender, RoutedEventArgs e) => ShowPage((string)((Button)sender).Tag);
    private void OpenLogs_Click(object sender, RoutedEventArgs e) => ShowPage("logs");
    private void OpenWeb_Click(object sender, RoutedEventArgs e) => OpenTarget($"http://127.0.0.1:{snapshot?.Port ?? 3000}");
    private async void Refresh_Click(object sender, RoutedEventArgs e) { await RefreshAsync(); if (currentPage is "settings" or "setup") await InspectWindowsAsync(false); }
    private Task RunServiceOperationAsync(string action)
    {
        if (snapshot?.Service.State == "未安装" || snapshot?.Database.State == "未安装")
            throw new InvalidOperationException("服务尚未注册，请先前往初始化完成配置与注册。");
        return Runtime.RunElevatedAsync(
            $"& {Runtime.Quote(Path.Combine(Runtime.Root, "service-operation.ps1"))} -Action {Runtime.Quote(action)} -InstallRoot {Runtime.Quote(Runtime.Root)} -Port {snapshot?.Port ?? Runtime.ReadPort()}", lifetime.Token, operationProgress);
    }
    private async void Start_Click(object sender, RoutedEventArgs e) => await ExecuteAsync(() => RunServiceOperationAsync("start"), "服务与 HTTP 健康检查通过。", "等待管理员授权并启动服务");
    private async void Restart_Click(object sender, RoutedEventArgs e) => await ExecuteAsync(() => RunServiceOperationAsync("restart"), "服务重启与 HTTP 健康检查通过。", "等待管理员授权并重启服务");
    private async void Stop_Click(object sender, RoutedEventArgs e)
    {
        if (MessageBox.Show("确定停止 Novora 服务吗？局域网访问将暂时不可用。", "Novora", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No) == MessageBoxResult.Yes)
            await ExecuteAsync(() => RunServiceOperationAsync("stop"), "服务已停止。", "等待管理员授权并停止服务");
    }
    private void Copy(string text) { try { Clipboard.SetText(text); MessageText.Text = "已复制。"; } catch (Exception exception) { MessageText.Text = $"复制失败：{exception.Message}"; } }
    private void CopyLocal_Click(object sender, RoutedEventArgs e) => Copy($"http://127.0.0.1:{snapshot?.Port ?? 3000}");
    private void CopyLan_Click(object sender, RoutedEventArgs e) { if (snapshot is null || snapshot.LanAddresses.Count == 0) { MessageText.Text = "尚未检测到局域网地址。"; return; } Copy(LanText.Text); }
    private void CopyDiagnosis_Click(object sender, RoutedEventArgs e) => Copy($"Novora {VersionText.Text}\n{CheckedText.Text}\n服务：{ServiceState.Text} · 数据库：{DatabaseState.Text}\n{ProcessText.Text}\n{PortText.Text}\n{LanText.Text}\n{DiagnosisText.Text}\n安装目录：{Runtime.Root}\n数据目录：{Runtime.Data}");
    private void LogsFolder_Click(object sender, RoutedEventArgs e) => OpenTarget(Path.Combine(Runtime.Data, "logs"));
    private void BackupsFolder_Click(object sender, RoutedEventArgs e) => OpenTarget(Path.Combine(Runtime.Data, "backups"));
    private void OpenTarget(string target)
    {
        try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); return; }
        catch (Exception exception)
        {
            // A URL can fail here when this process runs in a token with no default-browser
            // association (elevated or non-interactive); retry with a known browser. Folder
            // opens keep the original message rather than launching a browser.
            if (target.StartsWith("http", StringComparison.OrdinalIgnoreCase) && TryOpenWithKnownBrowser(target)) return;
            MessageText.Text = $"无法打开：{exception.Message}";
        }
    }

    private static bool TryOpenWithKnownBrowser(string url)
    {
        foreach (var exe in new[] { "msedge.exe", "chrome.exe" })
        {
            var path = ReadAppPath(exe);
            if (path is null || !File.Exists(path)) continue;
            try { Process.Start(new ProcessStartInfo(path, $"\"{url}\"") { UseShellExecute = false }); return true; }
            catch { /* try the next browser */ }
        }
        return false;
    }

    private static string? ReadAppPath(string exe)
    {
        foreach (var root in new[] { Registry.CurrentUser, Registry.LocalMachine })
        {
            try
            {
                using var key = root.OpenSubKey($@"Software\Microsoft\Windows\CurrentVersion\App Paths\{exe}");
                if (key?.GetValue(null) is string value)
                {
                    value = value.Trim().Trim('"');
                    if (value.Length > 0) return value;
                }
            }
            catch (Exception exception) when (exception is System.Security.SecurityException or ArgumentException) { }
        }
        return null;
    }
}
