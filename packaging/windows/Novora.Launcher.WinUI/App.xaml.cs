using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Windows.Graphics;
using WinRT.Interop;

namespace Novora.Launcher.WinUI;

public partial class App : Application
{
    private const string MutexName = @"Local\Novora.UIHost.SingleInstance";
    private const string PipeName = "Novora.UIHost.Activation";
    private static Mutex? instanceMutex;
    private static bool isPrimaryInstance;
    private static DispatcherQueue? dispatcherQueue;
    private static NativeTrayIcon? trayIcon;
    private static TrayMenuWindow? trayMenuWindow;
    private static RuntimeStatusWindow? statusWindow;
    private static LauncherMode? mainWindowMode;

    public static Window? MainWindow { get; private set; }

    public App()
    {
        instanceMutex = new Mutex(false, MutexName);
        try { isPrimaryInstance = instanceMutex.WaitOne(0); }
        catch (AbandonedMutexException) { isPrimaryInstance = true; }

        if (!isPrimaryInstance)
        {
            var request = Environment.GetCommandLineArgs().Skip(1).ToArray();
            var delivered = TrySendActivationRequest(request);
            if (!delivered)
            {
                MessageBoxW(IntPtr.Zero,
                    "Novora 正在启动或响应中。请稍候片刻再试；本次请求已合并到现有进程。",
                    "Novora", 0x40);
            }
            Environment.Exit(0);
            return;
        }

        InitializeComponent();
        dispatcherQueue = DispatcherQueue.GetForCurrentThread();
        _ = RunActivationServerAsync();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        if (!isPrimaryInstance) return;
        try
        {
            var launchArgs = Environment.GetCommandLineArgs().Skip(1).ToArray();
            ActivateRequest(launchArgs);
        }
        catch (Exception exception)
        {
            File.WriteAllText(Path.Combine(Path.GetTempPath(), "novora-winui-startup-error.txt"), exception.ToString());
            MessageBoxW(IntPtr.Zero, exception.ToString(), "Novora 启动错误", 0x10);
        }
    }

    internal static void ActivateRequest(IEnumerable<string> requestedArguments)
    {
        var launchArgs = requestedArguments.ToArray();
        EnsureTrayIcon();

        if (HasArgument(launchArgs, "--tray-host")) return;
        if (HasArgument(launchArgs, "--tray-menu"))
        {
            var cursor = ParseCoordinates(launchArgs);
            trayMenuWindow ??= CreateTrayMenuWindow();
            trayMenuWindow.ShowAt(cursor);
            return;
        }

        if (HasArgument(launchArgs, "--status-window"))
        {
            var cursor = ParseCoordinates(launchArgs);
            statusWindow ??= CreateStatusWindow(cursor);
            statusWindow.ShowAt(cursor);
            return;
        }

        var dataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Novora");
        var statePath = Path.Combine(dataRoot, "config", "windows-initialized.json");
        var setupRequested = HasArgument(launchArgs, "--windows-setup");
        var maintenanceRequested = HasArgument(launchArgs, "--system-settings");
        var stateMatchesInstall = IsInitializedForInstall(statePath, NovoraPaths.InstallRoot);
        var mode = setupRequested || (!maintenanceRequested && !stateMatchesInstall)
            ? LauncherMode.Setup
            : LauncherMode.Maintenance;

        if (MainWindow is not null && mainWindowMode == mode)
        {
            ShowWindow(MainWindow);
            return;
        }

        MainWindow?.Close();
        MainWindow = new MainWindow(mode);
        mainWindowMode = mode;
        MainWindow.Closed += (_, _) =>
        {
            MainWindow = null;
            mainWindowMode = null;
        };
        ShowWindow(MainWindow);
    }

    internal static void ActivateArgumentsOnCurrentInstance(string arguments)
    {
        var values = arguments.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        ActivateRequest(values);
    }

    private static TrayMenuWindow CreateTrayMenuWindow()
    {
        var window = new TrayMenuWindow(new PointInt32(0, 0));
        window.Closed += (_, _) => trayMenuWindow = null;
        return window;
    }

    private static RuntimeStatusWindow CreateStatusWindow(PointInt32 cursor)
    {
        var window = new RuntimeStatusWindow(cursor);
        window.Closed += (_, _) => statusWindow = null;
        return window;
    }

    private static void EnsureTrayIcon()
    {
        if (trayIcon is not null) return;
        var iconPath = Path.Combine(NovoraPaths.InstallRoot, "favicon.ico");
        trayIcon = new NativeTrayIcon(iconPath, (command, cursor) =>
        {
            switch (command)
            {
                case TrayIconCommand.OpenMenu:
                    trayMenuWindow ??= CreateTrayMenuWindow();
                    trayMenuWindow.ShowAt(cursor);
                    break;
                case TrayIconCommand.OpenStatus:
                    statusWindow ??= CreateStatusWindow(cursor);
                    statusWindow.ShowAt(cursor);
                    break;
                case TrayIconCommand.OpenApplication:
                    ActivateRequest(Array.Empty<string>());
                    break;
            }
        });
    }

    private static void ShowWindow(Window window)
    {
        var handle = WindowNative.GetWindowHandle(window);
        ShowWindowNative(handle, 9);
        window.Activate();
        SetForegroundWindow(handle);
    }

    private static async Task RunActivationServerAsync()
    {
        while (true)
        {
            try
            {
                using var pipe = new NamedPipeServerStream(
                    PipeName,
                    PipeDirection.In,
                    8,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync();
                using var reader = new StreamReader(pipe, Encoding.UTF8, false, 1024, leaveOpen: true);
                var message = await reader.ReadLineAsync();
                if (string.IsNullOrWhiteSpace(message)) continue;
                var request = JsonSerializer.Deserialize<string[]>(message);
                if (request is null) continue;
                dispatcherQueue?.TryEnqueue(() =>
                {
                    try { ActivateRequest(request); }
                    catch (Exception exception)
                    {
                        File.AppendAllText(Path.Combine(Path.GetTempPath(), "novora-winui-startup-error.txt"),
                            $"[{DateTime.Now:O}] {exception}{Environment.NewLine}");
                    }
                });
            }
            catch (Exception exception)
            {
                try
                {
                    File.AppendAllText(Path.Combine(Path.GetTempPath(), "novora-winui-pipe-error.txt"),
                        $"[{DateTime.Now:O}] {exception}{Environment.NewLine}");
                }
                catch { }
                await Task.Delay(300);
            }
        }
    }

    private static bool TrySendActivationRequest(string[] request)
    {
        var message = JsonSerializer.Serialize(request);
        for (var attempt = 0; attempt < 16; attempt++)
        {
            try
            {
                using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out, PipeOptions.None);
                client.Connect(250);
                using var writer = new StreamWriter(client, new UTF8Encoding(false), 1024, leaveOpen: true) { AutoFlush = true };
                writer.WriteLine(message);
                return true;
            }
            catch (TimeoutException) { Thread.Sleep(100); }
            catch (IOException) { Thread.Sleep(100); }
            catch (UnauthorizedAccessException) { return false; }
        }
        return false;
    }

    private static bool IsInitializedForInstall(string statePath, string installRoot)
    {
        if (!File.Exists(statePath)) return false;
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(statePath));
            if (!document.RootElement.TryGetProperty("completed", out var completed) || completed.ValueKind != JsonValueKind.True) return false;
            if (!document.RootElement.TryGetProperty("installRoot", out var savedRoot) || savedRoot.ValueKind != JsonValueKind.String) return false;
            return string.Equals(Path.GetFullPath(savedRoot.GetString() ?? string.Empty).TrimEnd(Path.DirectorySeparatorChar),
                Path.GetFullPath(installRoot).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    private static bool HasArgument(IEnumerable<string> args, string argument) =>
        args.Contains(argument, StringComparer.OrdinalIgnoreCase);

    private static PointInt32 ParseCoordinates(string[] args) => new(ReadArgument(args, "--x"), ReadArgument(args, "--y"));

    private static int ReadArgument(string[] args, string name)
    {
        var index = Array.FindIndex(args, value => string.Equals(value, name, StringComparison.OrdinalIgnoreCase));
        return index >= 0 && index + 1 < args.Length && int.TryParse(args[index + 1], out var value) ? value : 0;
    }

    [DllImport("user32.dll", EntryPoint = "ShowWindow")]
    private static extern bool ShowWindowNative(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);
}
