using System.Diagnostics;

namespace Novora.Launcher.WinUI;

internal static class NovoraPaths
{
    public static string InstallRoot => ResolveInstallRoot();

    public static string LauncherPath => Path.Combine(InstallRoot, "NovoraLauncher.exe");

    private static string ResolveInstallRoot()
    {
        var candidates = new List<string>();
        AddCandidate(candidates, Path.GetDirectoryName(Environment.ProcessPath));
        AddCandidate(candidates, AppContext.BaseDirectory);

        foreach (var candidate in candidates)
        {
            if (File.Exists(Path.Combine(candidate, "NovoraLauncher.exe"))) return candidate;
            var parent = Directory.GetParent(candidate)?.FullName;
            if (!string.IsNullOrWhiteSpace(parent) && File.Exists(Path.Combine(parent, "NovoraLauncher.exe"))) return parent;
        }

        return candidates.FirstOrDefault() ?? AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    }

    private static void AddCandidate(ICollection<string> candidates, string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        try
        {
            var fullPath = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar);
            if (!candidates.Contains(fullPath, StringComparer.OrdinalIgnoreCase)) candidates.Add(fullPath);
        }
        catch { }
    }
}
