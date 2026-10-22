using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Security.Principal;
using System.Windows;
using System.Windows.Shell;

namespace Novora.ControlCenter;

public partial class App : Application
{
    private Mutex? instanceMutex;
    private bool ownsMutex;
    private readonly CancellationTokenSource lifetime = new();
    private static readonly string UserKey = WindowsIdentity.GetCurrent().User?.Value ?? Environment.UserName;
    private static readonly string PipeName = $"Novora.ControlCenter.{UserKey}.{Process.GetCurrentProcess().SessionId}";

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        try
        {
            if (e.Args.Contains("--tray-host", StringComparer.OrdinalIgnoreCase))
            {
                var tray = Path.Combine(Runtime.Root, "tray", "NovoraTray.exe");
                if (!File.Exists(tray)) throw new FileNotFoundException("找不到托盘程序，请重新安装完整安装包。", tray);
                Process.Start(new ProcessStartInfo(tray) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(tray)! });
                Shutdown();
                return;
            }

            var page = ResolvePage(e.Args);
            instanceMutex = new Mutex(false, $@"Local\Novora.ControlCenter.{UserKey}");
            ownsMutex = TryAcquireInstanceMutex();
            if (!ownsMutex && await SendPageRequestAsync(page))
            {
                Shutdown();
                return;
            }
            if (!ownsMutex)
            {
                // The activation pipe did not answer. That means the lock holder is exiting right
                // now or its listener is gone, not that this process failed to start, so try to
                // become the instance instead. If the lock is still held, the operator already has
                // a window; leave quietly rather than reporting a startup failure.
                ownsMutex = TryAcquireInstanceMutex();
                if (!ownsMutex)
                {
                    Trace.WriteLine("Novora control center: a running instance holds the single-instance lock but its activation pipe did not answer; this launch did nothing.");
                    Shutdown();
                    return;
                }
            }

            var window = new MainWindow(page);
            MainWindow = window;
            window.Show();
            ConfigureTaskbarTasks();
            _ = ListenAsync(window, lifetime.Token)
                .ContinueWith(task => Trace.WriteLine("Novora control center listener terminated: " + task.Exception), TaskContinuationOptions.OnlyOnFaulted);
        }
        catch (Exception exception)
        {
            MessageBox.Show($"控制中心未能启动：{exception.Message}", "Novora", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    private void ConfigureTaskbarTasks()
    {
        // Shell policy may disable jump lists; it must not prevent the control center from opening.
        try
        {
            var executable = Environment.ProcessPath;
            if (string.IsNullOrEmpty(executable)) return;
            var list = new JumpList { ShowRecentCategory = false, ShowFrequentCategory = false };
            foreach (var (title, arguments) in new[]
            {
                ("运行总览", "--overview"), ("Windows 初始化", "--windows-setup"),
                ("Windows 设置", "--system-settings"), ("软件更新", "--updates"),
                ("服务日志", "--logs"), ("数据备份", "--backups")
            })
                list.JumpItems.Add(new JumpTask { Title = title, Description = "打开 Novora · " + title,
                    ApplicationPath = executable, Arguments = arguments, WorkingDirectory = Runtime.Root,
                    IconResourcePath = executable, IconResourceIndex = 0 });
            JumpList.SetJumpList(this, list);
            list.Apply();
        }
        catch (Exception exception) when (exception is InvalidOperationException or System.Runtime.InteropServices.COMException)
        {
            Debug.WriteLine("Taskbar shortcuts unavailable: " + exception.Message);
        }
    }

    private bool TryAcquireInstanceMutex()
    {
        if (instanceMutex is null) return false;
        // A holder that terminated without releasing abandons the mutex; the wait still grants ownership.
        try { return instanceMutex.WaitOne(0); }
        catch (AbandonedMutexException) { return true; }
    }

    private static async Task<bool> SendPageRequestAsync(string page)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            await client.ConnectAsync(3000);
            await using var writer = new StreamWriter(client) { AutoFlush = true };
            await writer.WriteLineAsync(page);
            return true;
        }
        catch (Exception exception) when (exception is IOException or OperationCanceledException or UnauthorizedAccessException or TimeoutException)
        {
            Trace.WriteLine("Novora control center: page request did not reach the running instance: " + exception.Message);
            return false;
        }
    }

    private async Task ListenAsync(MainWindow window, CancellationToken cancellationToken)
    {
        var consecutiveFailures = 0;
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await ServePageRequestAsync(window, cancellationToken);
                consecutiveFailures = 0;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { return; }
            catch (Exception exception)
            {
                // One damaged request must not disable activation for the rest of the process
                // lifetime; back off so a persistently unavailable pipe cannot spin this loop.
                consecutiveFailures++;
                Trace.WriteLine($"Novora control center: activation round failed, listener restarted after back-off ({consecutiveFailures}): {exception}");
                try { await Task.Delay(TimeSpan.FromMilliseconds(Math.Min(consecutiveFailures * 500, 5000)), cancellationToken); }
                catch (OperationCanceledException) { return; }
            }
        }
    }

    private async Task ServePageRequestAsync(MainWindow window, CancellationToken cancellationToken)
    {
        using var server = new NamedPipeServerStream(PipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
        await server.WaitForConnectionAsync(cancellationToken);
        using var reader = new StreamReader(server);
        using var requestTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        requestTimeout.CancelAfter(TimeSpan.FromSeconds(2));
        var buffer = new char[1];
        var request = new System.Text.StringBuilder(16);
        while (request.Length < 16 && await reader.ReadAsync(buffer.AsMemory(), requestTimeout.Token) > 0)
        {
            if (buffer[0] == '\n') break;
            request.Append(buffer[0]);
        }
        var page = request.ToString().Trim();
        await Dispatcher.InvokeAsync(() => window.ShowPage(page));
    }

    private static string ResolvePage(string[] args)
    {
        bool Has(string flag) => args.Contains(flag, StringComparer.OrdinalIgnoreCase);
        if (Has("--windows-setup")) return "setup";
        if (Has("--system-settings")) return "settings";
        if (Has("--updates")) return "updates";
        if (Has("--logs")) return "logs";
        if (Has("--backups")) return "backups";
        if (Has("--overview") || Has("--status-window") || Has("--tray-menu")) return "overview";
        try
        {
            using var state = System.Text.Json.JsonDocument.Parse(File.ReadAllText(Path.Combine(Runtime.Data, "config", "windows-initialized.json")));
            return state.RootElement.TryGetProperty("completed", out var value) && value.ValueKind == System.Text.Json.JsonValueKind.True ? "overview" : "setup";
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Text.Json.JsonException) { return "setup"; }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        lifetime.Cancel();
        if (ownsMutex) instanceMutex?.ReleaseMutex();
        instanceMutex?.Dispose();
        lifetime.Dispose();
        base.OnExit(e);
    }
}
