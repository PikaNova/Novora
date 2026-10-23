using System.Diagnostics;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.Graphics;
using Windows.UI;
using WinRT.Interop;

namespace Novora.Launcher.WinUI;

public sealed class RuntimeMonitorPage : Page
{
    private readonly TextBlock serviceState = new() { Text = "检查中…", Foreground = FluentUi.PrimaryBrush };
    private readonly TextBlock databaseState = new() { Text = "检查中…", Foreground = FluentUi.PrimaryBrush };
    private readonly TextBlock healthState = new() { Text = "检查中…", Foreground = FluentUi.PrimaryBrush };
    private readonly TextBlock nodeDetails = new() { TextWrapping = TextWrapping.Wrap, Foreground = FluentUi.SecondaryBrush };
    private readonly TextBlock postgresDetails = new() { TextWrapping = TextWrapping.Wrap, Foreground = FluentUi.SecondaryBrush };
    private readonly TextBlock networkDetails = new() { TextWrapping = TextWrapping.Wrap, Foreground = FluentUi.SecondaryBrush };
    private readonly TextBlock pathDetails = new() { TextWrapping = TextWrapping.Wrap, Foreground = FluentUi.SecondaryBrush };
    private readonly TextBlock refreshed = new() { Foreground = FluentUi.SecondaryBrush };
    private readonly InfoBar alert = new() { IsOpen = true, Severity = InfoBarSeverity.Informational, Title = "运行状态监控", Foreground = FluentUi.PrimaryBrush };
    private readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromSeconds(30) };
    private readonly SemaphoreSlim refreshGate = new(1, 1);
    private Button? refreshButton;
    private MainWindow? Host => Tag as MainWindow;
    private RuntimeStatusWindow? StatusWindow => Tag as RuntimeStatusWindow;
    private string InstallRoot => Host?.InstallRoot ?? NovoraPaths.InstallRoot;
    private string DataRoot => Host?.DataRoot ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Novora");
    private int Port => Host?.Port ?? ReadPort(DataRoot);
    private double previousNodeCpu;
    private DateTime previousNodeSample;

    public RuntimeMonitorPage()
    {
        Foreground = FluentUi.PrimaryBrush;
        Padding = new Thickness(48, 40, 56, 48);
        Content = Build();
        timer.Tick += async (_, _) => await RefreshAsync(false);
        Loaded += async (_, _) => { await RefreshAsync(false); timer.Start(); };
        Unloaded += (_, _) => timer.Stop();
    }

    private UIElement Build()
    {
        var panel = new StackPanel { Spacing = 20, HorizontalAlignment = HorizontalAlignment.Stretch };
        var title = new Grid { ColumnSpacing = 16 };
        title.ColumnDefinitions.Add(new ColumnDefinition());
        title.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var heading = new StackPanel { Spacing = 5 };
        heading.Children.Add(FluentUi.PageTitle("运行状态监控"));
        heading.Children.Add(FluentUi.Secondary("服务、数据库、进程和局域网连接状态。"));
        title.Children.Add(heading);
        refreshButton = new Button { Content = "立即刷新", MinWidth = 112, MinHeight = 40, VerticalAlignment = VerticalAlignment.Center, Foreground = FluentUi.PrimaryBrush };
        refreshButton.Click += async (_, _) => await RefreshAsync(true);
        Grid.SetColumn(refreshButton, 1);
        title.Children.Add(refreshButton);
        panel.Children.Add(title);

        var statuses = new Grid { ColumnSpacing = 16 };
        for (var i = 0; i < 3; i++) statuses.ColumnDefinitions.Add(new ColumnDefinition());
        statuses.Children.Add(StatusCard("Novora 服务", serviceState, 0));
        statuses.Children.Add(StatusCard("PostgreSQL 数据库", databaseState, 1));
        statuses.Children.Add(StatusCard("HTTP 健康检查", healthState, 2));
        panel.Children.Add(statuses);
        panel.Children.Add(alert);

        var processes = new Grid { ColumnSpacing = 16 };
        processes.ColumnDefinitions.Add(new ColumnDefinition());
        processes.ColumnDefinitions.Add(new ColumnDefinition());
        processes.Children.Add(DetailsCard("Node.js 服务进程", nodeDetails, 0));
        processes.Children.Add(DetailsCard("PostgreSQL 进程", postgresDetails, 1));
        panel.Children.Add(processes);
        panel.Children.Add(DetailsCard("网络访问", networkDetails));
        panel.Children.Add(DetailsCard("安装与数据目录", pathDetails));
        panel.Children.Add(refreshed);

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        actions.Children.Add(CommandButton("打开 Novora", "\uE8A7", () => OpenUrl($"http://127.0.0.1:{Port}")));
        actions.Children.Add(CommandButton("置顶", "\uE840", () => SetWindowZOrder(WindowZOrder.TopMost)));
        actions.Children.Add(CommandButton("置底", "\uE840", () => SetWindowZOrder(WindowZOrder.Bottom)));
        panel.Children.Add(actions);
        return new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Content = panel
        };
    }

    private static Border StatusCard(string title, TextBlock value, int column)
    {
        var content = new StackPanel { Spacing = 10, MinHeight = 82 };
        content.Children.Add(new TextBlock { Text = title, Foreground = FluentUi.SecondaryBrush });
        value.FontSize = 20;
        value.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
        value.Foreground = FluentUi.PrimaryBrush;
        content.Children.Add(value);
        var card = FluentUi.Card(content, new Thickness(20));
        if (column >= 0) Grid.SetColumn(card, column);
        return card;
    }

    private static Border DetailsCard(string title, TextBlock value, int column = -1)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(new TextBlock { Text = title, Style = (Style)Application.Current.Resources["BodyStrongTextBlockStyle"], Foreground = FluentUi.PrimaryBrush });
        var details = new Border
        {
            Child = value,
            Padding = new Thickness(14, 12, 14, 12),
            Background = FluentUi.LayerBrush,
            CornerRadius = new CornerRadius(6)
        };
        value.Foreground = FluentUi.SecondaryBrush;
        value.FontSize = 14;
        value.LineHeight = 24;
        content.Children.Add(details);
        var card = FluentUi.Card(content, new Thickness(18));
        if (column >= 0) Grid.SetColumn(card, column);
        return card;
    }

    private Button CommandButton(string label, string glyph, Action action)
    {
        var button = new Button { MinHeight = 40, Padding = new Thickness(14, 8, 14, 8), Foreground = FluentUi.PrimaryBrush };
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        content.Children.Add(new FontIcon { Glyph = glyph, FontSize = 15, Foreground = FluentUi.AccentBrush });
        content.Children.Add(new TextBlock { Text = label, VerticalAlignment = VerticalAlignment.Center, Foreground = FluentUi.PrimaryBrush });
        button.Content = content;
        button.Click += (_, _) => action();
        return button;
    }

    private async Task RefreshAsync(bool showBusy)
    {
        if (!await refreshGate.WaitAsync(0)) return;
        if (showBusy && refreshButton is not null)
        {
            refreshButton.IsEnabled = false;
            refreshButton.Content = "正在刷新…";
        }
        try
        {
            var installRoot = InstallRoot;
            var dataRoot = DataRoot;
            var port = Port;
            var snapshot = await WindowsDiagnostics.GetStatusSnapshotAsync(installRoot, dataRoot, port, showBusy);
            var node = snapshot.Node;
            var now = DateTime.UtcNow;
            var cpuPercent = previousNodeSample == default || now <= previousNodeSample
                ? 0
                : Math.Clamp((node.CpuMilliseconds - previousNodeCpu) / (now - previousNodeSample).TotalMilliseconds / Environment.ProcessorCount * 100, 0, 100);
            previousNodeSample = now;
            previousNodeCpu = node.CpuMilliseconds;

            serviceState.Text = snapshot.ServiceState;
            databaseState.Text = snapshot.DatabaseState;
            healthState.Text = snapshot.Runtime?.Ok == true ? "正常" : "未通过";
            nodeDetails.Text = $"进程数  {node.Count}\nPID  {node.Pid}\n内存  {node.Memory}\nCPU  {cpuPercent:0.0}%\n运行时长  {node.Uptime}";
            var postgres = snapshot.Postgres;
            postgresDetails.Text = $"进程数  {postgres.Count}\nPID  {postgres.Pid}\n内存  {postgres.Memory}\n运行时长  {postgres.Uptime}";
            var ips = snapshot.LanAddresses;
            var addresses = ips.Count == 0 ? "未检测到局域网 IPv4 地址" : string.Join(Environment.NewLine, ips.Select(ip => $"http://{ip}:{port}"));
            networkDetails.Text = $"监听地址  0.0.0.0:{port}\n本机地址  http://127.0.0.1:{port}\n局域网地址\n{addresses}\n本机端口  {(snapshot.PortListening ? "正在监听" : "未监听")}";
            pathDetails.Text = $"安装目录  {installRoot}\n数据目录  {dataRoot}\n日志目录  {Path.Combine(dataRoot, "logs")}\nWindows  {Environment.OSVersion.Version}";
            var allHealthy = snapshot.Runtime?.Ok == true && snapshot.ServiceState == "运行中" && snapshot.DatabaseState == "运行中" && snapshot.PortListening;
            alert.Severity = allHealthy ? InfoBarSeverity.Success : InfoBarSeverity.Warning;
            alert.Title = allHealthy ? "服务运行正常" : "部分组件需要检查";
            alert.Message = allHealthy ? $"Windows 服务、数据库、HTTP 接口和监听端口均正常。数据库响应 {snapshot.Runtime?.DatabaseLatencyMs ?? 0} ms。" : "详情显示了各组件状态；可通过系统服务管理和日志定位问题。";
            refreshed.Text = $"上次刷新：{snapshot.UpdatedAt.LocalDateTime:yyyy-MM-dd HH:mm:ss}";
        }
        catch (Exception exception)
        {
            alert.Severity = InfoBarSeverity.Error;
            alert.Title = "读取状态失败";
            alert.Message = exception.GetBaseException().Message;
            refreshed.Text = $"读取失败：{exception.GetBaseException().Message}";
            try
            {
                var diagnostic = Path.Combine(Path.GetTempPath(), "novora-runtime-monitor-error.log");
                File.AppendAllText(diagnostic, $"[{DateTime.Now:O}] {exception}\r\n");
            }
            catch { }
        }
        finally
        {
            if (showBusy && refreshButton is not null)
            {
                refreshButton.IsEnabled = true;
                refreshButton.Content = "立即刷新";
            }
            refreshGate.Release();
        }
    }

    internal void RefreshWhenActivated() => _ = RefreshAsync(false);

    private static Brush ThemeSurface()
    {
        try { return (Brush)Application.Current.Resources["LayerFillColorAltBrush"]; }
        catch { return new SolidColorBrush(Color.FromArgb(255, 244, 244, 244)); }
    }

    private static void SetWindowZOrder(WindowZOrder zOrder)
    {
        if (App.MainWindow is not RuntimeStatusWindow window) return;
        var hwnd = WindowNative.GetWindowHandle(window);
        SetWindowPos(hwnd, zOrder == WindowZOrder.TopMost ? HwndTopMost : HwndBottom, 0, 0, 0, 0,
            SwpNoMove | SwpNoSize | SwpShowWindow | (zOrder == WindowZOrder.TopMost ? 0u : SwpNoActivate));
    }

    private void OpenUrl(string url)
    {
        if (Host is not null) Host.OpenUrl(url);
        else Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }

    private static int ReadPort(string dataRoot)
    {
        try
        {
            var line = File.ReadLines(Path.Combine(dataRoot, "config", ".env")).FirstOrDefault(value => value.StartsWith("PORT=", StringComparison.OrdinalIgnoreCase));
            if (line is not null && int.TryParse(line[5..].Trim(), out var port)) return port;
        }
        catch { }
        return 3000;
    }

    private enum WindowZOrder { TopMost, Bottom }
    private static readonly IntPtr HwndTopMost = new(-1);
    private static readonly IntPtr HwndBottom = new(1);
    private const uint SwpNoSize = 0x0001;
    private const uint SwpNoMove = 0x0002;
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpShowWindow = 0x0040;
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);
}

public sealed class RuntimeStatusWindow : Window
{
    private readonly string installRoot = NovoraPaths.InstallRoot;
    private readonly RuntimeMonitorPage monitor;

    public RuntimeStatusWindow(PointInt32 cursor)
    {
        Title = "Novora · 运行状态";
        var hwnd = WindowNative.GetWindowHandle(this);
        var id = Win32Interop.GetWindowIdFromWindow(hwnd);
        var appWindow = AppWindow.GetFromWindowId(id);
        appWindow.Resize(new SizeInt32(760, 720));
        appWindow.IsShownInSwitchers = true;
        TrySetIcon(appWindow, installRoot);
        FluentUi.ApplyBackdrop(this);
        monitor = new RuntimeMonitorPage { Tag = this };
        Content = new Grid
        {
            RequestedTheme = ElementTheme.Light,
            Background = new SolidColorBrush(Color.FromArgb(0, 0, 0, 0)),
            Children = { new RuntimeStatusContent(monitor) }
        };
        PlaceWindow(appWindow, cursor, 760, 720, id);
    }

    public void ShowAt(PointInt32 cursor)
    {
        var hwnd = WindowNative.GetWindowHandle(this);
        var id = Win32Interop.GetWindowIdFromWindow(hwnd);
        var appWindow = AppWindow.GetFromWindowId(id);
        PlaceWindow(appWindow, cursor, 760, 720, id);
        ShowWindow(hwnd, 9);
        Activate();
        monitor.RefreshWhenActivated();
    }

    private static void TrySetIcon(AppWindow appWindow, string installRoot)
    {
        try
        {
            var icon = Path.Combine(installRoot, "favicon.ico");
            if (File.Exists(icon)) appWindow.SetIcon(icon);
        }
        catch { }
    }

    private static void PlaceWindow(AppWindow appWindow, PointInt32 cursor, int width, int height, WindowId id)
    {
        if (cursor.X == 0 && cursor.Y == 0) return;
        var display = DisplayArea.GetFromWindowId(id, DisplayAreaFallback.Primary);
        var area = display.WorkArea;
        var x = Math.Clamp(cursor.X - width, area.X, area.X + area.Width - width);
        var y = Math.Clamp(cursor.Y - height, area.Y, area.Y + area.Height - height);
        appWindow.Move(new PointInt32(x, y));
    }

    [DllImport("user32.dll", EntryPoint = "ShowWindow")]
    private static extern bool ShowWindow(IntPtr hwnd, int command);
}

internal sealed class RuntimeStatusContent : Grid
{
    public RuntimeStatusContent(RuntimeMonitorPage monitor)
    {
        Padding = new Thickness(22);
        RequestedTheme = ElementTheme.Light;
        Background = new SolidColorBrush(Color.FromArgb(255, 243, 243, 243));
        Children.Add(monitor);
    }
}

public sealed class TrayMenuWindow : Window
{
    private readonly string installRoot = NovoraPaths.InstallRoot;
    private readonly string dataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Novora");
    private readonly TextBlock summary = new() { Text = "正在读取服务状态…", TextWrapping = TextWrapping.Wrap };
    private readonly InfoBar status = new() { IsOpen = true, Severity = InfoBarSeverity.Informational, Title = "Novora 服务", Foreground = FluentUi.PrimaryBrush };
    private readonly SemaphoreSlim refreshGate = new(1, 1);
    private int serviceActionInProgress;
    private IntPtr windowHandle;
    private int port = 3000;

    private static void TrySetIcon(AppWindow appWindow, string installRoot)
    {
        try
        {
            var icon = Path.Combine(installRoot, "favicon.ico");
            if (File.Exists(icon)) appWindow.SetIcon(icon);
        }
        catch { }
    }

    public TrayMenuWindow(PointInt32 cursor)
    {
        Title = "Novora";
        var hwnd = WindowNative.GetWindowHandle(this);
        windowHandle = hwnd;
        var id = Win32Interop.GetWindowIdFromWindow(hwnd);
        var appWindow = AppWindow.GetFromWindowId(id);
        appWindow.Resize(new SizeInt32(360, 500));
        appWindow.IsShownInSwitchers = false;
        TrySetIcon(appWindow, installRoot);
        try { appWindow.SetPresenter(OverlappedPresenter.CreateForContextMenu()); } catch { }
        FluentUi.ApplyBackdrop(this);
        ReadPort();
        Content = Build();
        PlaceWindow(appWindow, cursor, 360, 500, id);
        Activated += (_, e) => { if (e.WindowActivationState == WindowActivationState.Deactivated) HideMenu(); };
        _ = RefreshAsync();
    }

    public void ShowAt(PointInt32 cursor)
    {
        var id = Win32Interop.GetWindowIdFromWindow(windowHandle);
        var appWindow = AppWindow.GetFromWindowId(id);
        PlaceWindow(appWindow, cursor, 360, 500, id);
        ShowWindow(windowHandle, 5);
        Activate();
        _ = RefreshAsync();
    }

    private void HideMenu()
    {
        var id = Win32Interop.GetWindowIdFromWindow(windowHandle);
        AppWindow.GetFromWindowId(id).Hide();
    }

    private UIElement Build()
    {
        var root = new Grid
        {
            RequestedTheme = ElementTheme.Light,
            Background = new SolidColorBrush(Color.FromArgb(255, 243, 243, 243))
        };
        var layout = new StackPanel { Padding = new Thickness(16), Spacing = 10, HorizontalAlignment = HorizontalAlignment.Stretch };
        var header = new Grid { ColumnSpacing = 12 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new ColumnDefinition());
        var image = new Image { Width = 40, Height = 40, VerticalAlignment = VerticalAlignment.Center };
        var iconPath = Path.Combine(installRoot, "assets", "icons", "favicon-64.png");
        if (File.Exists(iconPath)) image.Source = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(new Uri(iconPath));
        header.Children.Add(image);
        var titles = new StackPanel { Spacing = 3, VerticalAlignment = VerticalAlignment.Center };
        titles.Children.Add(new TextBlock { Text = "Novora", Style = (Style)Application.Current.Resources["SubtitleTextBlockStyle"], Foreground = FluentUi.PrimaryBrush });
        titles.Children.Add(FluentUi.Secondary("学校服务端"));
        Grid.SetColumn(titles, 1);
        header.Children.Add(titles);
        layout.Children.Add(header);
        layout.Children.Add(status);
        var summaryBorder = FluentUi.Card(summary, new Thickness(14));
        summary.FontSize = 14;
        summary.LineHeight = 24;
        summary.Foreground = FluentUi.SecondaryBrush;
        layout.Children.Add(summaryBorder);
        layout.Children.Add(Command("打开 Novora", "\uE8A7", () => OpenUrl($"http://127.0.0.1:{port}")));
        layout.Children.Add(Command("系统设置", "\uE713", () => Launch("--system-settings")));
        layout.Children.Add(Command("启动服务", "\uE768", () => _ = ServiceActionAsync("start")));
        layout.Children.Add(Command("重启服务", "\uE72C", () => _ = ServiceActionAsync("restart")));
        layout.Children.Add(Command("停止服务", "\uE71A", () => _ = ServiceActionAsync("stop")));
        var copy = new Button { Content = "复制局域网地址", MinHeight = 38, HorizontalAlignment = HorizontalAlignment.Stretch, Foreground = FluentUi.PrimaryBrush };
        copy.Click += async (_, _) =>
        {
            try
            {
                var address = WindowsDiagnostics.GetLanAddresses().FirstOrDefault();
                var data = new Windows.ApplicationModel.DataTransfer.DataPackage();
                data.SetText(address is null ? $"http://127.0.0.1:{port}" : $"http://{address}:{port}");
                Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(data);
                status.Title = "地址已复制";
                status.Severity = InfoBarSeverity.Success;
            }
            catch (Exception exception) { await ShowErrorAsync(exception.Message); }
        };
        layout.Children.Add(copy);
        root.Children.Add(new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Content = layout
        });
        return root;
    }

    private Button Command(string label, string glyph, Action action)
    {
        var button = new Button { MinHeight = 38, HorizontalContentAlignment = HorizontalAlignment.Stretch, Padding = new Thickness(10, 6, 12, 6), Foreground = FluentUi.PrimaryBrush };
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        row.Children.Add(new FontIcon { Glyph = glyph, FontSize = 16, Foreground = FluentUi.AccentBrush });
        row.Children.Add(new TextBlock { Text = label, VerticalAlignment = VerticalAlignment.Center, Foreground = FluentUi.PrimaryBrush });
        button.Content = row;
        button.Click += (_, _) => action();
        return button;
    }

    private async Task RefreshAsync()
    {
        if (!await refreshGate.WaitAsync(0)) return;
        try
        {
            var snapshot = await WindowsDiagnostics.GetStatusSnapshotAsync(installRoot, dataRoot, port);
            var ok = snapshot.Runtime?.Ok == true && snapshot.ServiceState == "运行中" && snapshot.DatabaseState == "运行中";
            status.Severity = ok ? InfoBarSeverity.Success : InfoBarSeverity.Warning;
            status.Title = ok ? "服务运行正常" : "服务需要检查";
            status.Message = $"最后检查：{snapshot.UpdatedAt.LocalDateTime:HH:mm:ss}";
            summary.Text = $"Novora  {snapshot.ServiceState}\nPostgreSQL  {snapshot.DatabaseState}\nNode.js  {(snapshot.Node.Count > 0 ? "运行中 · " + snapshot.Node.Memory : "未运行")}\n数据库响应  {snapshot.Runtime?.DatabaseLatencyMs.ToString() ?? "—"} ms\n端口  {port}\n本机地址  http://127.0.0.1:{port}";
        }
        catch (Exception exception)
        {
            status.Severity = InfoBarSeverity.Error;
            status.Title = "读取状态失败";
            status.Message = exception.Message;
            summary.Text = $"无法读取 Novora 状态\n端口  {port}\n本机地址  http://127.0.0.1:{port}";
        }
        finally { refreshGate.Release(); }
    }

    private void ReadPort()
    {
        try
        {
            var line = File.ReadLines(Path.Combine(dataRoot, "config", ".env")).FirstOrDefault(value => value.StartsWith("PORT=", StringComparison.OrdinalIgnoreCase));
            if (line is not null && int.TryParse(line[5..].Trim(), out var value)) port = value;
        }
        catch { }
    }

    private void Launch(string arguments)
    {
        try
        {
            App.ActivateArgumentsOnCurrentInstance(arguments);
            HideMenu();
        }
        catch (Exception exception) { _ = ShowErrorAsync(exception.Message); }
    }

    private void OpenUrl(string path)
    {
        try { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); Close(); }
        catch (Exception exception) { _ = ShowErrorAsync(exception.Message); }
    }

    private async Task ShowErrorAsync(string message)
    {
        var dialog = FluentUi.LightDialog(new ContentDialog { XamlRoot = ((FrameworkElement)Content).XamlRoot, Title = "Novora", Content = message, CloseButtonText = "确定" });
        await dialog.ShowAsync();
    }

    private async Task ServiceActionAsync(string action)
    {
        if (Interlocked.CompareExchange(ref serviceActionInProgress, 1, 0) != 0) return;
        try
        {
        if (action == "stop")
        {
                var dialog = FluentUi.LightDialog(new ContentDialog
                {
                    XamlRoot = ((FrameworkElement)Content).XamlRoot,
                    Title = "停止 Novora 服务？",
                    Content = "Novora、内嵌 Node.js 和 PostgreSQL 都会停止，局域网访问将暂时不可用。",
                    Foreground = FluentUi.PrimaryBrush,
                PrimaryButtonText = "停止服务",
                CloseButtonText = "取消",
                    DefaultButton = ContentDialogButton.Close
                });
            if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        }

        var script = action switch
        {
            "start" => "Start-Service -Name Novora",
            "restart" => "Restart-Service -Name Novora -Force",
            _ => $@"
$installRoot = '{installRoot.Replace("'", "''")}'
Stop-Service -Name Novora -Force -ErrorAction SilentlyContinue
Stop-Service -Name NovoraPostgreSQL -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
$rootPrefix = ([IO.Path]::GetFullPath($installRoot)).TrimEnd('\') + '\'
Get-CimInstance Win32_Process -Filter ""Name = 'node.exe' OR Name = 'postgres.exe' OR Name = 'pg_ctl.exe'"" -ErrorAction SilentlyContinue |
  Where-Object {{ ($_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath)).StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) -or ($_.CommandLine -and $_.CommandLine.IndexOf($installRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0) }} |
  ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}"
        };
        try
        {
            var encoded = Convert.ToBase64String(System.Text.Encoding.Unicode.GetBytes(script));
            Process.Start(new ProcessStartInfo("powershell.exe")
            {
                UseShellExecute = true,
                Verb = "runas",
                WindowStyle = ProcessWindowStyle.Hidden,
                ArgumentList = { "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded }
            });
            status.Title = action == "stop" ? "停止命令已发送" : action == "restart" ? "重启命令已发送" : "启动命令已发送";
            status.Severity = InfoBarSeverity.Informational;
            await Task.Delay(1800);
            await RefreshAsync();
        }
        catch (Exception exception) { await ShowErrorAsync(exception.Message); }
        }
        finally { Interlocked.Exchange(ref serviceActionInProgress, 0); }
    }

    private static void PlaceWindow(AppWindow appWindow, PointInt32 cursor, int width, int height, WindowId id)
    {
        if (cursor.X == 0 && cursor.Y == 0) return;
        var area = DisplayArea.GetFromWindowId(id, DisplayAreaFallback.Primary).WorkArea;
        var x = Math.Clamp(cursor.X - width, area.X, area.X + area.Width - width);
        var y = Math.Clamp(cursor.Y - height, area.Y, area.Y + area.Height - height);
        appWindow.Move(new PointInt32(x, y));
    }

    [DllImport("user32.dll", EntryPoint = "ShowWindow")]
    private static extern bool ShowWindow(IntPtr hwnd, int command);
}
