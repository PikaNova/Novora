namespace ClassIsland.ExamReminder.Services;

public static class ExamBoardUrls
{
    private static readonly string[] KnownSuffixes = ["/exam", "/admin", "/settings", "/preferences", "/plugin/connect"];

    public static bool TryNormalizeBaseUrl(string value, out string normalized, out string error)
    {
        normalized = string.Empty;
        error = string.Empty;
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri))
        {
            error = "请输入完整网址，例如 https://exam.example.com";
            return false;
        }

        var isLocalHttp = uri.Scheme == Uri.UriSchemeHttp &&
            (uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) || uri.IsLoopback);
        if (uri.Scheme != Uri.UriSchemeHttps && !isLocalHttp)
        {
            error = "Novora 网址必须使用 HTTPS；本机调试可使用 localhost HTTP";
            return false;
        }

        var path = uri.AbsolutePath.TrimEnd('/');
        var suffix = KnownSuffixes.FirstOrDefault(item => path.EndsWith(item, StringComparison.OrdinalIgnoreCase));
        if (suffix is not null)
        {
            path = path[..^suffix.Length];
        }

        var builder = new UriBuilder(uri)
        {
            Path = path,
            Query = string.Empty,
            Fragment = string.Empty,
        };
        normalized = builder.Uri.AbsoluteUri.TrimEnd('/');
        return true;
    }

    public static Uri Api(string baseUrl) => Append(baseUrl, "api/exams");

    public static Uri Pairing(string baseUrl, string pairToken) =>
        WithQuery(Append(baseUrl, "plugin/connect"), $"token={Uri.EscapeDataString(pairToken)}");

    public static Uri Board(string baseUrl, string pluginInstanceId) =>
        WithQuery(Append(baseUrl, "exam"),
            $"source=classisland&instanceId={Uri.EscapeDataString(pluginInstanceId)}");

    private static Uri Append(string baseUrl, string relative) => new($"{baseUrl.TrimEnd('/')}/{relative}");

    private static Uri WithQuery(Uri uri, string query)
    {
        var builder = new UriBuilder(uri) { Query = query };
        return builder.Uri;
    }
}
