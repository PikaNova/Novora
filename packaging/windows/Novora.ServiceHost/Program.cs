using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Novora.Update;
using Novora.ServiceHost;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(options => options.ServiceName = "Novora");
builder.Services.AddSingleton<NovoraRuntime>();
builder.Services.AddHostedService<ServiceWorker>();

using var host = builder.Build();
await host.RunAsync();

sealed class ServiceWorker : BackgroundService
{
    private readonly NovoraRuntime runtime;
    private readonly ILogger<ServiceWorker> logger;

    public ServiceWorker(NovoraRuntime runtime, ILogger<ServiceWorker> logger)
    {
        this.runtime = runtime;
        this.logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await runtime.StartAsync(stoppingToken);
        var failures = 0;
        var restartFailures = 0;
        var checkInterval = TimeSpan.FromSeconds(30);
        var restartBackoff = new[] { 5, 15, 30 };
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                await Task.Delay(checkInterval, stoppingToken);
                if (await runtime.CheckHealthAsync(stoppingToken))
                {
                    failures = 0;
                    restartFailures = 0;
                    checkInterval = TimeSpan.FromSeconds(30);
                    continue;
                }

                failures++;
                if (failures == 1 || failures % 6 == 0)
                    logger.LogWarning("Novora health check failed ({FailureCount} consecutive checks)", failures);

                if (runtime.IsNodeRunning && failures < 3)
                {
                    checkInterval = TimeSpan.FromSeconds(failures == 1 ? 10 : 5);
                    continue;
                }

                var delaySeconds = restartBackoff[Math.Min(restartFailures, restartBackoff.Length - 1)];
                restartFailures++;
                logger.LogWarning("Restarting Novora Node process after {DelaySeconds}s backoff", delaySeconds);
                await Task.Delay(TimeSpan.FromSeconds(delaySeconds), stoppingToken);
                try
                {
                    await runtime.RestartAsync(stoppingToken);
                    failures = 0;
                    checkInterval = TimeSpan.FromSeconds(30);
                }
                catch (Exception exception)
                {
                    logger.LogError(exception, "Unable to restart Novora Node process");
                    checkInterval = TimeSpan.FromSeconds(5);
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
        finally
        {
            await runtime.StopAsync();
            logger.LogInformation("Novora service stopped");
        }
    }
}

sealed class NovoraRuntime
{
    private readonly ILogger<NovoraRuntime> logger;
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(5) };
    private Process? process;
    private ServiceLogWriter? logWriter;
    private string appRoot = "";
    private string nodePath = "";
    private string envFile = "";
    private int port = 3000;
    private int nodeHeapLimitMb = 512;

    public NovoraRuntime(ILogger<NovoraRuntime> logger) => this.logger = logger;

    public Task StartAsync(CancellationToken cancellationToken)
    {
        appRoot = GetArgument("--app-root") ?? AppContext.BaseDirectory;
        nodePath = GetArgument("--node-path") ?? Path.Combine(appRoot, "runtime", "node.exe");
        envFile = GetArgument("--env-file") ?? Path.Combine(appRoot, "config", ".env");
        var entrypoint = GetArgument("--entrypoint") ?? Path.Combine(appRoot, "server-build", "server", "serve.js");
        var updateState = Path.Combine(appRoot, "updater", "state.json");
        if (UpdateStartGate.ReadState(updateState) is { } state && UpdateStartGate.BlocksStart(state.Phase))
            throw new InvalidOperationException($"Application update is incomplete ({state.Phase}); recover it in Windows settings before starting the service.");
        if (File.Exists(Path.Combine(appRoot, "active-version.json")))
        {
            var active = UpdateEngine.ReadActive(appRoot);
            appRoot = Path.GetFullPath(Path.Combine(appRoot, active.Directory));
            entrypoint = Path.Combine(appRoot, "server-build", "server", "serve.js");
        }
        var environment = LoadEnvironment(envFile);
        if (environment.TryGetValue("PORT", out var configuredPort) && int.TryParse(configuredPort, out var parsedPort))
            port = parsedPort;

        if (!File.Exists(nodePath)) throw new FileNotFoundException("Node runtime not found", nodePath);
        if (!File.Exists(entrypoint)) throw new FileNotFoundException("Novora server entrypoint not found", entrypoint);

        var logDirectory = environment.TryGetValue("NOVORA_LOG_DIR", out var configuredLogDirectory)
            ? configuredLogDirectory
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Novora", "logs");
        Directory.CreateDirectory(logDirectory);
        var logPath = Path.Combine(logDirectory, "novora-service.log");

        var startInfo = new ProcessStartInfo
        {
            FileName = nodePath,
            WorkingDirectory = appRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var item in environment) startInfo.Environment[item.Key] = item.Value;
        startInfo.Environment["NODE_ENV"] = "production";
        nodeHeapLimitMb = ResolveNodeHeapLimitMb(environment);
        startInfo.ArgumentList.Add($"--max-old-space-size={nodeHeapLimitMb}");
        startInfo.ArgumentList.Add(entrypoint);

        // Capture the instance in a local: StopAsync disposes and clears the
        // shared field, and Exited fires on a thread-pool thread at any time.
        var nodeProcess = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        var log = new ServiceLogWriter(logPath);
        logWriter = log;
        nodeProcess.OutputDataReceived += (_, eventArgs) => log.Append(eventArgs.Data);
        nodeProcess.ErrorDataReceived += (_, eventArgs) => log.Append(eventArgs.Data);
        nodeProcess.Exited += (_, _) =>
        {
            try { logger.LogWarning("Novora Node process exited with code {Code}", nodeProcess.ExitCode); }
            catch (Exception exception) { logger.LogDebug(exception, "Unable to read Novora Node exit code"); }
        };
        process = nodeProcess;
        nodeProcess.Start();
        nodeProcess.BeginOutputReadLine();
        nodeProcess.BeginErrorReadLine();
        logger.LogInformation("Novora Node process started with PID {Pid} on port {Port}; V8 heap limit {HeapLimitMb} MB", nodeProcess.Id, port, nodeHeapLimitMb);
        return Task.CompletedTask;
    }

    public bool IsNodeRunning => process is not null && !process.HasExited;

    public async Task<bool> CheckHealthAsync(CancellationToken cancellationToken)
    {
        if (!IsNodeRunning)
        {
            logger.LogWarning("Novora Node process is not running");
            return false;
        }

        try
        {
            using var response = await http.GetAsync($"http://127.0.0.1:{port}/api/health", cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Novora health check returned HTTP {StatusCode}", (int)response.StatusCode);
                return false;
            }
            return true;
        }
        catch (HttpRequestException exception)
        {
            logger.LogWarning("Novora health check failed: {Message}", exception.Message);
            return false;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("Novora health check timed out");
            return false;
        }
    }

    public async Task RestartAsync(CancellationToken cancellationToken)
    {
        await StopAsync();
        cancellationToken.ThrowIfCancellationRequested();
        await StartAsync(cancellationToken);
    }

    public Task StopAsync()
    {
        try
        {
            if (process is null || process.HasExited) return Task.CompletedTask;
            if (process is not null && !process.HasExited)
            {
                process.Kill(entireProcessTree: true);
                process.WaitForExit(10_000);
            }
        }
        catch (Exception exception)
        {
            logger.LogWarning("Unable to stop Novora Node process cleanly: {Message}", exception.Message);
        }
        finally
        {
            process?.Dispose();
            process = null;
            var log = logWriter;
            logWriter = null;
            log?.Dispose();
        }
        return Task.CompletedTask;
    }

    private string? GetArgument(string name)
    {
        for (var index = 0; index < Environment.GetCommandLineArgs().Length - 1; index++)
            if (string.Equals(Environment.GetCommandLineArgs()[index], name, StringComparison.OrdinalIgnoreCase))
                return Environment.GetCommandLineArgs()[index + 1];
        return null;
    }

    private static Dictionary<string, string> LoadEnvironment(string path)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (!File.Exists(path)) return values;
        foreach (var rawLine in File.ReadLines(path))
        {
            var line = rawLine.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;
            var separator = line.IndexOf('=');
            if (separator <= 0) continue;
            var key = line[..separator].Trim();
            var value = line[(separator + 1)..].Trim().Trim('"', '\'');
            values[key] = value;
        }
        return values;
    }

    private static int ResolveNodeHeapLimitMb(IReadOnlyDictionary<string, string> environment)
    {
        if (environment.TryGetValue("NOVORA_NODE_MAX_OLD_SPACE_MB", out var configured)
            && int.TryParse(configured, out var requested))
            return Math.Clamp(requested, 128, 4096);

        var memoryBytes = GC.GetGCMemoryInfo().TotalAvailableMemoryBytes;
        var memoryGb = memoryBytes / 1024d / 1024d / 1024d;
        if (memoryGb <= 6) return 256;
        if (memoryGb <= 12) return 512;
        return 768;
    }
}
