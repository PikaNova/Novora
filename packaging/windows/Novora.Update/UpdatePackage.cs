using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Novora.Update;

public sealed record ReleaseManifest(int Format, string Version, string MinimumVersion, string MinimumUpdater,
    string Platform, int NodeMajor, string DatabaseMode, string Notes, string PackageUrl, long Size, string Sha256,
    string[]? Migrations = null, SetupAsset? Setup = null);
public sealed record SetupAsset(string Url, long Size, string Sha256);
public sealed record UpdateTrust(string Repository, string PublicKeyPem, string? AuthorBaseUrl = null);
public sealed record UpdateProgress(string Item, long Current = 0, long? Total = null);

public static class UpdatePackage
{
    public const string UpdaterVersion = "1.0.0";
    public const long MaximumPackageBytes = 1024L * 1024 * 1024;
    public const string AuthorHost = "update.pikachu2026.space";
    public const string LegacyAuthorHost = "telemetry.pikachu2026.space";

    private static bool IsAuthorHost(string host) =>
        string.Equals(host, AuthorHost, StringComparison.OrdinalIgnoreCase) ||
        string.Equals(host, LegacyAuthorHost, StringComparison.OrdinalIgnoreCase);

    public static bool SupportsApplicationUpdate(ReleaseManifest manifest, string currentVersion) =>
        manifest.NodeMajor == 24 && manifest.DatabaseMode == "backward-compatible" &&
        ParseVersion(currentVersion) >= ParseVersion(manifest.MinimumVersion) &&
        ParseVersion(UpdaterVersion) >= ParseVersion(manifest.MinimumUpdater);
    public static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

    public static Version ParseVersion(string value)
    {
        if (!Regex.IsMatch(value, @"^\d+\.\d+\.\d+$") || !System.Version.TryParse(value, out var version))
            throw new InvalidDataException("版本号必须为稳定版 major.minor.patch。");
        return version;
    }

    public static void ValidateTrust(UpdateTrust trust)
    {
        if (trust.Repository != "PikaNova/Novora") throw new InvalidDataException("更新仓库不属于可信发行方。");
        ValidateAuthorBaseUrl(trust.AuthorBaseUrl);
        try
        {
            using var rsa = RSA.Create();
            rsa.ImportFromPem(trust.PublicKeyPem);
            if (rsa.KeySize < 2048) throw new InvalidDataException("可信签名公钥至少需要 RSA 2048 位。");
        }
        catch (Exception error) when (error is ArgumentException or CryptographicException)
        { throw new InvalidDataException("可信签名公钥无效。", error); }
    }

    public static ReleaseManifest VerifyManifest(byte[] bytes, byte[] signature, UpdateTrust trust, string currentVersion, bool requireNewer = true)
    {
        if (bytes.Length > 64 * 1024 || signature.Length > 1024) throw new InvalidDataException("更新清单过大。");
        using var rsa = RSA.Create();
        rsa.ImportFromPem(trust.PublicKeyPem);
        if (rsa.KeySize < 2048 || !rsa.VerifyData(bytes, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1))
            throw new InvalidDataException("更新签名无效，未安装更新。");
        var manifest = JsonSerializer.Deserialize<ReleaseManifest>(bytes, Json) ?? throw new InvalidDataException("更新清单为空。");
        var target = ParseVersion(manifest.Version);
        ParseVersion(manifest.MinimumVersion);
        ParseVersion(manifest.MinimumUpdater);
        if (manifest.Format != 1 || manifest.Platform != "win-x64")
            throw new InvalidDataException("此发布需要完整安装包。");
        if (requireNewer && target <= ParseVersion(currentVersion)) throw new InvalidDataException("该包不是较新的版本，禁止降级或重复安装。");
        if (manifest.Size <= 0 || manifest.Size > MaximumPackageBytes || !Regex.IsMatch(manifest.Sha256 ?? "", "^[A-Fa-f0-9]{64}$"))
            throw new InvalidDataException("更新包大小或摘要无效。");
        ValidateAssetUrl(manifest.PackageUrl, trust.Repository);
        if (manifest.Setup is { } setup)
        {
            if (setup.Size <= 0 || setup.Size > 4L * MaximumPackageBytes || !Regex.IsMatch(setup.Sha256 ?? "", "^[A-Fa-f0-9]{64}$"))
                throw new InvalidDataException("完整安装包大小或摘要无效。");
            ValidateAssetUrl(setup.Url, trust.Repository);
        }
        if (manifest.Migrations is { } migrations && (migrations.Length > 100 || migrations.Distinct(StringComparer.OrdinalIgnoreCase).Count() != migrations.Length ||
            migrations.Any(p => !Regex.IsMatch(p, @"^migrations/[0-9]+_[A-Za-z0-9_]+\.sql$"))))
            throw new InvalidDataException("数据库迁移文件列表无效。");
        return manifest;
    }

    public static void ValidateAssetUrl(string url, string repository)
    {
        if (!Regex.IsMatch(repository, @"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")) throw new InvalidDataException("更新仓库无效。");
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.Host != "github.com" || !uri.IsDefaultPort || uri.UserInfo.Length != 0 ||
            !uri.AbsolutePath.StartsWith($"/{repository}/releases/download/", StringComparison.Ordinal) || uri.Query.Length != 0 || uri.Fragment.Length != 0)
            throw new InvalidDataException("更新地址不属于可信发布仓库。");
    }

    public static Uri ValidateAuthorBaseUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new InvalidDataException("未配置作者端 Windows 更新地址。");
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps ||
            !uri.IsDefaultPort || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0 ||
            !IsAuthorHost(uri.Host) ||
            (uri.AbsolutePath is not ("" or "/")))
            throw new InvalidDataException("作者端更新地址不属于受信 HTTPS 服务。");
        return uri;
    }

    public static Uri AuthorManifestUri(string? value)
    {
        var baseUri = ValidateAuthorBaseUrl(value);
        return new Uri($"{baseUri.Scheme}://{baseUri.Host}/api/release-manifest?platform=win-x64&channel=stable");
    }

    public static Uri AuthorEventsUri(string? value)
    {
        var baseUri = ValidateAuthorBaseUrl(value);
        return new Uri($"{baseUri.Scheme}://{baseUri.Host}/api/release-manifest?platform=win-x64&resource=events");
    }

    public static byte[] DecodeBase64(string value, int maximum, string name)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > ((maximum + 2) / 3) * 4 ||
            !Regex.IsMatch(value, @"^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"))
            throw new InvalidDataException($"作者端{name}编码无效。");
        try
        {
            var bytes = Convert.FromBase64String(value);
            if (bytes.Length > maximum) throw new InvalidDataException($"作者端{name}超过大小限制。");
            return bytes;
        }
        catch (FormatException error) { throw new InvalidDataException($"作者端{name}编码无效。", error); }
    }

    public static async Task VerifyPayloadAsync(string path, ReleaseManifest manifest, CancellationToken token)
    {
        await using var stream = File.OpenRead(path);
        if (stream.Length != manifest.Size) throw new InvalidDataException("更新包长度不匹配。");
        var digest = Convert.ToHexString(await SHA256.HashDataAsync(stream, token));
        if (!digest.Equals(manifest.Sha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("更新包完整性校验失败。");
    }

    public static void ExtractPayload(string archivePath, string destination, IProgress<UpdateProgress>? progress, CancellationToken token)
    {
        using var archive = ZipFile.OpenRead(archivePath);
        if (archive.Entries.Count > 100000) throw new InvalidDataException("更新包文件过多。");
        long total = 0;
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in archive.Entries)
        {
            var name = entry.FullName.Replace('\\', '/');
            var parts = name.Split('/');
            if (name.StartsWith('/') || parts.Any(p => p is "." or ".." || p.Contains(':') || p.TrimEnd(' ', '.') != p) ||
                !names.Add(name.TrimEnd('/')) || ((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000)
                throw new InvalidDataException("更新包包含非法或重复路径。");
            if (parts[0] is not ("dist" or "server-build" or "node_modules" or "migrations") && name is not ("package.json" or "package-lock.json"))
                throw new InvalidDataException("应用更新包包含非应用文件。");
            total = checked(total + entry.Length);
            if (total > 4 * MaximumPackageBytes) throw new InvalidDataException("解压体积超过限制。");
        }
        var prefix = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        Directory.CreateDirectory(destination);
        long current = 0;
        var copyBuffer = new byte[128 * 1024];
        foreach (var entry in archive.Entries)
        {
            token.ThrowIfCancellationRequested();
            var target = Path.GetFullPath(Path.Combine(destination, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
            if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("解压路径越界。");
            if (entry.FullName.EndsWith('/')) { Directory.CreateDirectory(target); continue; }
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            using (var input = entry.Open())
            using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                long written = 0;
                int count;
                while ((count = input.Read(copyBuffer)) > 0)
                {
                    token.ThrowIfCancellationRequested();
                    written += count;
                    if (written > entry.Length) throw new InvalidDataException("解压文件大小与归档目录不一致。");
                    output.Write(copyBuffer, 0, count);
                }
                if (written != entry.Length) throw new InvalidDataException("解压文件不完整。");
            }
            current += entry.Length;
            progress?.Report(new("正在解压应用文件", current, total));
        }
        foreach (var required in new[] { "dist/index.html", "server-build/server/serve.js", "package.json", "node_modules" })
            if (!Path.Exists(Path.Combine(destination, required))) throw new InvalidDataException("更新包缺少必要文件：" + required);
    }

    public static void WriteAtomic<T>(string path, T value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { File.WriteAllText(temp, JsonSerializer.Serialize(value, Json)); File.Move(temp, path, true); }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    public static byte[] ReadBounded(string path, int maximum)
    {
        using var stream = File.OpenRead(path);
        if (stream.Length > maximum) throw new InvalidDataException("更新元数据超过大小限制。");
        var buffer = new byte[checked((int)stream.Length)];
        stream.ReadExactly(buffer);
        return buffer;
    }
}
