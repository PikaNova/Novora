using System.IO;
using System.Text;

namespace Novora.ControlCenter;

/// <summary>
/// 控制中心自己的落盘日志。服务日志由 Novora.ServiceHost 管理；这里只记录
/// 启动、单实例转发、监听失败和未处理异常，避免 Release 下的静默退出没有任何痕迹。
/// </summary>
internal static class ControlCenterLog
{
    private const long MaxBytes = 2 * 1024 * 1024;
    private const int KeepRotations = 3;
    private static readonly object Gate = new();
    private static readonly string DirectoryPath = ResolveDirectory();

    public static string CurrentPath => Path.Combine(DirectoryPath, $"controlcenter-{DateTime.Now:yyyyMMdd}.log");

    public static void Info(string message) => Write("INFO", message);
    public static void Warn(string message) => Write("WARN", message);
    public static void Error(string message, Exception? error = null) => Write("ERROR", error is null ? message : $"{message}: {error}");

    private static string ResolveDirectory()
    {
        foreach (var candidate in new[]
                 {
                     Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Novora", "logs"),
                     Path.Combine(Path.GetTempPath(), "Novora", "logs"),
                 })
        {
            try
            {
                Directory.CreateDirectory(candidate);
                return candidate;
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or NotSupportedException or System.Security.SecurityException) { }
        }
        return Path.GetTempPath();
    }

    private static void Write(string level, string message)
    {
        lock (Gate)
        {
            try
            {
                Directory.CreateDirectory(DirectoryPath);
                var path = CurrentPath;
                RotateIfNeeded(path);
                File.AppendAllText(path,
                    $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] [{level}] {message}{Environment.NewLine}",
                    new UTF8Encoding(false));
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or NotSupportedException or System.Security.SecurityException) { }
        }
    }

    private static void RotateIfNeeded(string path)
    {
        if (!File.Exists(path) || new FileInfo(path).Length < MaxBytes) return;
        for (var index = KeepRotations - 1; index >= 1; index--)
        {
            var source = RotationPath(path, index);
            if (File.Exists(source)) File.Move(source, RotationPath(path, index + 1), overwrite: true);
        }
        File.Move(path, RotationPath(path, 1), overwrite: true);
    }

    private static string RotationPath(string path, int index) =>
        Path.Combine(Path.GetDirectoryName(path)!, $"{Path.GetFileNameWithoutExtension(path)}.{index}.log");
}
