using System.Diagnostics;

namespace ClassIsland.ExamReminder.Services;

public sealed class ExternalUriLauncher
{
    private static readonly TimeSpan LinuxLauncherTimeout = TimeSpan.FromSeconds(5);

    public bool TryOpen(Uri uri, out string error)
    {
        if (!uri.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) &&
            !uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            error = "只允许打开 HTTP 或 HTTPS 网址";
            return false;
        }

        var useShellExecute = new ProcessStartInfo(uri.AbsoluteUri)
        {
            UseShellExecute = true,
        };
        if (TryStart(useShellExecute, OperatingSystem.IsLinux(), out error))
        {
            return true;
        }

        if (!OperatingSystem.IsLinux())
        {
            return false;
        }

        if (TryStart(CreateLinuxStartInfo("xdg-open", uri), true, out _))
        {
            error = string.Empty;
            return true;
        }

        var gio = CreateLinuxStartInfo("gio", uri);
        gio.ArgumentList.Insert(0, "open");
        if (TryStart(gio, true, out _))
        {
            error = string.Empty;
            return true;
        }

        error = "未找到可用的默认浏览器启动程序（需要 xdg-open 或 gio）";
        return false;
    }

    private static ProcessStartInfo CreateLinuxStartInfo(string fileName, Uri uri)
    {
        var startInfo = new ProcessStartInfo(fileName)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        startInfo.ArgumentList.Add(uri.AbsoluteUri);
        return startInfo;
    }

    private static bool TryStart(ProcessStartInfo startInfo, bool verifyExitCode, out string error)
    {
        try
        {
            using var process = Process.Start(startInfo);
            if (process is null)
            {
                error = "系统没有返回浏览器进程";
                return false;
            }

            if (!verifyExitCode || !process.WaitForExit((int)LinuxLauncherTimeout.TotalMilliseconds))
            {
                error = string.Empty;
                return true;
            }

            if (process.ExitCode == 0)
            {
                error = string.Empty;
                return true;
            }

            error = $"浏览器启动程序退出，代码 {process.ExitCode}";
            return false;
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return false;
        }
    }
}
