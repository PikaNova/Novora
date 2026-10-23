using System.Runtime.InteropServices;

namespace Novora.Tray;

internal enum TrayServiceState { Unknown, Missing, Stopped, Starting, Running, Stopping, Other }

internal static class TrayService
{
    public static TrayServiceState Read()
    {
        var manager = OpenSCManager(null, null, 1);
        if (manager == IntPtr.Zero) return TrayServiceState.Unknown;
        try
        {
            var service = OpenService(manager, "Novora", 4);
            if (service == IntPtr.Zero)
                return Marshal.GetLastWin32Error() == 1060 ? TrayServiceState.Missing : TrayServiceState.Unknown;
            try
            {
                var status = new ServiceStatus();
                if (!QueryServiceStatusEx(service, 0, ref status, (uint)Marshal.SizeOf<ServiceStatus>(), out _))
                    return TrayServiceState.Unknown;
                return status.CurrentState switch
                {
                    1 => TrayServiceState.Stopped, 2 => TrayServiceState.Starting,
                    3 => TrayServiceState.Stopping, 4 => TrayServiceState.Running, _ => TrayServiceState.Other
                };
            }
            finally { CloseServiceHandle(service); }
        }
        finally { CloseServiceHandle(manager); }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceStatus { public uint ServiceType, CurrentState, ControlsAccepted, Win32ExitCode, ServiceSpecificExitCode, CheckPoint, WaitHint, ProcessId, ServiceFlags; }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr OpenSCManager(string? machineName, string? databaseName, uint access);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr OpenService(IntPtr manager, string name, uint access);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool QueryServiceStatusEx(IntPtr service, int level, ref ServiceStatus status, uint size, out uint needed);
    [DllImport("advapi32.dll")] private static extern bool CloseServiceHandle(IntPtr handle);
}
