namespace Novora.Updater;

public sealed record UpdateInvocation(bool Recover, string? Directory, string? InstallationId, string? AttemptId, string? Source)
{
    public static UpdateInvocation Parse(string[] args)
    {
        var recover = args.Length > 0 && args[0] == "--recover";
        var offset = recover ? 1 : 2;
        if (args.Length < offset || !recover && args[0] != "--install" || (args.Length - offset) % 2 != 0)
            throw new ArgumentException("更新程序参数无效。");
        string? installation = null, attempt = null, source = null;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var i = offset; i < args.Length; i += 2)
        {
            if (!seen.Add(args[i])) throw new ArgumentException("更新程序参数重复。");
            switch (args[i])
            {
                case "--installation-id": installation = args[i + 1]; break;
                case "--attempt-id": attempt = args[i + 1]; break;
                case "--source": source = args[i + 1]; break;
                default: throw new ArgumentException("更新程序参数无效。");
            }
        }
        if (installation is not null && (!Guid.TryParseExact(installation, "D", out var installId) || installId == Guid.Empty) ||
            attempt is not null && (!Guid.TryParseExact(attempt, "D", out var attemptId) || attemptId == Guid.Empty) || source is not (null or "author" or "github" or "offline"))
            throw new ArgumentException("更新统计参数无效。");
        return new(recover, recover ? null : Path.GetFullPath(args[1]), installation, attempt, source);
    }
}
