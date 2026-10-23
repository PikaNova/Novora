using System.Diagnostics;
using System.Drawing;
using System.Net;
using System.Net.NetworkInformation;
using System.Text;
using System.Text.Json;
using Novora.Ui;
using Novora.Tray;

internal static class Program
{
    // Clipboard and other OLE operations require an STA thread; top-level
    // statements compile to an entry point without [STAThread].
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        using var instanceMutex = new Mutex(true, @"Local\NovoraTray.SingleInstance", out var isFirstInstance);
        if (!isFirstInstance) return;
        Application.Run(new TrayApplicationContext());
    }
}

sealed class TrayApplicationContext : ApplicationContext
{
    private readonly NotifyIcon icon;
    private readonly TrayMenuItem stateItem;
    private readonly TrayMenuItem serviceStart;
    private readonly TrayMenuItem serviceRestart;
    private readonly TrayMenuItem serviceStop;
    private TrayServiceState serviceState;
    private string? operationText;
    private int statusGeneration;
    private readonly System.Windows.Forms.Timer timer;
    private readonly HttpClient http = new(new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(3) };
    private readonly string root = ResolveTrayRoot();
    private readonly string dataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Novora");
    private string InstallRoot => ResolveInstallRoot(root);
    private readonly string packageVersion;
    private int port = 3000;
    private bool healthy;
    private bool refreshing;
    private bool exiting;
    private bool operating;
    private string version = "Novora";

    public TrayApplicationContext()
    {
        packageVersion = ReadPackageVersion();
        stateItem = new TrayMenuItem("正在读取状态…", kind: TrayItemKind.Status) { Enabled = false };
        serviceStart = new TrayMenuItem("启动服务", "\uE768", action: () => RunServiceCommand("start", "正在启动服务…"));
        serviceRestart = new TrayMenuItem("重启服务", "\uE777", action: () => RunServiceCommand("restart", "正在重启服务…"));
        serviceStop = new TrayMenuItem("停止服务", "\uE71A", TrayItemKind.Danger, () => StopService());
        var iconPath = Path.Combine(root, "favicon.ico");
        var trayIcon = File.Exists(iconPath) ? new Icon(iconPath) : SystemIcons.Application;
        icon = new NotifyIcon { Icon = trayIcon, Text = "Novora", Visible = true };
        icon.ContextMenuStrip = BuildMenu();
        icon.MouseUp += (_, e) =>
        {
            if (e.Button == MouseButtons.Left) LaunchWinUi("--status-window");
        };
        ReadPort();
        timer = new System.Windows.Forms.Timer { Interval = 15000 };
        timer.Tick += async (_, _) => await RefreshStatusAsync();
        timer.Start();
        _ = RefreshStatusAsync();
    }

    private void LaunchWinUi(string mode)
    {
        var launcher = ResolveLauncherPath();
        if (!File.Exists(launcher))
        {
            MessageBox.Show("找不到 Novora 控制中心。", "Novora");
            return;
        }
        var start = new ProcessStartInfo(launcher) { UseShellExecute = true, WorkingDirectory = InstallRoot };
        start.ArgumentList.Add(mode);
        try { Process.Start(start); }
        catch (Exception exception) { MessageBox.Show(exception.Message, "Novora"); }
    }

    private ContextMenuStrip BuildMenu()
    {
        var menu = new TrayMenu();
        TrayMenuItem Entry(string text, string glyph, Action action) => new(text, glyph, action: action);
        menu.Items.Add(new TrayMenuItem("Novora 学校服务端", kind: TrayItemKind.Heading));
        menu.Items.Add(stateItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(Entry("打开控制中心(&O)", "\uE80F", () => LaunchWinUi("--overview")));
        menu.Items.Add(Entry("在浏览器中打开(&B)", "\uE774", OpenNovora));
        var lan = Entry("局域网访问地址", "\uE968", CopyLanAddress);
        lan.DropDownItems.Add(Entry("复制地址", "\uE8C8", CopyLanAddress));
        lan.DropDownItems.Add(Entry("在浏览器中打开", "\uE774", () => OpenUrl(LanAddress())));
        menu.Items.Add(lan);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(serviceStart);
        menu.Items.Add(serviceStop);
        menu.Items.Add(serviceRestart);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(Entry("查看日志(&L)", "\uE8A5", () => LaunchWinUi("--logs")));
        menu.Items.Add(Entry("备份与恢复(&R)", "\uE74E", () => LaunchWinUi("--backups")));
        menu.Items.Add(Entry("软件更新(&U)", "\uE896", () => LaunchWinUi("--updates")));
        menu.Items.Add(Entry("Windows 设置(&S)", "\uE713", OpenSystemSettings));
        menu.Items.Add(Entry("初始化与修复(&I)", "\uE90F", OpenWindowsSetup));
        menu.Items.Add(new ToolStripSeparator());
        var exit = Entry("退出托盘(&X)", "\uE8BB", ExitThread);
        exit.Kind = TrayItemKind.Danger;
        exit.ToolTipText = "仅退出托盘，后台服务继续运行。";
        menu.Items.Add(exit);
        menu.Opening += (_, _) => { UpdateMenuState(); _ = RefreshStatusAsync(); };
        return menu;
    }

    private void UpdateMenuState()
    {
        if (exiting) return;
        var text = operationText ?? serviceState switch
        {
            TrayServiceState.Missing => "服务未安装 · 请初始化或修复",
            TrayServiceState.Stopped => "服务已停止",
            TrayServiceState.Starting => "服务正在启动…",
            TrayServiceState.Stopping => "服务正在停止…",
            TrayServiceState.Running => healthy ? "服务运行正常" : "服务运行中 · 健康检查未通过",
            TrayServiceState.Other => "服务已暂停或状态异常",
            _ => "无法读取服务状态"
        };
        stateItem.Text = text;
        stateItem.Healthy = healthy && serviceState == TrayServiceState.Running;
        icon.Text = "Novora · " + text;
        serviceStart.Enabled = !operating && serviceState == TrayServiceState.Stopped;
        serviceRestart.Enabled = serviceStop.Enabled = !operating && serviceState == TrayServiceState.Running;
    }
    private string EnvPath => Path.Combine(dataRoot, "config", ".env");
    private void ReadPort()
    {
        try { var line = File.ReadLines(EnvPath).FirstOrDefault(value => value.StartsWith("PORT=", StringComparison.OrdinalIgnoreCase)); if (line is not null && int.TryParse(line[5..].Trim().Trim('"', '\''), out var value) && value is > 0 and <= 65535) port = value; }
        catch { }
        try { using var config = JsonDocument.Parse(File.ReadAllText(Path.Combine(dataRoot, "config", "runtime.json"))); if (config.RootElement.GetProperty("port").TryGetInt32(out var value) && value is > 0 and <= 65535) port = value; } catch { }
    }
    private async Task RefreshStatusAsync()
    {
        if (refreshing || exiting || operating) return;
        refreshing = true;
        var generation = statusGeneration;
        var state = TrayServiceState.Unknown;
        try
        {
            state = await Task.Run(TrayService.Read);
            if (exiting || operating) return;
            ReadPort();
            if (state != TrayServiceState.Running) { healthy = false; return; }
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            using var message = await http.GetAsync($"http://127.0.0.1:{port}/api/health", HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            message.EnsureSuccessStatusCode();
            await using var stream = await message.Content.ReadAsStreamAsync(timeout.Token);
            var buffer = new byte[16 * 1024 + 1];
            var length = await stream.ReadAtLeastAsync(buffer, buffer.Length, false, timeout.Token);
            if (length == buffer.Length) throw new InvalidDataException("健康响应过大。");
            var response = JsonSerializer.Deserialize<HealthResponse>(buffer.AsSpan(0, length), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (exiting || operating || generation != statusGeneration) return;
            healthy = response?.Ok == true;
            version = response?.Version ?? "Novora";
        }
        catch { if (!exiting && !operating) healthy = false; }
        finally
        {
            refreshing = false;
            if (!exiting && !operating)
            {
                if (generation != statusGeneration) await RefreshStatusAsync();
                else { serviceState = state; UpdateMenuState(); }
            }
        }
    }
    private string LanAddress() => $"http://{GetLocalIps().FirstOrDefault() ?? "127.0.0.1"}:{port}";
    private static IEnumerable<string> GetLocalIps() => NetworkInterface.GetAllNetworkInterfaces()
        .Where(network => network.OperationalStatus == OperationalStatus.Up
            && network.NetworkInterfaceType != NetworkInterfaceType.Loopback
            && network.NetworkInterfaceType != NetworkInterfaceType.Tunnel)
        .SelectMany(network =>
        {
            try
            {
                var properties = network.GetIPProperties();
                var hasGateway = properties.GatewayAddresses.Any(gateway => gateway.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork
                    && !IPAddress.IsLoopback(gateway.Address)
                    && !gateway.Address.Equals(IPAddress.Any));
                return hasGateway
                    ? properties.UnicastAddresses
                        .Where(unicast => unicast.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork
                            && !IPAddress.IsLoopback(unicast.Address)
                            && !unicast.Address.ToString().StartsWith("169.254.", StringComparison.Ordinal))
                        .Select(unicast => unicast.Address.ToString())
                    : Enumerable.Empty<string>();
            }
            catch { return Enumerable.Empty<string>(); }
        })
        .Distinct(StringComparer.OrdinalIgnoreCase);

    private string ResolveLauncherPath()
    {
        var launcher = Path.Combine(InstallRoot, "NovoraLauncher.exe");
        if (File.Exists(launcher)) return launcher;
        var processDirectory = Path.GetDirectoryName(Environment.ProcessPath);
        if (!string.IsNullOrWhiteSpace(processDirectory))
        {
            var parentLauncher = Path.Combine(Directory.GetParent(processDirectory)?.FullName ?? processDirectory, "NovoraLauncher.exe");
            if (File.Exists(parentLauncher)) return parentLauncher;
        }
        return launcher;
    }

    private static string ResolveTrayRoot()
    {
        var processDirectory = Path.GetDirectoryName(Environment.ProcessPath);
        return string.IsNullOrWhiteSpace(processDirectory)
            ? AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar)
            : processDirectory.TrimEnd(Path.DirectorySeparatorChar);
    }

    private static string ResolveInstallRoot(string trayRoot)
    {
        var direct = Path.Combine(trayRoot, "NovoraLauncher.exe");
        if (File.Exists(direct)) return trayRoot;
        var parent = Directory.GetParent(trayRoot)?.FullName;
        return !string.IsNullOrWhiteSpace(parent) && File.Exists(Path.Combine(parent, "NovoraLauncher.exe"))
            ? parent
            : parent ?? trayRoot;
    }
    private void CopyLanAddress() { try { var address = LanAddress(); Clipboard.SetText(address); ShowToast("已复制局域网访问地址", address); } catch (Exception exception) { MessageBox.Show(exception.Message, "Novora"); } }
    private string CurrentVersion => string.IsNullOrWhiteSpace(version) || version == "Novora" ? packageVersion : version;
    private string ReadPackageVersion()
    {
        try { using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(InstallRoot, "package.json"))); return document.RootElement.TryGetProperty("version", out var value) ? value.GetString() ?? "未知" : "未知"; }
        catch { return "未知"; }
    }
    private async Task ShowStatusAsync()
    {
        await RefreshStatusAsync();
        ShowStatus();
    }
    private void ShowVersionInfo()
    {
        var text = $"Novora 学校服务端{Environment.NewLine}版本：v{CurrentVersion}{Environment.NewLine}{Environment.NewLine}服务状态：{(healthy ? "正常" : "未连接")}{Environment.NewLine}服务端口：{port}{Environment.NewLine}本机地址：http://127.0.0.1:{port}{Environment.NewLine}局域网地址：{LanAddress()}{Environment.NewLine}{Environment.NewLine}安装目录：{InstallRoot}{Environment.NewLine}数据目录：{dataRoot}{Environment.NewLine}日志目录：{Path.Combine(dataRoot, "logs")}";
        var copied = true;
        try { Clipboard.SetText(text); } catch { copied = false; }
        MessageBox.Show(text + (copied ? $"{Environment.NewLine}{Environment.NewLine}以上信息已复制到剪贴板。" : string.Empty), "Novora · 版本信息", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }
    private async Task CheckForUpdateAsync()
    {
        var current = CurrentVersion;
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(12) };
            using var response = await client.GetAsync($"http://127.0.0.1:{port}/api/system?sys=update-check&current={Uri.EscapeDataString(current)}");
            var body = await response.Content.ReadAsStringAsync();
            JsonElement root;
            try { using var document = JsonDocument.Parse(body); root = document.RootElement.Clone(); }
            catch
            {
                MessageBox.Show($"检查更新失败：服务没有返回结果。{Environment.NewLine}{Environment.NewLine}请确认 Novora 服务正常后重试。", "Novora · 检查更新", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            var ok = root.TryGetProperty("ok", out var okValue) && okValue.ValueKind == JsonValueKind.True;
            var latest = ReadText(root, "latest");
            var reported = ReadText(root, "current") ?? current;
            var error = ReadText(root, "error");
            var releaseUrl = ReadText(root, "releaseUrl");
            var publishedAt = ReadText(root, "publishedAt");
            var notes = ReadText(root, "notes");
            var hasUpdate = root.TryGetProperty("hasUpdate", out var hasUpdateValue) && hasUpdateValue.ValueKind == JsonValueKind.True;
            if (!ok)
            {
                MessageBox.Show($"检查更新失败：{error ?? "更新源不可达"}{Environment.NewLine}{Environment.NewLine}学校网络通常无法直连 GitHub；如果已配置发布清单地址，请检查该地址是否可达。", "Novora · 检查更新", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            if (hasUpdate && !string.IsNullOrWhiteSpace(latest))
            {
                var text = $"发现新版本：v{latest}{Environment.NewLine}当前版本：v{reported}";
                if (!string.IsNullOrWhiteSpace(publishedAt)) text += $"{Environment.NewLine}发布时间：{publishedAt}";
                if (!string.IsNullOrWhiteSpace(notes)) text += $"{Environment.NewLine}{Environment.NewLine}更新说明：{Environment.NewLine}{notes}";
                var openRelease = !string.IsNullOrWhiteSpace(releaseUrl);
                if (openRelease) text += $"{Environment.NewLine}{Environment.NewLine}是否打开下载页面？";
                var result = MessageBox.Show(text, "Novora · 发现新版本", openRelease ? MessageBoxButtons.OKCancel : MessageBoxButtons.OK, MessageBoxIcon.Information);
                if (openRelease && result == DialogResult.OK) OpenUrl(releaseUrl!);
                return;
            }
            MessageBox.Show($"当前已是最新版本：v{reported}", "Novora · 检查更新", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception exception)
        {
            MessageBox.Show($"检查更新失败：{exception.Message}{Environment.NewLine}{Environment.NewLine}请确认 Novora 服务正在运行，且本机能访问更新源。", "Novora · 检查更新", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }
    private static string? ReadText(JsonElement element, string name) => element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private void ShowLocalIps() { var ips = GetLocalIps().ToArray(); MessageBox.Show(ips.Length == 0 ? "未检测到局域网 IPv4 地址。" : string.Join(Environment.NewLine, ips.Select(ip => $"http://{ip}:{port}")), "Novora · 局域网地址"); }
    private void ShowStatus()
    {
        var screen = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 800);
        using var flyout = new TrayFlyout(healthy, CurrentVersion, port, LanAddress()) { Left = screen.Right - 380, Top = screen.Bottom - 238 };
        flyout.ShowDialog();
    }
    private void OpenNovora() => OpenUrl($"http://127.0.0.1:{port}");
    private void OpenStartupSettings() => OpenUrl("ms-settings:startupapps");
    private void OpenWindowsSetup()
    {
        var launcher = ResolveLauncherPath();
        try { Process.Start(new ProcessStartInfo(launcher, "--windows-setup") { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(launcher)! }); }
        catch (Exception exception) { MessageBox.Show(exception.Message, "Novora"); }
    }
    private void OpenSystemSettings()
    {
        var launcher = ResolveLauncherPath();
        try { Process.Start(new ProcessStartInfo(launcher, "--system-settings") { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(launcher)! }); }
        catch (Exception exception) { MessageBox.Show(exception.Message, "Novora"); }
    }
    private void StopService()
    {
        if (operating) return;
        if (MessageBox.Show("确定停止 Novora 服务吗？局域网访问将暂时不可用。", "Novora", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
        RunServiceCommand("stop", "正在停止服务…");
    }
    private static string BuildServiceCommand(string action, string installRoot, int servicePort)
    {
        static string Quote(string value) => "'" + value.Replace("'", "''") + "'";
        return "$ErrorActionPreference = 'Stop'; try { & " + Quote(Path.Combine(installRoot, "service-operation.ps1"))
            + " -Action " + Quote(action) + " -InstallRoot " + Quote(installRoot) + " -Port " + servicePort
            + "; if (-not $?) { exit 1 }; exit 0 } catch { exit 1 }";
    }
    private async void RunServiceCommand(string action, string progress)
    {
        if (operating) return;
        operating = true;
        statusGeneration++;
        operationText = progress;
        UpdateMenuState();
        try
        {
            if (!File.Exists(Path.Combine(InstallRoot, "service-operation.ps1")))
                throw new FileNotFoundException("缺少服务操作脚本，请使用完整安装包修复安装。");
            ReadPort();
            var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(BuildServiceCommand(action, InstallRoot, port)));
            using var process = Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand {encoded}") { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden });
            if (process is null) throw new InvalidOperationException("无法启动服务操作。");
            // service-operation.ps1 bounds its own service waits; this bounds the whole
            // elevated step so the tray cannot stay stuck in "operating" forever.
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(240));
            try { await process.WaitForExitAsync(deadline.Token); }
            catch (OperationCanceledException)
            {
                try { if (!process.HasExited) process.Kill(true); } catch (InvalidOperationException) { }
                throw new InvalidOperationException("服务操作超过 240 秒未完成，已停止等待并结束该操作。请检查服务状态与日志。");
            }
            if (exiting) return;
            if (process.ExitCode != 0) throw new InvalidOperationException("服务操作失败，请查看日志。");
        }
        catch (Exception exception) { if (!exiting) MessageBox.Show(exception.Message, "Novora"); }
        finally { operating = false; operationText = null; if (!exiting) await RefreshStatusAsync(); }
    }
    private void ShowDiagnostics() { var log = Path.Combine(dataRoot, "logs", "installer.log"); MessageBox.Show($"版本：v{CurrentVersion}\n服务：{(healthy ? "正常" : "未连接")}\n端口：{port}\n本机地址：http://127.0.0.1:{port}\n局域网地址：{LanAddress()}\n日志：{log}", "Novora · 诊断信息"); }
    private void ShowAbout() => MessageBox.Show($"Novora 学校服务端\n版本：v{CurrentVersion}\n\n局域网服务端与管理托盘", "关于 Novora", MessageBoxButtons.OK, MessageBoxIcon.Information);
    private static void OpenFolder(string path) { Directory.CreateDirectory(path); OpenUrl(path); }
    private static void OpenUrl(string target) { try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); } catch (Exception exception) { MessageBox.Show(exception.Message, "Novora"); } }
    private void ShowToast(string title, string text) => icon.ShowBalloonTip(3000, title, text, ToolTipIcon.Info);
    protected override void ExitThreadCore() { exiting = true; timer.Stop(); timer.Dispose(); icon.Visible = false; icon.ContextMenuStrip?.Dispose(); icon.Dispose(); http.Dispose(); base.ExitThreadCore(); }
    private sealed record HealthResponse(bool Ok, string? Version);
}

