using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Novora.ControlCenter;

static void Check(bool condition, string name)
{
    if (!condition) throw new Exception("FAIL: " + name);
    Console.WriteLine("PASS: " + name);
}

Check(Runtime.ParsePort(new[] { "DATABASE_URL=private", "PORT='3111'" }) == 3111, "Configured port");
Check(Runtime.ParsePort(new[] { "PORT=99999" }) == 3000, "Invalid port fallback");
var path = Path.Combine(Path.GetTempPath(), "novora-log-test-" + Guid.NewGuid().ToString("N"));
try
{
    File.WriteAllLines(path, Enumerable.Range(0, 1000).Select(x => $"日志 {x}: " + new string('x', 500)), Encoding.UTF8);
    var tail = Runtime.ReadLogTail(path);
    Check(tail.Length <= 300 && tail[^1].StartsWith("日志 999:") && tail.Sum(x => Encoding.UTF8.GetByteCount(x)) <= 128 * 1024, "Large log has bounded tail and latest entry");
    File.WriteAllLines(path, Enumerable.Range(0, 400).Select(x => x.ToString()));
    tail = Runtime.ReadLogTail(path);
    Check(tail.Length == 300 && tail[0] == "100" && tail[^1] == "399", "Log line limit");
}
finally { File.Delete(path); }

async Task<(bool Healthy, string Detail, string Version)> Health(string body, bool stall = false, CancellationToken cancellationToken = default)
{
    using var listener = new TcpListener(IPAddress.Loopback, 0);
    listener.Start();
    var port = ((IPEndPoint)listener.LocalEndpoint).Port;
    using var stop = new CancellationTokenSource();
    var server = Task.Run(async () =>
    {
        using var client = await listener.AcceptTcpClientAsync(stop.Token);
        await using var stream = client.GetStream();
        var request = new byte[4096];
        await stream.ReadAsync(request, stop.Token);
        var data = Encoding.UTF8.GetBytes(body);
        var header = Encoding.ASCII.GetBytes($"HTTP/1.1 200 OK\r\nContent-Length: {(stall ? 100 : data.Length)}\r\nConnection: close\r\n\r\n");
        await stream.WriteAsync(header, stop.Token);
        if (stall) await Task.Delay(Timeout.Infinite, stop.Token);
        else await stream.WriteAsync(data, stop.Token);
    });
    try { return await Runtime.ReadHealthAsync(port, cancellationToken); }
    finally
    {
        stop.Cancel();
        try { await server; } catch (OperationCanceledException) { }
    }
}

Check((await Health("{\"ok\":true,\"version\":\"test\"}")).Healthy, "Healthy JSON response");
Check(!(await Health("<html>error</html>")).Healthy, "Invalid JSON rejected");
Check((await Health(new string('x', 17 * 1024))).Detail == "健康响应过大", "Health body size limit");
var watch = Stopwatch.StartNew();
Check((await Health("", stall: true)).Detail == "健康检查超时" && watch.Elapsed < TimeSpan.FromSeconds(5), "Stalled body deadline");
using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));
try { await Health("", stall: true, cancel.Token); throw new Exception("Cancellation ignored"); }
catch (OperationCanceledException) { Check(true, "Shutdown cancels pending health request"); }

var progressPath = Path.Combine(Path.GetTempPath(), "novora-progress-test-" + Guid.NewGuid().ToString("N"));
try
{
    File.WriteAllText(progressPath, "{\"stage\":\"database\",\"item\":\"等待数据库\",\"status\":\"running\",\"current\":0,\"total\":null,\"elapsedSeconds\":7,\"timeoutSeconds\":30}");
    Check(Runtime.TryReadProgress(progressPath, out var progress) && progress.Total is null && progress.Item == "等待数据库" && progress.TimeoutSeconds == 30, "Unknown duration progress does not fabricate a percentage");
    File.WriteAllText(progressPath, "{\"stage\":");
    Check(!Runtime.TryReadProgress(progressPath, out _), "Partial progress snapshot ignored");
    File.WriteAllText(progressPath, "{\"current\":null}");
    Check(!Runtime.TryReadProgress(progressPath, out _), "Malformed progress field ignored");
    File.WriteAllText(progressPath, new string('x', 17000));
    Check(!Runtime.TryReadProgress(progressPath, out _), "Oversized progress snapshot ignored");
}
finally { File.Delete(progressPath); }


InspectionResult InspectFixture(bool corePresent, string serviceState = "未安装", bool optionalPresent = true)
{
    var payload = System.Text.Json.JsonSerializer.Serialize(new {
        service = new { state = serviceState }, database = new { state = "未安装" },
        files = new[] { new { name = "runtime/node.exe", exists = corePresent, required = true }, new { name = "tray/NovoraTray.exe", exists = optionalPresent, required = false } },
        initialized = false, lanAccess = (bool?)null, backupDaily = (bool?)false, warnings = Array.Empty<string>()
    });
    using var document = System.Text.Json.JsonDocument.Parse(payload);
    return InspectionResult.From(document.RootElement);
}
Check(InspectFixture(true).CanContinue && InspectFixture(true).Items[0].Status == "待初始化", "Missing services allow first initialization");
Check(!InspectFixture(false).CanContinue && InspectFixture(false).Items.Any(x => x.Blocking && x.Status == "需要处理"), "Missing core file blocks initialization");
Check(!InspectFixture(true, "无法读取").CanContinue, "Unreadable service state requires retry");
Check(InspectFixture(true, optionalPresent: false).CanContinue, "Optional tray and unreadable optional settings do not block initialization");
