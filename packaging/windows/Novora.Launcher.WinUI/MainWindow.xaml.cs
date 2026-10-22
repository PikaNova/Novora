using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;
using Windows.Graphics;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Windowing;
using Microsoft.UI;
using Microsoft.UI.Composition.SystemBackdrops;
using Windows.ApplicationModel.DataTransfer;
using WinRT.Interop;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.RegularExpressions;

namespace Novora.Launcher.WinUI;

public enum LauncherMode { Setup, Maintenance }

public sealed partial class MainWindow : Window
{
    private readonly string root = NovoraPaths.InstallRoot;
    private readonly string dataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Novora");
    private int port = 3000;
    private bool applied;
    private int selectedIndex;
    private readonly LauncherMode mode;
    private readonly Dictionary<string, bool> settings = new()
    {
        ["serviceAutoStart"] = true,
        ["databaseAutoStart"] = true,
        ["serviceAutoRestart"] = true,
        ["lanAccess"] = true,
        ["trayStartup"] = true,
        ["desktopShortcut"] = true,
        ["startMenuShortcut"] = true
    };
    private ProgressRing? setupProgress;
    private TextBlock? setupProgressText;
    public string? InitializationResultPath { get; private set; }

    public MainWindow(LauncherMode mode)
    {
        this.mode = mode;
        InitializeComponent();
        // Apply the light palette in code as well as in resources.  This keeps
        // the unpackaged WinUI template from falling back to white foregrounds
        // on machines whose system theme is dark.
        RootGrid.RequestedTheme = ElementTheme.Light;
        RootGrid.Background = FluentUi.PageBackgroundBrush;
        Navigation.Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0));
        Navigation.Foreground = FluentUi.PrimaryBrush;
        ActionBar.Background = FluentUi.PageBackgroundBrush;
        ActionBar.Foreground = FluentUi.PrimaryBrush;
        HeaderSubtitle.Foreground = FluentUi.SecondaryBrush;
        VersionText.Foreground = FluentUi.SecondaryBrush;
        BackButton.Foreground = FluentUi.PrimaryBrush;
        NextButton.Foreground = FluentUi.PrimaryBrush;
        VersionText.Text = "v2.8.1";
        Title = mode == LauncherMode.Setup ? "Novora · Windows 初始化" : "Novora · 维护中心";
        HeaderSubtitle.Text = mode == LauncherMode.Setup ? "Windows 初始化" : "系统设置与运行状态";
        var hwnd = WindowNative.GetWindowHandle(this);
        var windowId = Win32Interop.GetWindowIdFromWindow(hwnd);
        var appWindow = AppWindow.GetFromWindowId(windowId);
        appWindow.Resize(new SizeInt32(1180, 800));
        // Keep the system title bar separate from page content.  This avoids
        // title-bar buttons overlapping the brand header on unpackaged WinUI.
        appWindow.TitleBar.ExtendsContentIntoTitleBar = false;
        try { appWindow.SetIcon(Path.Combine(root, "favicon.ico")); } catch { }
        RootGrid.RequestedTheme = ElementTheme.Light;
        if (Environment.OSVersion.Version.Build >= 22000)
        {
            SystemBackdrop = new MicaBackdrop { Kind = MicaKind.BaseAlt };
        }
        ReadPort();
        if (mode == LauncherMode.Maintenance)
        {
            // Keep NavigationView as the content host, but hide only its setup pane.
            // Collapsing the whole control also hides ContentHost and leaves a blank
            // maintenance window.
            Navigation.IsPaneVisible = false;
            ActionBar.Visibility = Visibility.Collapsed;
            var settingsPage = new SystemSettingsPage(this);
            ContentHost.Content = settingsPage;
        }
        UpdateActionBar();
        setupProgressText = new TextBlock { Foreground = FluentUi.SecondaryBrush, TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center };
        setupProgress = new ProgressRing { IsActive = false, Visibility = Visibility.Collapsed, Width = 20, Height = 20, VerticalAlignment = VerticalAlignment.Center };
        var progressRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Margin = new Thickness(24, 0, 24, 8), IsHitTestVisible = false };
        progressRow.Children.Add(setupProgress);
        progressRow.Children.Add(setupProgressText);
        RootGrid.Children.Add(progressRow);
        Grid.SetRow(progressRow, 2);
        Navigation.Loaded += (_, _) =>
        {
            if (mode != LauncherMode.Setup) return;
            Navigation.SelectedItem = Navigation.MenuItems[0];
            _ = CheckEnvironmentAsync();
        };
    }

    private void Navigation_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.SelectedItem is not NavigationViewItem item) return;
        var page = item.Tag?.ToString() ?? "environment";
        selectedIndex = Navigation.MenuItems.IndexOf(item);
        Page nextPage = page switch
        {
            "services" => new ServicePage(),
            "network" => new NetworkPage(this),
            "shortcuts" => new ShortcutPage(),
            "finish" => new FinishPage(),
            "system" => new SystemSettingsPage(this),
            "monitor" => new RuntimeMonitorPage(),
            _ => new EnvironmentPage()
        };
        nextPage.Tag = this;
        ContentHost.Content = nextPage;
        UpdateActionBar();
    }

    private void UpdateActionBar()
    {
        if (mode == LauncherMode.Maintenance) return;
        BackButton.IsEnabled = selectedIndex > 0 && !applied;
        ActionBar.Visibility = Visibility.Visible;
        NextButton.Label = selectedIndex == 3 ? "完成初始化" : selectedIndex == 4 ? "打开 Novora" : "下一步";
        NextButton.Icon = new SymbolIcon(selectedIndex == 4 ? Symbol.Go : Symbol.Forward);
    }

    private void BackButton_Click(object sender, RoutedEventArgs e)
    {
        if (selectedIndex <= 0) return;
        Navigation.SelectedItem = Navigation.MenuItems[selectedIndex - 1];
    }

    private async void NextButton_Click(object sender, RoutedEventArgs e)
    {
        if (selectedIndex < 3)
        {
            Navigation.SelectedItem = Navigation.MenuItems[selectedIndex + 1];
            return;
        }
        if (selectedIndex == 3)
        {
            await ApplySettingsAsync();
            return;
        }
        OpenUrl($"http://127.0.0.1:{port}");
    }

    private async Task ApplySettingsAsync()
    {
        NextButton.IsEnabled = false;
        SetSetupProgress(true, "正在请求管理员权限并应用 Windows 设置…");
        try
        {
            var optionsPath = Path.Combine(Path.GetTempPath(), $"novora-windows-options-{Guid.NewGuid():N}.json");
            var resultPath = Path.Combine(Path.GetTempPath(), $"novora-windows-result-{Guid.NewGuid():N}.json");
            InitializationResultPath = resultPath;
            var options = new
            {
                serviceAutoStart = settings["serviceAutoStart"], databaseAutoStart = settings["databaseAutoStart"],
                serviceAutoRestart = settings["serviceAutoRestart"], lanAccess = settings["lanAccess"], port,
                trayStartup = settings["trayStartup"], desktopShortcut = settings["desktopShortcut"], startMenuShortcut = settings["startMenuShortcut"]
            };
            await File.WriteAllTextAsync(optionsPath, JsonSerializer.Serialize(options, new JsonSerializerOptions { WriteIndented = true }));
            var script = Path.Combine(root, "initialize.ps1");
            var arguments = $"-NoProfile -ExecutionPolicy Bypass -File \"{script}\" -OptionsFile \"{optionsPath}\" -InstallRoot \"{InstallRoot}\" -DataRoot \"{dataRoot}\" -ResultFile \"{resultPath}\" -Version 2.8.1";
            using var process = Process.Start(new ProcessStartInfo("powershell.exe", arguments)
            {
                UseShellExecute = true,
                Verb = "runas",
                WindowStyle = ProcessWindowStyle.Hidden,
                WorkingDirectory = root
            });
            if (process is null) throw new InvalidOperationException("无法启动 Windows 设置脚本。");
            SetSetupProgress(true, "正在配置服务、数据库、防火墙和快捷方式…");
            await process.WaitForExitAsync();
            if (process.ExitCode != 0)
            {
                var resultDetails = File.Exists(resultPath) ? File.ReadAllText(resultPath).Trim() : string.Empty;
                var logPath = Path.Combine(dataRoot, "logs", "initialize.log");
                var detail = string.IsNullOrWhiteSpace(resultDetails)
                    ? $"Windows 设置脚本返回错误代码 {process.ExitCode}。请查看 {logPath}。"
                    : $"Windows 设置脚本返回错误代码 {process.ExitCode}。\n\n{resultDetails}";
                throw new InvalidOperationException(detail);
            }
            applied = true;
            SetSetupProgress(true, "配置已完成，正在读取初始化凭据…");
            Navigation.SelectedItem = Navigation.MenuItems[4];
            UpdateActionBar();
        }
        catch (Exception ex)
        {
            var dialog = FluentUi.LightDialog(new ContentDialog { XamlRoot = RootGrid.XamlRoot, Title = "初始化未完成", Content = ex.Message, CloseButtonText = "确定" });
            await dialog.ShowAsync();
        }
        finally { SetSetupProgress(false, string.Empty); NextButton.IsEnabled = true; }
    }

    private void SetSetupProgress(bool visible, string message)
    {
        if (setupProgress is not null) setupProgress.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
        if (setupProgressText is not null) setupProgressText.Text = message;
    }

    private async Task CheckEnvironmentAsync()
    {
        ReadPort();
        if (ContentHost.Content is EnvironmentPage page) await page.RefreshAsync();
    }

    private void ReadPort()
    {
        try
        {
            var env = Path.Combine(dataRoot, "config", ".env");
            var line = File.ReadLines(env).FirstOrDefault(v => v.StartsWith("PORT=", StringComparison.OrdinalIgnoreCase));
            if (line is not null && int.TryParse(line[5..].Trim(), out var value)) port = value;
        }
        catch { }
    }

    public int Port => port;
    public string DataRoot => dataRoot;
    // The WinUI launcher is installed directly in the Novora root. The tray
    // executable lives in a subfolder and intentionally computes its parent;
    // doing that here breaks custom installs such as G:\Novora.
    public string InstallRoot => root;
    public void SetSetting(string key, bool value) => settings[key] = value;

    public void OpenUrl(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }

    public async Task<bool> IsHealthyAsync()
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
            var result = await client.GetFromJsonAsync<HealthResponse>($"http://127.0.0.1:{port}/api/health");
            return result?.Ok == true;
        }
        catch { return false; }
    }

    public sealed record HealthResponse(bool Ok, string? Version = null);
}

public sealed class EnvironmentPage : Page
{
    private readonly TextBlock status = new();
    private readonly TextBlock serviceValue = new() { Text = "等待检查" };
    private readonly TextBlock databaseValue = new() { Text = "等待检查" };
    private readonly TextBlock networkValue = new() { Text = "等待检查" };
    private readonly InfoBar info = new() { IsOpen = true, Severity = InfoBarSeverity.Informational, Title = "正在检查服务", Foreground = FluentUi.PrimaryBrush };
    private Button? refreshButton;
    private MainWindow Host => (MainWindow)Tag!;
    public EnvironmentPage()
    {
        Foreground = FluentUi.PrimaryBrush;
        Padding = new Thickness(48, 40, 56, 48);
        Content = Build();
    }
    private UIElement Build()
    {
        var panel = new StackPanel { Spacing = 22, HorizontalAlignment = HorizontalAlignment.Stretch };
        panel.Children.Add(FluentUi.PageTitle("环境检查"));
        panel.Children.Add(FluentUi.Secondary("确认 Novora 服务、数据库和网络环境已经准备完成。"));
        var cards = new Grid { ColumnSpacing = 16 };
        for (var i = 0; i < 3; i++) cards.ColumnDefinitions.Add(new ColumnDefinition());
        cards.Children.Add(Card("Novora 服务", serviceValue, Symbol.Accept, 0));
        cards.Children.Add(Card("PostgreSQL 数据库", databaseValue, Symbol.Setting, 1));
        cards.Children.Add(Card("局域网访问", networkValue, Symbol.World, 2));
        panel.Children.Add(cards);
        status.Text = "正在读取 Windows 服务状态…";
        status.Foreground = FluentUi.SecondaryBrush;
        status.TextWrapping = TextWrapping.Wrap;
        panel.Children.Add(status);
        panel.Children.Add(info);
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        refreshButton = new Button { Content = "重新检查", MinWidth = 116, MinHeight = 40, Foreground = FluentUi.PrimaryBrush };
        refreshButton.Click += async (_, _) => await RefreshAsync();
        var logs = new Button { Content = "打开日志目录", Foreground = FluentUi.PrimaryBrush };
        logs.Click += (_, _) => Host.OpenUrl(Path.Combine(Host.DataRoot, "logs"));
        buttons.Children.Add(refreshButton); buttons.Children.Add(logs); panel.Children.Add(buttons);
        return panel;
    }
    private Border Card(string title, TextBlock value, Symbol symbol, int column)
    {
        var stack = new StackPanel { Spacing = 10, MinHeight = 100 };
        stack.Children.Add(new SymbolIcon(symbol) { Width = 24, Height = 24, Foreground = FluentUi.AccentBrush });
        stack.Children.Add(new TextBlock { Text = title, Style = (Style)Application.Current.Resources["BodyStrongTextBlockStyle"], Foreground = FluentUi.PrimaryBrush });
        value.FontSize = 18;
        value.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
        value.Foreground = FluentUi.PrimaryBrush;
        stack.Children.Add(value);
        var border = FluentUi.Card(stack, new Thickness(20));
        Grid.SetColumn(border, column); return border;
    }
    public async Task RefreshAsync()
    {
        if (refreshButton is not null) refreshButton.IsEnabled = false;
        serviceValue.Text = databaseValue.Text = networkValue.Text = "检查中…";
        status.Text = "正在读取 Windows 服务状态…";
        info.Severity = InfoBarSeverity.Informational;
        info.Title = "正在检查服务";
        info.Message = "正在检查 Windows 服务、数据库和本机端口。";
        try
        {
            var serviceTask = WindowsDiagnostics.GetServiceStateAsync("Novora");
            var databaseTask = WindowsDiagnostics.GetServiceStateAsync("NovoraPostgreSQL");
            var healthTask = Host.IsHealthyAsync();
            var portTask = WindowsDiagnostics.IsPortListeningAsync(Host.Port);
            await Task.WhenAll(serviceTask, databaseTask, healthTask, portTask);
            var service = serviceTask.Result;
            var database = databaseTask.Result;
            var healthy = healthTask.Result;
            var listening = portTask.Result;
            serviceValue.Text = service;
            databaseValue.Text = database;
            networkValue.Text = listening ? $"端口 {Host.Port} 可访问" : $"端口 {Host.Port} 未监听";
            status.Text = $"本机地址  http://127.0.0.1:{Host.Port}\n局域网访问  {(listening ? "请确认防火墙允许专用网络和域网络。" : "服务启动后才会开放访问。")}";
            var ready = healthy && service == "运行中" && database == "运行中" && listening;
            info.Severity = ready ? InfoBarSeverity.Success : InfoBarSeverity.Warning;
            info.Title = ready ? "环境检查通过" : "仍有项目需要检查";
            info.Message = ready ? "Novora 服务、数据库和本机端口均已就绪，可以继续初始化。" : "请检查上方状态；服务首次启动可能需要一些时间。日志目录可查看详细错误。";
        }
        catch (Exception exception)
        {
            serviceValue.Text = databaseValue.Text = "检查失败";
            networkValue.Text = "检查失败";
            status.Text = exception.Message;
            info.Severity = InfoBarSeverity.Error;
            info.Title = "环境检查失败";
            info.Message = "请打开日志目录查看安装和服务日志。";
        }
        finally
        {
            if (refreshButton is not null) refreshButton.IsEnabled = true;
        }
    }
}

public sealed class ServicePage : Page
{
    private MainWindow Host => (MainWindow)Tag!;
    public ServicePage() { Foreground = FluentUi.PrimaryBrush; Padding = new Thickness(48, 40, 56, 48); Content = Build(); }
    private UIElement Build()
    {
        var panel = new StackPanel { Spacing = 20, HorizontalAlignment = HorizontalAlignment.Stretch };
        panel.Children.Add(FluentUi.PageTitle("Windows 服务"));
        panel.Children.Add(FluentUi.Secondary("控制启动方式与故障恢复策略。"));
        panel.Children.Add(Row("serviceAutoStart", "开机启动 Novora 服务", "Windows 登录后自动启动学校服务端。"));
        panel.Children.Add(Row("databaseAutoStart", "开机启动 PostgreSQL 数据库", "保证 Novora 服务启动前数据库已经可用。"));
        panel.Children.Add(Row("serviceAutoRestart", "服务异常时自动恢复", "Windows 服务退出后自动重新启动。"));
        return panel;
    }
    private Border Row(string key, string title, string description)
    {
        var grid = new Grid { Padding = new Thickness(16), ColumnSpacing = 20 };
        grid.ColumnDefinitions.Add(new ColumnDefinition()); grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var text = new StackPanel { Spacing = 4 };
        text.Children.Add(new TextBlock { Text = title, FontSize = 16, Foreground = FluentUi.PrimaryBrush }); text.Children.Add(new TextBlock { Text = description, Foreground = FluentUi.SecondaryBrush, FontSize = 13 });
        var toggle = new ToggleSwitch { IsOn = true, OnContent = "开启", OffContent = "关闭", Foreground = FluentUi.PrimaryBrush };
        toggle.Toggled += (_, _) => Host.SetSetting(key, toggle.IsOn);
        grid.Children.Add(text); Grid.SetColumn(toggle, 1); grid.Children.Add(toggle);
        return FluentUi.Card(grid, new Thickness(0));
    }
}

public sealed class NetworkPage : Page
{
    private MainWindow Host => (MainWindow)Tag!;
    public NetworkPage(MainWindow host) { Tag = host; Foreground = FluentUi.PrimaryBrush; Padding = new Thickness(48, 40, 56, 48); Content = Build(); }
    private UIElement Build()
    {
        var panel = new StackPanel { Spacing = 20, HorizontalAlignment = HorizontalAlignment.Stretch };
        panel.Children.Add(FluentUi.PageTitle("局域网访问"));
        panel.Children.Add(FluentUi.Secondary("允许学校网络内其他电脑访问 Novora。"));
        var card = new StackPanel { Spacing = 14 };
        var toggle = new ToggleSwitch { Header = "允许局域网访问", OnContent = "开启", OffContent = "关闭", IsOn = true, Foreground = FluentUi.PrimaryBrush };
        toggle.Toggled += (_, _) => Host.SetSetting("lanAccess", toggle.IsOn);
        card.Children.Add(toggle);
        card.Children.Add(new TextBlock { Text = $"监听地址     0.0.0.0\n服务端口     {Host.Port}\n防火墙范围   当前局域网子网", Foreground = FluentUi.SecondaryBrush, FontSize = 14, LineHeight = 24 });
        panel.Children.Add(FluentUi.Card(card, new Thickness(20)));
        return panel;
    }
}

public sealed class ShortcutPage : Page
{
    private MainWindow Host => (MainWindow)Tag!;
    public ShortcutPage() { Foreground = FluentUi.PrimaryBrush; Padding = new Thickness(48, 40, 56, 48); Content = Build(); }
    private UIElement Build()
    {
        var panel = new StackPanel { Spacing = 20, HorizontalAlignment = HorizontalAlignment.Stretch };
        panel.Children.Add(FluentUi.PageTitle("托盘与快捷方式"));
        panel.Children.Add(FluentUi.Secondary("设置登录启动方式，以及常用入口的位置。"));
        panel.Children.Add(Setting("trayStartup", "登录 Windows 后自动启动托盘"));
        panel.Children.Add(Setting("desktopShortcut", "创建桌面快捷方式"));
        panel.Children.Add(Setting("startMenuShortcut", "创建开始菜单快捷方式"));
        return panel;
    }
    private ToggleSwitch Setting(string key, string title)
    {
        var toggle = new ToggleSwitch { Header = title, IsOn = true, OnContent = "开启", OffContent = "关闭", Foreground = FluentUi.PrimaryBrush };
        toggle.Toggled += (_, _) => Host.SetSetting(key, toggle.IsOn);
        return toggle;
    }
}

public sealed class FinishPage : Page
{
    private readonly TextBlock credentials = new() { FontSize = 15, TextWrapping = TextWrapping.Wrap, Foreground = FluentUi.PrimaryBrush };
    private readonly TextBlock credentialTitle = new() { Text = "管理员账户", FontSize = 17, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = FluentUi.PrimaryBrush };
    private readonly TextBlock credentialHint = new() { TextWrapping = TextWrapping.Wrap, Foreground = FluentUi.SecondaryBrush };
    private readonly Button copyButton = new() { Content = "复制密码", Foreground = FluentUi.PrimaryBrush, IsEnabled = false };
    private string? adminPassword;
    public FinishPage() { Foreground = FluentUi.PrimaryBrush; Padding = new Thickness(48, 40, 56, 48); Content = Build(); Loaded += (_, _) => LoadCredentials(); }
    private UIElement Build()
    {
        var panel = new StackPanel { Spacing = 18, MaxWidth = 720, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        panel.Children.Add(new FontIcon { Glyph = "\uE73E", FontSize = 48, HorizontalAlignment = HorizontalAlignment.Center, Foreground = FluentUi.AccentBrush });
        panel.Children.Add(new TextBlock { Text = "Windows 初始化完成", Style = (Style)Application.Current.Resources["TitleTextBlockStyle"], Foreground = FluentUi.PrimaryBrush, HorizontalAlignment = HorizontalAlignment.Center });
        panel.Children.Add(new TextBlock { Text = "Novora 已准备好在局域网内提供服务。", Foreground = FluentUi.SecondaryBrush, HorizontalAlignment = HorizontalAlignment.Center });
        var card = new StackPanel { Spacing = 10 };
        card.Children.Add(credentialTitle);
        card.Children.Add(credentialHint);
        card.Children.Add(credentials);
        copyButton.Click += (_, _) => CopyCredentials();
        card.Children.Add(copyButton);
        panel.Children.Add(FluentUi.Card(card, new Thickness(24)));
        return panel;
    }

    private void LoadCredentials()
    {
        try
        {
            var host = (MainWindow)Tag!;
            if (!string.IsNullOrWhiteSpace(host.InitializationResultPath) && File.Exists(host.InitializationResultPath))
            {
                using var document = JsonDocument.Parse(File.ReadAllText(host.InitializationResultPath));
                if (document.RootElement.TryGetProperty("adminCredentialState", out var state)
                    && state.ValueKind == JsonValueKind.String
                    && string.Equals(state.GetString(), "uninitialized", StringComparison.OrdinalIgnoreCase)
                    && document.RootElement.TryGetProperty("adminPassword", out var password)
                    && password.ValueKind == JsonValueKind.String)
                {
                    adminPassword = password.GetString();
                }
            }
            if (!string.IsNullOrWhiteSpace(adminPassword))
            {
                credentialTitle.Text = "首次登录凭据";
                credentialHint.Text = "数据库尚未初始化管理员账户。请保存此密码，首次进入 Novora 管理界面时使用。";
                credentials.Text = $"管理员账号：admin\nADMIN_PASSWORD={adminPassword}";
                copyButton.IsEnabled = true;
                return;
            }
            var credentialState = "unknown";
            if (!string.IsNullOrWhiteSpace(host.InitializationResultPath) && File.Exists(host.InitializationResultPath))
            {
                try
                {
                    using var document = JsonDocument.Parse(File.ReadAllText(host.InitializationResultPath));
                    if (document.RootElement.TryGetProperty("adminCredentialState", out var state) && state.ValueKind == JsonValueKind.String)
                        credentialState = state.GetString() ?? "unknown";
                }
                catch { }
            }
            credentialTitle.Text = credentialState == "initialized" ? "现有管理员账户" : "管理员凭据状态";
            credentialHint.Text = "本次只应用 Windows 服务和网络设置，不会重置或更改 Novora 管理员密码。";
            credentials.Text = credentialState == "initialized"
                ? "数据库已初始化。请继续使用当前管理员密码登录；如已忘记，请使用 Novora 的账户恢复流程。"
                : "无法确认数据库是否完成初始化，因此没有展示磁盘上保存的旧引导密码。本次不会生成或更改管理员密码。请检查数据库连接后再查看状态。";
            copyButton.IsEnabled = false;
        }
        catch
        {
            credentialTitle.Text = "管理员凭据状态";
            credentialHint.Text = "本次不会生成或更改 Novora 管理员密码。";
            credentials.Text = "无法读取本次初始化结果。请使用现有管理员密码登录，或通过账户恢复流程重置。";
            copyButton.IsEnabled = false;
        }
    }

    private void CopyCredentials()
    {
        try
        {
            var password = adminPassword;
            if (string.IsNullOrWhiteSpace(password)) return;
            var package = new DataPackage();
            package.SetText(password);
            Clipboard.SetContent(package);
        }
        catch { }
    }
}

public sealed class SystemSettingsPage : Page
{
    private MainWindow Host => (MainWindow)Tag!;

    public SystemSettingsPage(MainWindow host)
    {
        Tag = host;
        Foreground = FluentUi.PrimaryBrush;
        Padding = new Thickness(48, 40, 56, 48);
        Content = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Content = Build()
        };
    }

    private UIElement Build()
    {
        var panel = new StackPanel { Spacing = 20, HorizontalAlignment = HorizontalAlignment.Stretch };
        panel.Children.Add(FluentUi.PageTitle("系统设置"));
        panel.Children.Add(FluentUi.Secondary("管理 Novora 在 Windows 上的运行方式。"));

        var settings = new StackPanel { Spacing = 8 };
        settings.Children.Add(Action("运行初始化向导", "重新配置服务启动、局域网访问和快捷方式。", "--windows-setup"));
        settings.Children.Add(FluentUi.Divider());
        settings.Children.Add(Action("运行状态监控", "查看服务、数据库、Node.js、端口和局域网连接状态。", "--status-window"));
        settings.Children.Add(FluentUi.Divider());
        settings.Children.Add(Action("Windows 服务", "查看 Novora 与 PostgreSQL 服务。", "services.msc"));
        settings.Children.Add(FluentUi.Divider());
        settings.Children.Add(Action("防火墙", "查看 Novora 局域网入站规则。", "wf.msc"));
        settings.Children.Add(FluentUi.Divider());
        settings.Children.Add(Action("开机启动应用", "管理登录 Windows 后启动的托盘程序。", "ms-settings:startupapps"));
        settings.Children.Add(FluentUi.Divider());
        settings.Children.Add(Action("日志目录", "查看安装、服务和数据库日志。", Path.Combine(Host.DataRoot, "logs")));
        panel.Children.Add(settings);
        panel.Children.Add(new InfoBar
        {
            IsOpen = true,
            Severity = InfoBarSeverity.Informational,
            Foreground = FluentUi.PrimaryBrush,
            Title = "当前服务地址",
            Message = $"本机  http://127.0.0.1:{Host.Port}    ·    局域网地址请在“运行状态监控”中查看。"
        });
        return panel;
    }

    private Button Action(string title, string description, string target)
    {
        var button = new Button
        {
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            MinHeight = 68,
            Padding = new Thickness(14, 10, 14, 10)
        };
        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var text = new StackPanel { Spacing = 5, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(new TextBlock { Text = title, Style = (Style)Application.Current.Resources["BodyStrongTextBlockStyle"], Foreground = FluentUi.PrimaryBrush });
        text.Children.Add(FluentUi.Secondary(description));
        grid.Children.Add(text);
        var icon = new FontIcon { Glyph = "\uE72A", FontSize = 16, VerticalAlignment = VerticalAlignment.Center, Foreground = FluentUi.SecondaryBrush };
        Grid.SetColumn(icon, 1);
        grid.Children.Add(icon);
        button.Content = grid;
        button.Click += async (_, _) =>
        {
            try
            {
                if (target.StartsWith("--", StringComparison.Ordinal))
                {
                    var launcher = Path.Combine(Host.InstallRoot, "NovoraLauncher.exe");
                    if (!File.Exists(launcher)) throw new FileNotFoundException("找不到 Novora 启动程序。", launcher);
                    Process.Start(new ProcessStartInfo(launcher, target) { UseShellExecute = true, WorkingDirectory = Host.InstallRoot });
                }
                else Host.OpenUrl(target);
            }
            catch (Exception exception)
            {
                var dialog = FluentUi.LightDialog(new ContentDialog { XamlRoot = XamlRoot, Title = "无法打开设置", Content = exception.Message, CloseButtonText = "确定" });
                await dialog.ShowAsync();
            }
        };
        return button;
    }
}
