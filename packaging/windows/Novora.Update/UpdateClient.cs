using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.IO.Compression;

namespace Novora.Update;

public sealed record VerifiedRelease(ReleaseManifest Manifest, byte[] ManifestBytes, byte[] Signature, string Source = "offline");
public sealed record UpdateCheckResult(bool Available, VerifiedRelease? Release, string Source = "author");
public sealed record UpdateEvent(string EventId, string InstallationId, string AttemptId, string Stage,
    string CurrentVersion, string? TargetVersion = null, string? ErrorCode = null, string? Source = null);

public sealed class UpdateClient : IDisposable
{
    private readonly HttpClient http;
    public UpdateClient(HttpMessageHandler? handler = null)
    {
        http = handler is null ? new HttpClient() : new HttpClient(handler);
        http.Timeout = TimeSpan.FromMinutes(20);
        http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("NovoraUpdater", UpdatePackage.UpdaterVersion));
    }

    public async Task<UpdateCheckResult> CheckAsync(UpdateTrust trust, string currentVersion, CancellationToken token)
    {
        UpdatePackage.ValidateTrust(trust);
        UpdatePackage.ParseVersion(currentVersion);
        try { return await CheckAuthorAsync(trust, currentVersion, token); }
        catch (HttpRequestException error) when (!token.IsCancellationRequested &&
            (error.StatusCode is null or System.Net.HttpStatusCode.RequestTimeout or System.Net.HttpStatusCode.TooManyRequests || (int)error.StatusCode >= 500))
        { return await CheckGitHubAsync(trust, currentVersion, token); }
        catch (OperationCanceledException) when (!token.IsCancellationRequested)
        { return await CheckGitHubAsync(trust, currentVersion, token); }
    }

    private async Task<UpdateCheckResult> CheckAuthorAsync(UpdateTrust trust, string currentVersion, CancellationToken token)
    {
        var url = UpdatePackage.AuthorManifestUri(trust.AuthorBaseUrl);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(30));
        using var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
        response.EnsureSuccessStatusCode();
        var bytes = await ReadSmallAsync(response.Content, 256 * 1024, deadline.Token);
        using var root = JsonDocument.Parse(bytes);
        var body = root.RootElement;
        if (!body.TryGetProperty("ok", out var ok) || ok.ValueKind != JsonValueKind.True ||
            !body.TryGetProperty("source", out var source) || source.GetString() != "author")
            throw new InvalidDataException("作者端更新响应无效。");
        if (!body.TryGetProperty("available", out var available) || available.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            throw new InvalidDataException("作者端未返回更新可用状态。");
        if (body.TryGetProperty("platform", out var platform) && platform.GetString() != "win-x64" ||
            body.TryGetProperty("channel", out var channel) && channel.GetString() != "stable")
            throw new InvalidDataException("作者端返回了不匹配的平台或渠道。");
        if (available.ValueKind == JsonValueKind.False) return new(false, null);
        if (!body.TryGetProperty("version", out var versionElement) || versionElement.ValueKind != JsonValueKind.String ||
            !body.TryGetProperty("repository", out var repositoryElement) || repositoryElement.ValueKind != JsonValueKind.String ||
            !body.TryGetProperty("manifestBase64", out var manifestElement) || manifestElement.ValueKind != JsonValueKind.String ||
            !body.TryGetProperty("signatureBase64", out var signatureElement) || signatureElement.ValueKind != JsonValueKind.String)
            throw new InvalidDataException("作者端 Windows 发布清单字段不完整。");
        var repository = repositoryElement.GetString()!;
        if (!string.Equals(repository, trust.Repository, StringComparison.Ordinal)) throw new InvalidDataException("作者端发布仓库与本机信任配置不一致。");
        var manifestBytes = UpdatePackage.DecodeBase64(manifestElement.GetString()!, 64 * 1024, "签名清单");
        var signatureBytes = UpdatePackage.DecodeBase64(signatureElement.GetString()!, 1024, "签名");
        var manifest = UpdatePackage.VerifyManifest(manifestBytes, signatureBytes, trust, currentVersion, requireNewer: false);
        if (!string.Equals(manifest.Version, versionElement.GetString(), StringComparison.Ordinal)) throw new InvalidDataException("作者端推荐版本与签名清单版本不一致。");
        if (UpdatePackage.ParseVersion(manifest.Version) <= UpdatePackage.ParseVersion(currentVersion)) return new(false, null);
        return new(true, new(manifest, manifestBytes, signatureBytes, "author"));
    }

    private async Task<UpdateCheckResult> CheckGitHubAsync(UpdateTrust trust, string currentVersion, CancellationToken token)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(30));
        using var response = await http.GetAsync($"https://api.github.com/repos/{trust.Repository}/releases/latest", HttpCompletionOption.ResponseHeadersRead, deadline.Token);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await ReadSmallAsync(response.Content, 256 * 1024, deadline.Token));
        var root = document.RootElement;
        if (root.GetProperty("draft").ValueKind != JsonValueKind.False || root.GetProperty("prerelease").ValueKind != JsonValueKind.False)
            throw new InvalidDataException("GitHub 兜底仅接受正式稳定发布。");
        var tag = root.GetProperty("tag_name").GetString();
        var assets = root.GetProperty("assets").EnumerateArray().ToArray();
        async Task<byte[]> Asset(string name, int maximum)
        {
            var matches = assets.Where(x => x.GetProperty("name").GetString() == name).ToArray();
            if (matches.Length != 1) throw new InvalidDataException("GitHub 发布缺少唯一的签名清单或签名文件。");
            var url = matches[0].GetProperty("browser_download_url").GetString()!;
            UpdatePackage.ValidateAssetUrl(url, trust.Repository);
            using var asset = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            asset.EnsureSuccessStatusCode();
            return await ReadSmallAsync(asset.Content, maximum, deadline.Token);
        }
        var bytes = await Asset("release-manifest.json", 64 * 1024);
        var signature = await Asset("release-manifest.sig", 1024);
        var manifest = UpdatePackage.VerifyManifest(bytes, signature, trust, currentVersion, requireNewer: false);
        if (tag != "v" + manifest.Version) throw new InvalidDataException("GitHub 标签与签名清单版本不一致。");
        return UpdatePackage.ParseVersion(manifest.Version) <= UpdatePackage.ParseVersion(currentVersion)
            ? new(false, null, "github") : new(true, new(manifest, bytes, signature, "github"), "github");
    }

    private static async Task<byte[]> ReadSmallAsync(HttpContent content, int maximum, CancellationToken token)
    {
        if (content.Headers.ContentLength > maximum) throw new InvalidDataException("作者端响应超过大小限制。");
        await using var stream = await content.ReadAsStreamAsync(token);
        var bytes = new byte[maximum + 1];
        var count = await stream.ReadAtLeastAsync(bytes, bytes.Length, false, token);
        if (count > maximum) throw new InvalidDataException("作者端响应超过大小限制。");
        return bytes[..count];
    }

    internal static bool IsValidEvent(UpdateEvent updateEvent) =>
        IsUuid(updateEvent.EventId) && IsUuid(updateEvent.InstallationId) && IsUuid(updateEvent.AttemptId) &&
        updateEvent.Stage is ("check" or "available" or "verified" or "installing" or "succeeded" or "failed" or "rolled-back") &&
        IsStableVersion(updateEvent.CurrentVersion) && (updateEvent.TargetVersion is null || IsStableVersion(updateEvent.TargetVersion)) &&
        (updateEvent.ErrorCode is null || Regex.IsMatch(updateEvent.ErrorCode, "^[A-Z_]{1,48}$")) &&
        updateEvent.Source is (null or "author" or "github" or "offline");

    internal static bool IsUuid(string? value) => value is not null && Regex.IsMatch(value, "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$");

    public async Task SendEventAsync(UpdateTrust trust, UpdateEvent updateEvent, CancellationToken token)
    {
        if (!IsValidEvent(updateEvent))
            throw new InvalidDataException("Windows 更新事件字段无效。");
        var url = UpdatePackage.AuthorEventsUri(trust.AuthorBaseUrl);
        using var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(updateEvent, options: UpdatePackage.Json) };
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(5));
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
        if (response.IsSuccessStatusCode) return;
        throw new HttpRequestException($"作者端更新统计请求失败（HTTP {(int)response.StatusCode}）。");
    }

    public async Task DownloadSetupAsync(SetupAsset setup, string destination, IProgress<UpdateProgress> progress, CancellationToken token)
    {
        UpdatePackage.ValidateAssetUrl(setup.Url, "PikaNova/Novora");
        var partial = destination + ".partial";
        if (File.Exists(partial)) File.Delete(partial);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromMinutes(30));
        try
        {
            using var response = await http.GetAsync(setup.Url, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength is long length && length != setup.Size) throw new InvalidDataException("完整安装包长度与签名清单不符。");
            await using (var input = await response.Content.ReadAsStreamAsync(deadline.Token))
            await using (var output = new FileStream(partial, FileMode.CreateNew, FileAccess.Write, FileShare.None, 128 * 1024, true))
            {
                var buffer = new byte[128 * 1024]; long written = 0; int count;
                var report = System.Diagnostics.Stopwatch.StartNew();
                while ((count = await input.ReadAsync(buffer, deadline.Token)) > 0)
                {
                    written += count;
                    if (written > setup.Size) throw new InvalidDataException("完整安装包超出签名清单声明大小。");
                    await output.WriteAsync(buffer.AsMemory(0, count), deadline.Token);
                    if (report.ElapsedMilliseconds >= 200) { progress.Report(new("正在下载完整安装包", written, setup.Size)); report.Restart(); }
                }
                if (written != setup.Size) throw new InvalidDataException("完整安装包下载不完整。");
            }
            progress.Report(new("正在校验完整安装包"));
            await using (var file = File.OpenRead(partial))
            {
                var hash = Convert.ToHexString(await SHA256.HashDataAsync(file, deadline.Token));
                if (!hash.Equals(setup.Sha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("完整安装包 SHA256 校验失败。");
            }
            File.Move(partial, destination, true);
        }
        catch { if (File.Exists(partial)) File.Delete(partial); throw; }
    }

    private static bool IsStableVersion(string? value) => value is not null && value.Length <= 32 &&
        Regex.IsMatch(value, @"^\d+\.\d+\.\d+$") && value.Split('.').All(x => int.TryParse(x, out _));

    public async Task DownloadAsync(VerifiedRelease release, string directory, IProgress<UpdateProgress> progress, CancellationToken token)
    {
        Directory.CreateDirectory(directory);
        await File.WriteAllBytesAsync(Path.Combine(directory, "release-manifest.json"), release.ManifestBytes, token);
        await File.WriteAllBytesAsync(Path.Combine(directory, "release-manifest.sig"), release.Signature, token);
        var path = Path.Combine(directory, "payload.zip");
        var partial = path + ".partial";
        var offset = File.Exists(partial) ? new FileInfo(partial).Length : 0;
        if (offset > release.Manifest.Size) { File.Delete(partial); offset = 0; }
        if (offset == release.Manifest.Size)
        {
            try
            {
                await UpdatePackage.VerifyPayloadAsync(partial, release.Manifest, token);
                File.Move(partial, path, true);
                progress.Report(new("下载缓存完整性校验通过", offset, offset));
                return;
            }
            catch (InvalidDataException) { File.Delete(partial); offset = 0; }
        }
        using var request = new HttpRequestMessage(HttpMethod.Get, release.Manifest.PackageUrl);
        if (offset > 0) request.Headers.Range = new RangeHeaderValue(offset, null);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
        response.EnsureSuccessStatusCode();
        if (offset > 0 && response.StatusCode == System.Net.HttpStatusCode.PartialContent)
        {
            if (response.Content.Headers.ContentRange?.From != offset || response.Content.Headers.ContentRange?.Length != release.Manifest.Size)
                throw new InvalidDataException("下载续传范围不匹配。");
        }
        else offset = 0;
        await using (var output = new FileStream(partial, offset > 0 ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.None, 128 * 1024, true))
        await using (var input = await response.Content.ReadAsStreamAsync(token))
        {
            var buffer = new byte[128 * 1024];
            var current = offset;
            int count;
            var report = System.Diagnostics.Stopwatch.StartNew();
            while ((count = await input.ReadAsync(buffer, token)) > 0)
            {
                current += count;
                if (current > release.Manifest.Size) throw new InvalidDataException("下载超过签名清单声明的大小。");
                await output.WriteAsync(buffer.AsMemory(0, count), token);
                if (report.ElapsedMilliseconds >= 200) { progress.Report(new("正在下载应用更新", current, release.Manifest.Size)); report.Restart(); }
            }
        }
        progress.Report(new("正在校验下载文件"));
        try { await UpdatePackage.VerifyPayloadAsync(partial, release.Manifest, token); }
        catch (InvalidDataException) { File.Delete(partial); throw; }
        File.Move(partial, path, true);
    }

    public static async Task<VerifiedRelease> ImportAsync(string bundle, string directory, UpdateTrust trust, string currentVersion,
        IProgress<UpdateProgress> progress, CancellationToken token)
    {
        using var zip = ZipFile.OpenRead(bundle);
        if (zip.Entries.Count != 3) throw new InvalidDataException("离线更新包应包含清单、签名和应用压缩包。");
        ZipArchiveEntry Entry(string name, long limit)
        {
            var entries = zip.Entries.Where(x => x.FullName == name).ToArray();
            if (entries.Length != 1 || entries[0].Length > limit) throw new InvalidDataException("离线更新包结构无效。");
            return entries[0];
        }
        async Task<byte[]> Read(ZipArchiveEntry entry)
        {
            await using var stream = entry.Open();
            var limit = entry.FullName.EndsWith(".sig", StringComparison.Ordinal) ? 1024 : 64 * 1024;
            var buffer = new byte[limit + 1];
            var count = await stream.ReadAtLeastAsync(buffer, buffer.Length, false, token);
            if (count > limit) throw new InvalidDataException("离线元数据解压体积超过限制。");
            return buffer[..count];
        }
        var bytes = await Read(Entry("release-manifest.json", 64 * 1024));
        var signature = await Read(Entry("release-manifest.sig", 1024));
        var manifest = UpdatePackage.VerifyManifest(bytes, signature, trust, currentVersion);
        Directory.CreateDirectory(directory);
        await File.WriteAllBytesAsync(Path.Combine(directory, "release-manifest.json"), bytes, token);
        await File.WriteAllBytesAsync(Path.Combine(directory, "release-manifest.sig"), signature, token);
        progress.Report(new("正在导入离线更新包"));
        var payload = Entry("payload.zip", UpdatePackage.MaximumPackageBytes);
        var path = Path.Combine(directory, "payload.zip");
        await using (var input = payload.Open())
        await using (var output = File.Create(path))
        {
            var buffer = new byte[128 * 1024];
            long written = 0;
            int count;
            while ((count = await input.ReadAsync(buffer, token)) > 0)
            {
                written += count;
                if (written > manifest.Size) throw new InvalidDataException("离线应用包超过签名清单声明的大小。");
                await output.WriteAsync(buffer.AsMemory(0, count), token);
            }
        }
        await UpdatePackage.VerifyPayloadAsync(path, manifest, token);
        return new(manifest, bytes, signature);
    }

    public void Dispose() => http.Dispose();
}
