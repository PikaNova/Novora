using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;

namespace Novora.Launcher.WinUI;

internal static class WindowsDiagnostics
{
    private static readonly HttpClient HealthClient = new() { Timeout = TimeSpan.FromSeconds(2) };
    private static readonly object SnapshotSync = new();
    private static WindowsStatusSnapshot? cachedSnapshot;
    private static DateTime cachedSnapshotAt;
    private static Task<WindowsStatusSnapshot>? inFlightSnapshot;

    public static async Task<WindowsStatusSnapshot> GetStatusSnapshotAsync(string installRoot, string dataRoot, int port, bool forceRefresh = false)
    {
        Task<WindowsStatusSnapshot> snapshotTask;
        lock (SnapshotSync)
        {
            if (!forceRefresh && cachedSnapshot is not null && DateTime.UtcNow - cachedSnapshotAt < TimeSpan.FromSeconds(5)) return cachedSnapshot;
            snapshotTask = inFlightSnapshot ??= RefreshSnapshotAsync(installRoot, dataRoot, port);
        }
        try
        {
            return await snapshotTask;
        }
        finally
        {
            lock (SnapshotSync)
                if (ReferenceEquals(inFlightSnapshot, snapshotTask)) inFlightSnapshot = null;
        }
    }

    private static async Task<WindowsStatusSnapshot> RefreshSnapshotAsync(string installRoot, string dataRoot, int port)
    {
        var serviceTask = Task.Run(() => ReadServiceState("Novora"));
        var databaseTask = Task.Run(() => ReadServiceState("NovoraPostgreSQL"));
        var healthTask = ReadLocalHealthAsync(port);
        var portTask = IsPortListeningAsync(port);
        var nodeTask = Task.Run(() => ReadProcesses(installRoot, "node"));
        var postgresTask = Task.Run(() => ReadProcesses(Path.Combine(installRoot, "postgres"), "postgres"));
        await Task.WhenAll(serviceTask, databaseTask, healthTask, portTask, nodeTask, postgresTask);
        var snapshot = new WindowsStatusSnapshot(
            serviceTask.Result,
            databaseTask.Result,
            healthTask.Result,
            portTask.Result,
            nodeTask.Result,
            postgresTask.Result,
            GetLanAddresses(),
            DateTimeOffset.UtcNow);
        lock (SnapshotSync)
        {
            cachedSnapshot = snapshot;
            cachedSnapshotAt = DateTime.UtcNow;
        }
        return snapshot;
    }

    private static async Task<LocalRuntimeSnapshot?> ReadLocalHealthAsync(int port)
    {
        try
        {
            return await HealthClient.GetFromJsonAsync<LocalRuntimeSnapshot>($"http://127.0.0.1:{port}/api/system?sys=local-status");
        }
        catch { return null; }
    }

    public static async Task<string> GetServiceStateAsync(string serviceName)
    {
        return await Task.Run(() => ReadServiceState(serviceName));
    }

    private static string ReadServiceState(string serviceName)
    {
        var manager = OpenSCManager(null, null, 0x0001);
        if (manager == IntPtr.Zero) return "无法读取";
        try
        {
            var service = OpenService(manager, serviceName, 0x0004);
            if (service == IntPtr.Zero) return Marshal.GetLastWin32Error() == 1060 ? "未安装" : "无法读取";
            try
            {
                var status = new ServiceStatusProcess();
                if (!QueryServiceStatusEx(service, 0, ref status, (uint)Marshal.SizeOf<ServiceStatusProcess>(), out _)) return "无法读取";
                return status.CurrentState switch
                {
                    1 => "已停止",
                    2 or 3 => "正在启动",
                    4 => "运行中",
                    5 or 6 => "正在停止",
                    _ => "状态未知"
                };
            }
            finally { CloseServiceHandle(service); }
        }
        finally { CloseServiceHandle(manager); }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceStatusProcess
    {
        public uint ServiceType;
        public uint CurrentState;
        public uint ControlsAccepted;
        public uint Win32ExitCode;
        public uint ServiceSpecificExitCode;
        public uint CheckPoint;
        public uint WaitHint;
        public uint ProcessId;
        public uint ServiceFlags;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenSCManager(string? machineName, string? databaseName, uint desiredAccess);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenService(IntPtr serviceManager, string serviceName, uint desiredAccess);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool QueryServiceStatusEx(IntPtr service, int infoLevel, ref ServiceStatusProcess buffer, uint bufferSize, out uint bytesNeeded);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool CloseServiceHandle(IntPtr serviceHandle);

    public static async Task<bool> IsPortListeningAsync(int port)
    {
        try
        {
            using var client = new TcpClient();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await client.ConnectAsync(IPAddress.Loopback, port, timeout.Token);
            return true;
        }
        catch { return false; }
    }

    public static IReadOnlyList<string> GetLanAddresses()
    {
        try
        {
            return NetworkInterface.GetAllNetworkInterfaces()
                .Where(network => network.OperationalStatus == OperationalStatus.Up
                    && network.NetworkInterfaceType != NetworkInterfaceType.Loopback
                    && network.NetworkInterfaceType != NetworkInterfaceType.Tunnel)
                .SelectMany(network =>
                {
                    try
                    {
                        var properties = network.GetIPProperties();
                        var hasGateway = properties.GatewayAddresses.Any(gateway => gateway.Address.AddressFamily == AddressFamily.InterNetwork
                            && !IPAddress.IsLoopback(gateway.Address)
                            && !gateway.Address.Equals(IPAddress.Any));
                        if (!hasGateway) return Enumerable.Empty<string>();
                        return properties.UnicastAddresses
                            .Where(unicast => unicast.Address.AddressFamily == AddressFamily.InterNetwork
                                && !IPAddress.IsLoopback(unicast.Address)
                                && !unicast.Address.ToString().StartsWith("169.254.", StringComparison.Ordinal))
                            .Select(unicast => unicast.Address.ToString());
                    }
                    catch { return Enumerable.Empty<string>(); }
                })
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }
        catch { return Array.Empty<string>(); }
    }

    public static ProcessSnapshot ReadProcesses(string installRoot, string name)
    {
        var root = Path.GetFullPath(installRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var processes = new List<Process>();
        foreach (var process in Process.GetProcessesByName(name))
        {
            try
            {
                var executable = process.MainModule?.FileName;
                if (!string.IsNullOrWhiteSpace(executable) && Path.GetFullPath(executable).StartsWith(root, StringComparison.OrdinalIgnoreCase))
                    processes.Add(process);
                else
                    process.Dispose();
            }
            catch { process.Dispose(); }
        }
        if (processes.Count == 0) return new ProcessSnapshot(0, "—", "—", "—", 0);
        try
        {
            var memory = processes.Sum(process => process.WorkingSet64);
            var oldestStart = processes.Select(process => process.StartTime).Min();
            var cpu = TimeSpan.FromTicks(processes.Sum(process => process.TotalProcessorTime.Ticks));
            return new ProcessSnapshot(processes.Count, processes[0].Id.ToString(), FormatBytes(memory), FormatDuration(DateTime.Now - oldestStart), cpu.TotalMilliseconds);
        }
        finally
        {
            foreach (var process in processes) process.Dispose();
        }
    }

    public static string FormatBytes(long bytes)
    {
        var units = new[] { "B", "KB", "MB", "GB" };
        var value = (double)Math.Max(0, bytes);
        var unit = 0;
        while (value >= 1024 && unit < units.Length - 1) { value /= 1024; unit++; }
        return $"{value:0.#} {units[unit]}";
    }

    private static string FormatDuration(TimeSpan value) => value.TotalDays >= 1
        ? $"{(int)value.TotalDays} 天 {value.Hours} 小时"
        : value.TotalHours >= 1 ? $"{value.Hours} 小时 {value.Minutes} 分钟" : $"{Math.Max(0, value.Minutes)} 分钟";

    public sealed record ProcessSnapshot(int Count, string Pid, string Memory, string Uptime, double CpuMilliseconds);
}

internal sealed record WindowsStatusSnapshot(
    string ServiceState,
    string DatabaseState,
    LocalRuntimeSnapshot? Runtime,
    bool PortListening,
    WindowsDiagnostics.ProcessSnapshot Node,
    WindowsDiagnostics.ProcessSnapshot Postgres,
    IReadOnlyList<string> LanAddresses,
    DateTimeOffset UpdatedAt);

internal sealed record LocalRuntimeSnapshot(
    bool Ok,
    string? Service,
    string? Database,
    string? Version,
    int Pid,
    int UptimeSeconds,
    int DatabaseLatencyMs,
    LocalRuntimeMemory? MemoryBytes,
    DateTimeOffset? UpdatedAt);

internal sealed record LocalRuntimeMemory(long Rss, long HeapUsed, long HeapTotal, long External);
