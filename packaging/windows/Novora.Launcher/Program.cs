using System.Diagnostics;
using System.Net.Http.Json;
using System.Security.Principal;
using System.Text.Json;
using Novora.Ui;

ApplicationConfiguration.Initialize();
Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
Application.Run(new LauncherForm());

sealed class LauncherForm : Form
{
    private const string NovoraVersion = "2.8.1";

    private readonly string root = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    private readonly string dataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Novora");
    private readonly string statePath;
    private readonly string envPath;
    private readonly string optionsPath;
    private readonly string resultPath;

    private readonly Label titleLabel = new() { AutoSize = true, Font = new Font("Segoe UI", 20, FontStyle.Bold), Location = new Point(212, 28), ForeColor = UiTheme.Text };
    private readonly Label stepLabel = new() { AutoSize = true, ForeColor = UiTheme.Muted, Location = new Point(214, 67) };
    private readonly Panel content = new() { Location = new Point(210, 100), Size = new Size(536, 350), BackColor = UiTheme.Surface };
    private readonly Button backButton = new() { Text = "上一步", Width = 100, Height = 38, Location = new Point(510, 474), FlatStyle = FlatStyle.Flat, BackColor = UiTheme.Surface, ForeColor = UiTheme.Text };
    private readonly AccentButton nextButton = new() { Text = "下一步", Width = 140, Height = 38, Location = new Point(620, 474) };
    private readonly Panel rail = new() { Location = new Point(0, 0), Size = new Size(184, 540), BackColor = UiTheme.Surface };
    private readonly Label brand = new() { Text = "NOVORA", AutoSize = true, Font = new Font("Segoe UI", 18, FontStyle.Bold), ForeColor = UiTheme.Text, Location = new Point(28, 32) };
    private readonly Label brandSub = new() { Text = "学校服务端", AutoSize = true, Font = new Font("Segoe UI", 9), ForeColor = UiTheme.Signal, Location = new Point(30, 62) };
    private readonly List<Label> railItems = new();
    private readonly System.Windows.Forms.Timer transition = new() { Interval = 16 };
    private int transitionTarget;

    private readonly Label environment = new() { AutoSize = false, Size = new Size(500, 190), Location = new Point(22, 24), ForeColor = UiTheme.Text };
    private readonly Button recheckButton = new() { Text = "重新检查", Width = 100, Height = 30, Location = new Point(0, 200) };
    private readonly Button logButton = new() { Text = "打开日志目录", Width = 130, Height = 30, Location = new Point(110, 200) };

    private ToggleSwitch serviceAutoStart = new() { Location = new Point(22, 20), Checked = true };
    private ToggleSwitch databaseAutoStart = new() { Location = new Point(22, 70), Checked = true };
    private ToggleSwitch serviceAutoRestart = new() { Location = new Point(22, 120), Checked = true };
    private readonly Label serviceHint = new() { AutoSize = false, Size = new Size(500, 140), Location = new Point(22, 160), ForeColor = UiTheme.Muted };

    private ToggleSwitch lanAccess = new() { Location = new Point(22, 24), Checked = true };
    private readonly Label lanHint = new() { AutoSize = false, Size = new Size(500, 230), Location = new Point(22, 72), ForeColor = UiTheme.Text };

    private ToggleSwitch trayStartup = new() { Location = new Point(22, 20), Checked = true };
    private ToggleSwitch desktopShortcut = new() { Location = new Point(22, 70), Checked = true };
    private ToggleSwitch startMenuShortcut = new() { Location = new Point(22, 120), Checked = true };
    private readonly Label shortcutHint = new() { AutoSize = false, Size = new Size(500, 150), Location = new Point(22, 160), ForeColor = UiTheme.Muted };

    private readonly Label summary = new() { AutoSize = false, Size = new Size(500, 280), Location = new Point(22, 24), ForeColor = UiTheme.Text };

    private readonly List<Panel> pages = new();
    private readonly List<string> pageTitles = new();
    private int page;
    private int port = 3000;
    private bool applied;

    public LauncherForm()
    {
        statePath = Path.Combine(dataRoot, "config", "windows-initialized.json");
        envPath = Path.Combine(dataRoot, "config", ".env");
        optionsPath = Path.Combine(Path.GetTempPath(), $"novora-windows-options-{Guid.NewGuid():N}.json");
        resultPath = Path.Combine(Path.GetTempPath(), $"novora-windows-result-{Guid.NewGuid():N}.json");
        ReadPort();

        Text = "Novora · Windows 初始化";
        ClientSize = new Size(760, 540);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.Sizable;
        MaximizeBox = false;
        MinimizeBox = true;
        try { Icon = new Icon(Path.Combine(root, "favicon.ico")); } catch { }

        if (IsInitialized() && !Environment.GetCommandLineArgs().Contains("--windows-setup", StringComparer.OrdinalIgnoreCase))
        {
            Shown += (_, _) => { OpenNovora(); Close(); };
            return;
        }

        BuildWizard();
    }

    private void BuildWizard()
    {
        UiTheme.Apply(this);
        UiTheme.ApplyBorder(this);
        rail.Controls.AddRange(new Control[] { brand, brandSub });
        Controls.Add(rail);
        BuildWelcomePage();
        BuildServicePage();
        BuildNetworkPage();
        BuildShortcutPage();
        BuildFinishPage();

        backButton.Click += (_, _) => GoTo(page - 1);
        nextButton.Click += async (_, _) => await Advance();
        Controls.AddRange(new Control[] { titleLabel, stepLabel, content, backButton, nextButton });
        transition.Tick += (_, _) => AnimatePage();
        AcceptButton = nextButton;
        GoTo(0);
    }

    private void AddPage(Panel panel, string title)
    {
        panel.Dock = DockStyle.Fill;
        panel.Visible = false;
        content.Controls.Add(panel);
        pages.Add(panel);
        pageTitles.Add(title);
        var item = new Label { Text = title, AutoSize = false, Size = new Size(150, 36), Location = new Point(28, 110 + (pages.Count - 1) * 50), ForeColor = UiTheme.Muted, Font = new Font("Segoe UI", 10F), TextAlign = ContentAlignment.MiddleLeft };
        railItems.Add(item); rail.Controls.Add(item);
    }

    private void BuildWelcomePage()
    {
        var panel = new Panel { BackColor = UiTheme.Surface };
        UiTheme.ApplyBorder(panel);
        var header = new Label { Text = "检查服务与网络状态", Location = new Point(22, 18), AutoSize = true, Font = new Font("Segoe UI", 13F, FontStyle.Bold), ForeColor = UiTheme.Text };
        var description = new Label { Text = "确认 Novora 已经可以在本机和局域网内提供服务。", Location = new Point(22, 48), AutoSize = true, ForeColor = UiTheme.Muted };
        environment.Location = new Point(22, 82);
        environment.Size = new Size(490, 132);
        recheckButton.Location = new Point(22, 270);
        logButton.Location = new Point(134, 270);
        panel.Controls.AddRange(new Control[] { header, description, environment, recheckButton, logButton });
        recheckButton.Click += async (_, _) => await CheckEnvironment();
        logButton.Click += (_, _) => OpenFolder(Path.Combine(dataRoot, "logs"));
        AddPage(panel, "环境检查");
        Shown += async (_, _) => await CheckEnvironment();
    }

    private void BuildServicePage()
    {
        var panel = new Panel { BackColor = UiTheme.Surface };
        UiTheme.ApplyBorder(panel);
        var header = new Label { Text = "Windows 服务", Location = new Point(22, 18), AutoSize = true, Font = new Font("Segoe UI", 13F, FontStyle.Bold), ForeColor = UiTheme.Text };
        var description = new Label { Text = "选择服务的启动方式与故障恢复策略。", Location = new Point(22, 48), AutoSize = true, ForeColor = UiTheme.Muted };
        serviceAutoStart = new ToggleSwitch { Location = new Point(22, 20), Checked = true };
        databaseAutoStart = new ToggleSwitch { Location = new Point(22, 70), Checked = true };
        serviceAutoRestart = new ToggleSwitch { Location = new Point(22, 120), Checked = true };
        panel.Controls.AddRange(new Control[] { new Label { Text = "开机启动 Novora 服务", Location = new Point(84, 24), AutoSize = true, ForeColor = UiTheme.Text }, new Label { Text = "开机启动 PostgreSQL 数据库", Location = new Point(84, 74), AutoSize = true, ForeColor = UiTheme.Text }, new Label { Text = "服务异常时自动恢复", Location = new Point(84, 124), AutoSize = true, ForeColor = UiTheme.Text } });
        serviceHint.Text = "这里只调整 Windows 服务的启动方式，不会修改 Novora 内部的任何业务设置。\r\nNovora 服务使用 LocalService 账号，PostgreSQL 服务使用 NetworkService 账号。";
        panel.Controls.AddRange(new Control[] { header, description, serviceAutoStart, databaseAutoStart, serviceAutoRestart, serviceHint });
        AddPage(panel, "Windows 服务");
    }

    private void BuildNetworkPage()
    {
        var panel = new Panel { BackColor = UiTheme.Surface };
        UiTheme.ApplyBorder(panel);
        var header = new Label { Text = "局域网访问", Location = new Point(22, 18), AutoSize = true, Font = new Font("Segoe UI", 13F, FontStyle.Bold), ForeColor = UiTheme.Text };
        var description = new Label { Text = "控制学校内其他电脑是否可以访问 Novora。", Location = new Point(22, 48), AutoSize = true, ForeColor = UiTheme.Muted };
        lanAccess = new ToggleSwitch { Location = new Point(22, 24), Checked = true };
        panel.Controls.Add(new Label { Text = "允许局域网访问", Location = new Point(84, 28), AutoSize = true, ForeColor = UiTheme.Text });
        panel.Controls.AddRange(new Control[] { header, description, lanAccess, lanHint });
        AddPage(panel, "局域网访问");
    }

    private void BuildShortcutPage()
    {
        var panel = new Panel { BackColor = UiTheme.Surface };
        UiTheme.ApplyBorder(panel);
        var header = new Label { Text = "托盘与快捷方式", Location = new Point(22, 18), AutoSize = true, Font = new Font("Segoe UI", 13F, FontStyle.Bold), ForeColor = UiTheme.Text };
        var description = new Label { Text = "设置登录启动方式，以及常用入口的位置。", Location = new Point(22, 48), AutoSize = true, ForeColor = UiTheme.Muted };
        trayStartup = new ToggleSwitch { Location = new Point(22, 20), Checked = true };
        desktopShortcut = new ToggleSwitch { Location = new Point(22, 70), Checked = true };
        startMenuShortcut = new ToggleSwitch { Location = new Point(22, 120), Checked = true };
        panel.Controls.AddRange(new Control[] { new Label { Text = "登录 Windows 后启动托盘", Location = new Point(84, 24), AutoSize = true, ForeColor = UiTheme.Text }, new Label { Text = "创建桌面快捷方式", Location = new Point(84, 74), AutoSize = true, ForeColor = UiTheme.Text }, new Label { Text = "创建开始菜单快捷方式", Location = new Point(84, 124), AutoSize = true, ForeColor = UiTheme.Text } });
        shortcutHint.Text = "快捷方式指向 Novora Windows 启动器：服务正常时直接打开 Novora，\r\n未完成初始化时重新进入本向导。";
        panel.Controls.AddRange(new Control[] { header, description, trayStartup, desktopShortcut, startMenuShortcut, shortcutHint });
        AddPage(panel, "托盘与快捷方式");
    }

    private void BuildFinishPage()
    {
        var panel = new Panel { BackColor = UiTheme.Surface };
        panel.Controls.Add(summary);
        AddPage(panel, "完成");
    }

    private async Task Advance()
    {
        if (page < pages.Count - 1)
        {
            if (page == 3) await ApplySettings();
            else GoTo(page + 1);
            return;
        }
        if (applied) { OpenNovora(); Close(); return; }
        Close();
    }

    private void GoTo(int index)
    {
        page = Math.Clamp(index, 0, pages.Count - 1);
        transitionTarget = page;
        Opacity = 0;
        transition.Start();
        for (var i = 0; i < pages.Count; i++) pages[i].Visible = i == page;
        stepLabel.Text = $"第 {page + 1} / {pages.Count} 步 · {pageTitles[page]}";
        backButton.Enabled = page > 0 && !applied;
        nextButton.Text = page switch
        {
            3 => "完成初始化",
            4 => applied ? "打开 Novora" : "关闭",
            _ => "下一步"
        };
        if (page == 2) RefreshNetworkHint();
        if (page == 3) RefreshShortcutHint();
        for (var i = 0; i < railItems.Count; i++) { railItems[i].ForeColor = i == page ? UiTheme.Signal : UiTheme.Muted; railItems[i].Font = new Font("Segoe UI", 10F, i == page ? FontStyle.Bold : FontStyle.Regular); }
    }

    private void AnimatePage()
    {
        Opacity = Math.Min(1.0, Opacity + .08);
        content.Left = 210 + (int)((1 - Opacity) * 12);
        if (Opacity >= 1) { content.Left = 210; transition.Stop(); }
    }

    private bool IsInitialized() => File.Exists(statePath);

    private void ReadPort()
    {
        try
        {
            var line = File.ReadLines(envPath).FirstOrDefault(value => value.StartsWith("PORT=", StringComparison.OrdinalIgnoreCase));
            if (line is not null && int.TryParse(line[5..].Trim(), out var value)) port = value;
        }
        catch { }
    }

    private static bool IsAdministrator()
    {
        try { using var identity = WindowsIdentity.GetCurrent(); return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator); }
        catch { return false; }
    }

    private static string QueryServiceState(string name)
    {
        try
        {
            using var process = Process.Start(new ProcessStartInfo("sc.exe", $"query {name}")
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true
            });
            if (process is null) return "无法查询";
            var output = process.StandardOutput.ReadToEnd();
            process.WaitForExit(5000);
            if (process.ExitCode != 0) return "未注册";
            if (output.Contains("RUNNING")) return "运行中";
            if (output.Contains("STOPPED")) return "已停止";
            return "未知";
        }
        catch { return "无法查询"; }
    }

    private async Task CheckEnvironment()
    {
        ReadPort();
        environment.Text = "正在检查运行环境...";
        environment.ForeColor = Color.DimGray;
        var serviceState = await Task.Run(() => QueryServiceState("Novora"));
        var databaseState = await Task.Run(() => QueryServiceState("NovoraPostgreSQL"));
        var health = await TryHealth();
        environment.Text =
            $"Novora 服务：{serviceState}\r\n" +
            $"PostgreSQL 数据库：{databaseState}\r\n" +
            $"服务端口：{port}\r\n" +
            $"接口健康检查：{(health ? "通过" : "未通过")}\r\n" +
            $"当前权限：{(IsAdministrator() ? "管理员（可直接应用设置）" : "标准用户（应用设置时会弹出一次 UAC）")}\r\n" +
            $"本机访问地址：http://127.0.0.1:{port}\r\n" +
            $"局域网访问地址：{FormatLanAddresses()}\r\n\r\n" +
            (health
                ? "环境正常，可以继续完成 Windows 初始化。"
                : "服务或数据库尚未就绪。安装刚结束时需要等待几十秒，也可以到日志目录查看具体原因。");
        environment.ForeColor = health ? Color.DarkGreen : Color.DarkRed;
    }

    private async Task<bool> TryHealth()
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
            var health = await client.GetFromJsonAsync<HealthResponse>($"http://127.0.0.1:{port}/api/health");
            return health?.Ok == true;
        }
        catch { return false; }
    }

    private static string FormatLanAddresses()
    {
        try
        {
            var addresses = System.Net.Dns.GetHostEntry(System.Net.Dns.GetHostName()).AddressList
                .Where(address => address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork && !System.Net.IPAddress.IsLoopback(address))
                .Select(address => address.ToString())
                .ToArray();
            return addresses.Length == 0 ? "未检测到局域网 IPv4 地址" : string.Join("，", addresses);
        }
        catch { return "未检测到局域网 IPv4 地址"; }
    }

    private void RefreshNetworkHint()
    {
        lanHint.Text =
            $"服务监听地址：0.0.0.0，端口 {port}\r\n" +
            $"本机访问：http://127.0.0.1:{port}\r\n" +
            $"局域网访问：{FormatLanAddresses()}\r\n\r\n" +
            "启用后会在 Windows 防火墙中创建名为“Novora LAN Server”的入站规则，\r\n" +
            "仅对“专用网络”和“域网络”放行该端口，不会对公用网络开放。\r\n\r\n" +
            "如果关闭，本机仍然可以访问，局域网内其他电脑无法连接。";
    }

    private void RefreshShortcutHint()
    {
        shortcutHint.Text =
            $"启动器位置：{Path.Combine(root, "NovoraLauncher.exe")}\r\n" +
            $"托盘程序：{Path.Combine(root, "tray", "NovoraTray.exe")}\r\n\r\n" +
            "关闭托盘登录启动后，托盘不会自动运行，但仍可手动打开。";
    }

    private async Task ApplySettings()
    {
        nextButton.Enabled = false;
        try
        {
            var options = new
            {
                serviceAutoStart = serviceAutoStart.Checked,
                databaseAutoStart = databaseAutoStart.Checked,
                serviceAutoRestart = serviceAutoRestart.Checked,
                lanAccess = lanAccess.Checked,
                port,
                trayStartup = trayStartup.Checked,
                desktopShortcut = desktopShortcut.Checked,
                startMenuShortcut = startMenuShortcut.Checked
            };
            File.WriteAllText(optionsPath, JsonSerializer.Serialize(options, new JsonSerializerOptions { WriteIndented = true }));
            var script = Path.Combine(root, "initialize.ps1");
            if (!File.Exists(script)) throw new FileNotFoundException($"缺少设置脚本：{script}");
            var arguments = $"-NoProfile -ExecutionPolicy Bypass -File \"{script}\" -OptionsFile \"{optionsPath}\" -InstallRoot \"{root}\" -DataRoot \"{dataRoot}\" -ResultFile \"{resultPath}\" -Version {NovoraVersion}";
            var exitCode = await RunElevatedAsync("powershell.exe", arguments);
            if (exitCode != 0) throw new InvalidOperationException($"设置脚本返回错误代码 {exitCode}，请查看 {Path.Combine(dataRoot, "logs")}。");
            summary.Text = BuildSummary(ReadResult());
            applied = true;
            GoTo(pages.Count - 1);
        }
        catch (Exception exception)
        {
            MessageBox.Show("Windows 初始化失败：" + exception.Message, "Novora", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            nextButton.Enabled = true;
        }
    }

    private JsonElement? ReadResult()
    {
        try
        {
            if (!File.Exists(resultPath)) return null;
            using var document = JsonDocument.Parse(File.ReadAllText(resultPath));
            return document.RootElement.Clone();
        }
        catch { return null; }
    }

    private string BuildSummary(JsonElement? result)
    {
        var lines = new List<string>
        {
            "Windows 初始化已完成。",
            string.Empty,
            $"服务启动方式：{(serviceAutoStart.Checked ? "开机自动启动" : "手动启动")}",
            $"数据库启动方式：{(databaseAutoStart.Checked ? "开机自动启动" : "手动启动")}",
            $"异常自动重启：{(serviceAutoRestart.Checked ? "已启用" : "已关闭")}",
            $"局域网访问：{(lanAccess.Checked ? "已允许" : "已关闭")}",
            $"托盘登录启动：{(trayStartup.Checked ? "已启用" : "已关闭")}",
            $"桌面快捷方式：{(desktopShortcut.Checked ? "已创建" : "未创建")}",
            string.Empty,
            $"本机地址：http://127.0.0.1:{port}",
            $"局域网地址：{FormatLanAddresses()}"
        };
        if (result is { } element)
        {
            if (element.TryGetProperty("lanUrls", out var lanUrls) && lanUrls.ValueKind == JsonValueKind.Array)
            {
                var urls = lanUrls.EnumerateArray().Select(item => item.GetString()).Where(item => !string.IsNullOrWhiteSpace(item)).ToArray();
                if (urls.Length > 0) lines.Add($"局域网访问地址：{string.Join("，", urls)}");
            }
            if (element.TryGetProperty("warnings", out var warnings) && warnings.ValueKind == JsonValueKind.Array)
            {
                var items = warnings.EnumerateArray().Select(item => item.GetString()).Where(item => !string.IsNullOrWhiteSpace(item)).ToArray();
                if (items.Length > 0)
                {
                    lines.Add(string.Empty);
                    lines.Add("需要注意：");
                    lines.AddRange(items.Select(item => "· " + item));
                }
            }
        }
        lines.Add(string.Empty);
        lines.Add("Novora 业务设置（学校信息、账号、权限等）请在网页管理界面完成。");
        return string.Join(Environment.NewLine, lines);
    }

    private static async Task<int> RunElevatedAsync(string file, string arguments)
    {
        using var process = Process.Start(new ProcessStartInfo(file, arguments)
        {
            UseShellExecute = true,
            Verb = "runas",
            WindowStyle = ProcessWindowStyle.Hidden
        });
        if (process is null) return -1;
        await process.WaitForExitAsync();
        return process.ExitCode;
    }

    private void OpenNovora() => OpenUrl($"http://127.0.0.1:{port}");

    private static void OpenFolder(string path)
    {
        try { Directory.CreateDirectory(path); OpenUrl(path); }
        catch (Exception exception) { MessageBox.Show(exception.Message, "Novora"); }
    }

    private static void OpenUrl(string target)
    {
        try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); }
        catch (Exception exception) { MessageBox.Show(exception.Message, "Novora"); }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        try { if (File.Exists(optionsPath)) File.Delete(optionsPath); } catch { }
        try { if (File.Exists(resultPath)) File.Delete(resultPath); } catch { }
        base.OnFormClosed(e);
    }

    private sealed record HealthResponse(bool Ok);
}
