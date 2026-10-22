using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Unicode;

namespace Novora.ControlCenter;

internal sealed record ServiceSnapshot(string State, uint ProcessId);
internal sealed record RuntimeSnapshot(ServiceSnapshot Service, ServiceSnapshot Database, bool Healthy, string HealthDetail,
    string Version, int Port, IReadOnlyList<string> LanAddresses, DateTimeOffset CheckedAt);
internal sealed record BackupFile(string Name, string Size, string Modified, string Kind);
internal sealed record OperationProgress(string Stage, string Item, string Status, int Current, int? Total,
    int ElapsedSeconds, int TimeoutSeconds, string Message);

internal static class Runtime
{
    private static readonly HttpClient Http = new(new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(3) };

    static Runtime() => Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

    public static string Root { get; } = Path.GetFullPath(Path.GetDirectoryName(Environment.ProcessPath) ?? AppContext.BaseDirectory).TrimEnd(Path.DirectorySeparatorChar);
    public static string Data { get; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Novora");

    public static bool InitializationCompleted()
    {
        try
        {
            var path = Path.Combine(Data, "config", "windows-initialized.json");
            if (new FileInfo(path).Length > 32 * 1024) return false;
            using var document = JsonDocument.Parse(File.ReadAllText(path));
            return document.RootElement.TryGetProperty("completed", out var completed) && completed.ValueKind == JsonValueKind.True;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException) { return false; }
    }

    public static async Task<RuntimeSnapshot> ReadAsync(CancellationToken cancellationToken)
    {
        var local = await Task.Run(() => (Port: ReadPort(), Service: ReadService("Novora"), Database: ReadService("NovoraPostgreSQL"), Lan: LanAddresses()), cancellationToken);
        var health = await ReadHealthAsync(local.Port, cancellationToken);
        return new(local.Service, local.Database, health.Healthy, health.Detail, health.Version, local.Port, local.Lan, DateTimeOffset.Now);
    }

    internal static async Task<(bool Healthy, string Detail, string Version)> ReadHealthAsync(int port, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(3));
        try
        {
            using var response = await Http.GetAsync($"http://127.0.0.1:{port}/api/health", HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (!response.IsSuccessStatusCode) return (false, $"HTTP {(int)response.StatusCode}", "未知");
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            var buffer = new byte[16 * 1024 + 1];
            var count = await stream.ReadAtLeastAsync(buffer, buffer.Length, throwOnEndOfStream: false, timeout.Token);
            if (count == buffer.Length) return (false, "健康响应过大", "未知");
            using var document = JsonDocument.Parse(buffer.AsMemory(0, count));
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return (false, "健康响应格式异常", "未知");
            var ok = root.TryGetProperty("ok", out var value) && value.ValueKind == JsonValueKind.True;
            var version = root.TryGetProperty("version", out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "未知" : "未知";
            return (ok, ok ? "健康检查通过" : "健康检查未通过", version);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (OperationCanceledException) { return (false, "健康检查超时", "未知"); }
        catch (HttpRequestException) { return (false, "无法连接本机服务", "未知"); }
        catch (JsonException) { return (false, "端口响应不是有效的健康信息", "未知"); }
        catch (IOException) { return (false, "读取健康响应失败", "未知"); }
    }

    public static int ReadPort()
    {
        try { return ParsePort(File.ReadLines(Path.Combine(Data, "config", ".env"))); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        foreach (var name in new[] { "runtime.json", "windows-initialized.json" })
        {
            try
            {
                using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(Data, "config", name)));
                if (document.RootElement.TryGetProperty("port", out var value) && value.TryGetInt32(out var port) && port is > 0 and <= 65535) return port;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException) { }
        }
        return 3000;
    }

    internal static int ParsePort(IEnumerable<string> lines)
    {
        var line = lines.FirstOrDefault(x => x.TrimStart().StartsWith("PORT=", StringComparison.OrdinalIgnoreCase));
        var text = line is null ? "" : line[(line.IndexOf('=') + 1)..].Trim().Trim('"', '\'');
        return int.TryParse(text, out var port) && port is > 0 and <= 65535 ? port : 3000;
    }

    public static async Task RunElevatedAsync(string command, CancellationToken cancellationToken = default,
        IProgress<OperationProgress>? progress = null, int timeoutSeconds = 1800)
    {
        var progressFile = progress is null ? null : Path.Combine(Path.GetTempPath(), $"novora-progress-{Guid.NewGuid():N}.json");
        var prefix = progressFile is null ? "" : "$env:NOVORA_PROGRESS_FILE=" + Quote(progressFile) + "; . " + Quote(Path.Combine(Root, "operation-progress.ps1")) + "; ";
        var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes("$ErrorActionPreference = 'Stop'; $global:LASTEXITCODE = 0; try { " + prefix + command + "; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; exit 0 } catch { if (Get-Command Write-NovoraProgress -ErrorAction SilentlyContinue) { Write-NovoraProgress -Stage operation -Item 操作失败 -Status failed -Message $_.Exception.Message }; Write-Error $_ -ErrorAction Continue; exit 1 }"));
        using var process = Process.Start(new ProcessStartInfo("powershell.exe")
        {
            UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden,
            ArgumentList = { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded }
        });
        if (process is null) throw new InvalidOperationException("无法启动管理员操作。");
        // Inner scripts bound each of their own waits; this bounds the whole elevated
        // operation so a hung child cannot pin the maintenance lock forever.
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));
        try
        {
            while (!process.HasExited)
            {
                if (progressFile is not null && TryReadProgress(progressFile, out var update)) progress!.Report(update);
                await Task.Delay(250, deadline.Token);
            }
            string? failureDetail = null;
            if (progressFile is not null && TryReadProgress(progressFile, out var final))
            {
                progress!.Report(final);
                if (final.Status == "failed" && !string.IsNullOrWhiteSpace(final.Message)) failureDetail = final.Message;
            }
            if (process.ExitCode != 0) throw new InvalidOperationException(failureDetail ?? $"操作失败（退出码 {process.ExitCode}）。请查看日志；界面没有将其标记为成功。");
        }
        catch (OperationCanceledException)
        {
            try { if (!process.HasExited) process.Kill(true); } catch (InvalidOperationException) { }
            if (cancellationToken.IsCancellationRequested) throw;
            throw new InvalidOperationException($"管理员操作超过 {timeoutSeconds} 秒仍未完成，已停止等待并结束其子进程。请查看日志后重试；维护锁已释放。");
        }
        finally
        {
            if (progressFile is not null) foreach (var path in new[] { progressFile, progressFile + ".tmp" })
                try { File.Delete(path); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }

    internal static bool TryReadProgress(string path, out OperationProgress progress)
    {
        progress = new("operation", "正在执行操作", "running", 0, null, 0, 0, "");
        try
        {
            if (new FileInfo(path).Length > 16 * 1024) return false;
            using var document = JsonDocument.Parse(File.ReadAllText(path));
            var root = document.RootElement;
            progress = new(
                root.TryGetProperty("stage", out var stage) ? stage.GetString() ?? "operation" : "operation",
                root.TryGetProperty("item", out var item) ? item.GetString() ?? "正在执行操作" : "正在执行操作",
                root.TryGetProperty("status", out var status) ? status.GetString() ?? "running" : "running",
                root.TryGetProperty("current", out var current) && current.TryGetInt32(out var c) ? c : 0,
                root.TryGetProperty("total", out var total) && total.ValueKind == JsonValueKind.Number && total.TryGetInt32(out var t) ? t : null,
                root.TryGetProperty("elapsedSeconds", out var elapsed) && elapsed.TryGetInt32(out var e) ? e : 0,
                root.TryGetProperty("timeoutSeconds", out var timeout) && timeout.TryGetInt32(out var seconds) ? seconds : 0,
                root.TryGetProperty("message", out var message) ? message.GetString() ?? "" : "");
            return true;
        }
        catch (IOException) { return false; }
        catch (JsonException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
        catch (InvalidOperationException) { return false; }
    }

    public static string Quote(string value) => "'" + value.Replace("'", "''") + "'";
    public static string LanUrl(RuntimeSnapshot snapshot) => $"http://{snapshot.LanAddresses.FirstOrDefault() ?? "127.0.0.1"}:{snapshot.Port}";

    public static string ProcessUptime(uint pid)
    {
        if (pid == 0) return "—";
        try
        {
            using var process = Process.GetProcessById(checked((int)pid));
            var elapsed = DateTime.Now - process.StartTime;
            return $"{(int)elapsed.TotalDays} 天 {elapsed.Hours} 小时 {elapsed.Minutes} 分钟";
        }
        catch (Exception e) when (e is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception or OverflowException) { return "无法读取"; }
    }

    private static ServiceSnapshot ReadService(string name)
    {
        var manager = OpenSCManager(null, null, 1);
        if (manager == IntPtr.Zero) return new("无法读取", 0);
        try
        {
            var service = OpenService(manager, name, 4);
            if (service == IntPtr.Zero) return new(Marshal.GetLastWin32Error() == 1060 ? "未安装" : "无读取权限", 0);
            try
            {
                var status = new ServiceStatus();
                if (!QueryServiceStatusEx(service, 0, ref status, (uint)Marshal.SizeOf<ServiceStatus>(), out _)) return new("无法读取", 0);
                return new(status.CurrentState switch { 1 => "已停止", 2 => "正在启动", 3 => "正在停止", 4 => "运行中", 5 => "正在继续", 6 => "正在暂停", 7 => "已暂停", _ => "状态未知" }, status.ProcessId);
            }
            finally { CloseServiceHandle(service); }
        }
        finally { CloseServiceHandle(manager); }
    }

    private static IReadOnlyList<string> LanAddresses()
    {
        try
        {
            return NetworkInterface.GetAllNetworkInterfaces()
                .Where(x => x.OperationalStatus == OperationalStatus.Up && x.NetworkInterfaceType is not NetworkInterfaceType.Loopback and not NetworkInterfaceType.Tunnel)
                .OrderByDescending(x => x.GetIPProperties().GatewayAddresses.Any())
                .SelectMany(x => x.GetIPProperties().UnicastAddresses.Select(y => y.Address))
                .Where(x => x.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(x) && !x.ToString().StartsWith("169.254.", StringComparison.Ordinal))
                .Select(x => x.ToString()).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        }
        catch (NetworkInformationException) { return Array.Empty<string>(); }
    }

    public static string[] ReadLogTail(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var length = stream.Length;
        var header = new byte[4];
        var headerLength = stream.Read(header, 0, header.Length);
        stream.Position = 0;
        var knownEncoding = DetectLogBom(header.AsSpan(0, headerLength));
        var skipFirst = length > 128 * 1024;
        var start = skipFirst ? length - 128 * 1024 : 0;
        // A UTF-16 tail must start on a code-unit boundary, not inside a surrogate.
        if (knownEncoding is UnicodeEncoding && (start & 1) != 0) start++;
        stream.Seek(start, SeekOrigin.Begin);
        var buffer = new byte[(int)(length - start)];
        var count = stream.ReadAtLeast(buffer, buffer.Length, throwOnEndOfStream: false);
        var encoding = knownEncoding ?? DetectLogEncoding(buffer.AsSpan(0, count), skipFirst);
        var text = encoding.GetString(buffer, 0, count);
        if (text.StartsWith('\uFEFF')) text = text[1..];
        using var reader = new StringReader(text);
        if (skipFirst) reader.ReadLine();
        var lines = new Queue<string>(300);
        while (reader.ReadLine() is { } line) { if (lines.Count == 300) lines.Dequeue(); lines.Enqueue(line); }
        return lines.ToArray();
    }

    private static Encoding? DetectLogBom(ReadOnlySpan<byte> header) =>
        header.Length >= 3 && header[0] == 0xEF && header[1] == 0xBB && header[2] == 0xBF ? new UTF8Encoding(false) :
        header.Length >= 2 && header[0] == 0xFF && header[1] == 0xFE ? Encoding.Unicode :
        header.Length >= 2 && header[0] == 0xFE && header[1] == 0xFF ? Encoding.BigEndianUnicode : null;

    private static Encoding DetectLogEncoding(ReadOnlySpan<byte> bytes, bool trimmed)
    {
        // BOM-less UTF-16: alternating NUL bytes are the reliable signal.
        if (bytes.Length >= 4 && bytes[1] == 0 && bytes[3] == 0 && bytes[0] != 0) return Encoding.Unicode;
        if (bytes.Length >= 4 && bytes[0] == 0 && bytes[2] == 0 && bytes[1] != 0) return Encoding.BigEndianUnicode;
        var start = 0;
        if (trimmed) while (start < Math.Min(3, bytes.Length) && (bytes[start] & 0xC0) == 0x80) start++;
        // The writer may be mid-line while this tail is read; a partial trailing
        // character must not flip the whole file to the OEM fallback.
        var end = bytes.Length;
        var lastNewline = bytes.LastIndexOf((byte)'\n');
        if (lastNewline >= start) end = lastNewline + 1;
        if (Utf8.IsValid(bytes[start..end])) return new UTF8Encoding(false);
        try { return Encoding.GetEncoding(CultureInfo.CurrentCulture.TextInfo.OEMCodePage); }
        catch (Exception exception) when (exception is ArgumentException or NotSupportedException) { return Encoding.Latin1; }
    }

    public static BackupFile[] ReadBackups()
    {
        var directory = Path.Combine(Data, "backups");
        if (!Directory.Exists(directory)) return Array.Empty<BackupFile>();
        return new DirectoryInfo(directory).EnumerateFiles("novora-*.dump").OrderByDescending(x => x.LastWriteTimeUtc).Take(100)
            .Select(x => new BackupFile(x.Name, $"{x.Length / 1024d / 1024:0.##} MB", x.LastWriteTime.ToString("yyyy-MM-dd HH:mm"), ClassifyBackup(x.Name))).ToArray();
    }

    /// <summary>
    /// The two protection prefixes are the writers' contract, not a guess: backup.ps1:48 excludes exactly
    /// these names from automatic retention, restore-backup.ps1:40 writes the restore safety backup and
    /// Novora.Update's WindowsPlatform.cs:63 writes the pre-update one. Anything else is a regular backup.
    /// </summary>
    internal static string ClassifyBackup(string name) =>
        name.StartsWith("novora-before-update-", StringComparison.OrdinalIgnoreCase) ? "更新前保护" :
        name.StartsWith("novora-before-restore-", StringComparison.OrdinalIgnoreCase) ? "恢复前保护" : "常规";

    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceStatus { public uint ServiceType, CurrentState, ControlsAccepted, Win32ExitCode, ServiceSpecificExitCode, CheckPoint, WaitHint, ProcessId, ServiceFlags; }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr OpenSCManager(string? machineName, string? databaseName, uint access);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr OpenService(IntPtr manager, string name, uint access);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool QueryServiceStatusEx(IntPtr service, int level, ref ServiceStatus status, uint size, out uint needed);
    [DllImport("advapi32.dll")] private static extern bool CloseServiceHandle(IntPtr handle);
}
