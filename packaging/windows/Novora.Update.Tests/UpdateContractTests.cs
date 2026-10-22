using System.Net;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Novora.Update;
using Novora.Updater;

static class UpdateContractTests
{
    private static void Check(bool condition, string name)
    {
        if (!condition) throw new Exception("FAIL: " + name);
        Console.WriteLine("PASS: " + name);
    }

    private static async Task Reject(Func<Task> action, string name)
    {
        try { await action(); }
        catch (Exception error) when (error is InvalidDataException or HttpRequestException or JsonException or ArgumentException or OperationCanceledException)
        { Check(true, name); return; }
        throw new Exception("FAIL: accepted " + name);
    }

    public static async Task RunAsync(ReleaseManifest manifest, byte[] bytes, byte[] signature, RSA rsa, string root)
    {
        var trust = new UpdateTrust("PikaNova/Novora", rsa.ExportSubjectPublicKeyInfoPem(), "https://telemetry.pikachu2026.space");
        string Envelope(byte[] data, byte[] sig, string version = "2.8.2", string repository = "PikaNova/Novora") =>
            JsonSerializer.Serialize(new { ok = true, source = "author", available = true, platform = "win-x64", channel = "stable", version, repository,
                manifestBase64 = Convert.ToBase64String(data), signatureBase64 = Convert.ToBase64String(sig) });
        static HttpResponseMessage Json(string body, HttpStatusCode status = HttpStatusCode.OK) => new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        var empty = "{\"ok\":true,\"source\":\"author\",\"available\":false,\"platform\":\"win-x64\",\"channel\":\"stable\"}";
        async Task<UpdateCheckResult> Author(string body, string name, bool reject = false)
        {
            using var handler = new RecordingHandler(_ => Json(body));
            using var client = new UpdateClient(handler);
            UpdateCheckResult? result = null;
            if (reject) await Reject(async () => { await client.CheckAsync(trust, "2.8.1", default); }, name);
            else result = await client.CheckAsync(trust, "2.8.1", default);
            Check(handler.Requests.Count == 1 && handler.Requests[0].Url == UpdatePackage.AuthorManifestUri(trust.AuthorBaseUrl).AbsoluteUri, name + ": only author endpoint");
            return result ?? new(false, null);
        }

        Check(!(await Author(empty, "No recommendation")).Available, "No recommendation never falls back to GitHub");
        // Preserve formatting and CRLF: verifying a parsed/re-serialized object would fail this signature.
        var raw = Encoding.UTF8.GetBytes(" \r\n" + Encoding.UTF8.GetString(bytes) + "\r\n");
        var rawSignature = rsa.SignData(raw, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var release = (await Author(Envelope(raw, rawSignature), "Raw manifest bytes")).Release!;
        Check(release.Source == "author" && release.ManifestBytes.SequenceEqual(raw) && release.Signature.SequenceEqual(rawSignature), "Original signed bytes survive author response");
        var tampered = raw.ToArray(); tampered[2] ^= 1;
        await Author(Envelope(tampered, rawSignature), "Bad signature does not fall back", true);
        await Author(Envelope(bytes, signature, "2.8.3"), "Envelope version mismatch does not fall back", true);
        await Author(Envelope(bytes, signature, repository: "attacker/Novora"), "Repository mismatch does not fall back", true);
        await Author(Envelope(bytes, signature).Replace("win-x64", "linux-x64"), "Platform mismatch does not fall back", true);
        await Author(Envelope(bytes, signature).Replace(JsonSerializer.Serialize(Convert.ToBase64String(signature)), "\"not base64!\""), "Malformed Base64 does not fall back", true);
        await Author("{\"ok\":true}", "Incomplete response does not fall back", true);
        await Author(new string('x', 256 * 1024 + 1), "Oversized response does not fall back", true);

        var githubJson = JsonSerializer.Serialize(new { draft = false, prerelease = false, tag_name = "v2.8.2", assets = new[] {
            new { name = "release-manifest.json", browser_download_url = "https://github.com/PikaNova/Novora/releases/download/v2.8.2/release-manifest.json" },
            new { name = "release-manifest.sig", browser_download_url = "https://github.com/PikaNova/Novora/releases/download/v2.8.2/release-manifest.sig" } } });
        HttpResponseMessage GitHub(HttpRequestMessage request, byte[]? sig = null, string? listing = null)
        {
            var url = request.RequestUri!;
            return url.Host == "api.github.com" ? Json(listing ?? githubJson) : new(HttpStatusCode.OK) {
                Content = new ByteArrayContent(url.AbsolutePath.EndsWith(".sig") ? sig ?? signature : bytes) };
        }
        foreach (var status in new[] { HttpStatusCode.RequestTimeout, HttpStatusCode.TooManyRequests, HttpStatusCode.InternalServerError, HttpStatusCode.ServiceUnavailable })
        {
            using var handler = new RecordingHandler(request => request.RequestUri!.Host == UpdatePackage.AuthorHost ? Json("{}", status) : GitHub(request));
            using var client = new UpdateClient(handler);
            var result = await client.CheckAsync(trust, "2.8.1", default);
            Check(result is { Available: true, Source: "github", Release.Source: "github" } && handler.Requests.Count == 4 &&
                handler.Requests[1].Url == "https://api.github.com/repos/PikaNova/Novora/releases/latest", $"HTTP {(int)status} uses signed GitHub fallback");
        }
        foreach (var failure in new Exception[] { new HttpRequestException("Simulated DNS failure"), new TaskCanceledException("Simulated author timeout") })
        {
            using var handler = new RecordingHandler(request => request.RequestUri!.Host == UpdatePackage.AuthorHost ? throw failure : GitHub(request));
            using var client = new UpdateClient(handler);
            Check((await client.CheckAsync(trust, "2.8.1", default)).Source == "github", failure.GetType().Name + " uses fallback");
        }
        foreach (var status in new[] { HttpStatusCode.BadRequest, HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden, HttpStatusCode.NotFound, HttpStatusCode.Conflict })
        {
            using var handler = new RecordingHandler(_ => Json("{\"code\":\"RELEASE_VERIFICATION_FAILED\"}", status));
            using var client = new UpdateClient(handler);
            await Reject(async () => { await client.CheckAsync(trust, "2.8.1", default); }, $"HTTP {(int)status} rejected");
            Check(handler.Requests.Count == 1, $"HTTP {(int)status} cannot bypass author through fallback");
        }
        using (var cancel = new CancellationTokenSource())
        using (var handler = new RecordingHandler(_ => { cancel.Cancel(); throw new TaskCanceledException(); }))
        using (var client = new UpdateClient(handler))
        {
            await Reject(async () => { await client.CheckAsync(trust, "2.8.1", cancel.Token); }, "User cancellation stops check");
            Check(handler.Requests.Count == 1, "User cancellation does not start fallback");
        }
        using (var handler = new RecordingHandler(request => request.RequestUri!.Host == UpdatePackage.AuthorHost
            ? Json("{}", HttpStatusCode.ServiceUnavailable) : GitHub(request, new byte[256])))
        using (var client = new UpdateClient(handler))
            await Reject(async () => { await client.CheckAsync(trust, "2.8.1", default); }, "GitHub fallback rejects wrong signature");
        using (var handler = new RecordingHandler(request => request.RequestUri!.Host == UpdatePackage.AuthorHost
            ? Json("{}", HttpStatusCode.ServiceUnavailable) : GitHub(request, listing: githubJson.Replace("v2.8.2", "v2.8.3"))))
        using (var client = new UpdateClient(handler))
            await Reject(async () => { await client.CheckAsync(trust, "2.8.1", default); }, "GitHub fallback rejects tag mismatch");

        foreach (var address in new[] { "http://telemetry.pikachu2026.space", "https://telemetry.pikachu2026.space:444/", "https://telemetry.pikachu2026.space/api/", "https://telemetry.pikachu2026.space/?x=1", "https://telemetry.pikachu2026.space/#fragment", "https://user@telemetry.pikachu2026.space", "https://attacker.example", "" })
        {
            using var handler = new RecordingHandler(_ => Json(empty)); using var client = new UpdateClient(handler);
            await Reject(async () => { await client.CheckAsync(trust with { AuthorBaseUrl = address }, "2.8.1", default); }, "Untrusted author address denied");
            Check(handler.Requests.Count == 0, "Untrusted configuration makes no network request");
        }
        using (var handler = new RecordingHandler(_ => Json(empty)))
        using (var client = new UpdateClient(handler))
        {
            await Reject(async () => { await client.CheckAsync(trust with { PublicKeyPem = "bad key" }, "2.8.1", default); }, "Invalid trust key denied");
            Check(handler.Requests.Count == 0, "Invalid key disables check before network");
        }

        var setupBytes = Encoding.UTF8.GetBytes("isolated setup fixture, never executed");
        var setup = new SetupAsset("https://github.com/PikaNova/Novora/releases/download/v2.8.2/Novora-Setup-2.8.2.exe", setupBytes.Length, Convert.ToHexString(SHA256.HashData(setupBytes)));
        var fullManifest = manifest with { Setup = setup, NodeMajor = 26 };
        var fullBytes = JsonSerializer.SerializeToUtf8Bytes(fullManifest, UpdatePackage.Json);
        var fullSignature = rsa.SignData(fullBytes, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var full = (await Author(Envelope(fullBytes, fullSignature), "Signed setup metadata")).Release!;
        Check(full.Manifest.Setup == setup && !UpdatePackage.SupportsApplicationUpdate(full.Manifest, "2.8.1"), "Runtime-incompatible release exposes only signed full setup");
        foreach (var incompatible in new[] { manifest with { MinimumVersion = "2.8.2" }, manifest with { MinimumUpdater = "9.0.0" }, manifest with { DatabaseMode = "destructive" } })
            Check(!UpdatePackage.SupportsApplicationUpdate(incompatible, "2.8.1"), "Compatibility gate prevents unsupported application install");
        var setupPath = Path.Combine(root, "setup-fixture.exe");
        using (var handler = new RecordingHandler(_ => new(HttpStatusCode.OK) { Content = new ByteArrayContent(setupBytes) }))
        using (var client = new UpdateClient(handler))
        {
            await client.DownloadSetupAsync(setup, setupPath, new Progress<UpdateProgress>(), default);
            Check(File.ReadAllBytes(setupPath).SequenceEqual(setupBytes), "Full setup downloaded and hash verified without execution");
        }
        File.Delete(setupPath);
        using (var handler = new RecordingHandler(_ => new(HttpStatusCode.OK) { Content = new ByteArrayContent(setupBytes.Select(x => (byte)(x ^ 1)).ToArray()) }))
        using (var client = new UpdateClient(handler))
        {
            await Reject(() => client.DownloadSetupAsync(setup, setupPath, new Progress<UpdateProgress>(), default), "Tampered full setup rejected");
            Check(!File.Exists(setupPath) && !File.Exists(setupPath + ".partial"), "Tampered installer is never presented as verified");
        }

        var state = Path.Combine(root, "telemetry");
        var attempt = Guid.NewGuid().ToString();
        using var events = new RecordingHandler(_ => Json("{\"ok\":true}"));
        using (var telemetry = new UpdateTelemetry(trust, events, stateDirectory: state))
        {
            Check(!telemetry.Queue("check", "2.8.1"), "Telemetry default is off");
            await telemetry.FlushAsync();
            Check(events.Requests.Count == 0 && !Directory.Exists(state), "Opt-out does not create identifier or send requests");
            telemetry.Configure(true);
            var installation = telemetry.ReadSettings()!.InstallationId;
            telemetry.Configure(true);
            Check(telemetry.ReadSettings()!.InstallationId == installation, "Opt-in identifier persists");
            Check(!telemetry.Queue("failed", "2.8.1", errorCode: "password=secret") && !telemetry.Queue("check", "2.8.1", source: "https://private") &&
                !telemetry.Queue("check", "2.8.1", attemptId: "bad") && !telemetry.Queue("unknown", "2.8.1"), "Unstructured or invalid event fields never enter outbox");
            foreach (var source in new[] { "author", "github", "offline" })
                Check(telemetry.Queue("verified", "2.8.1", "2.8.2", attemptId: attempt, source: source), "Source event queued: " + source);
            await telemetry.FlushAsync();
            Check(events.Requests.Count == 3 && Directory.GetFiles(state, "*.json").Length == 1, "Acknowledged events removed; settings retained");
            foreach (var request in events.Requests)
            {
                using var doc = JsonDocument.Parse(request.Body!);
                var evt = doc.RootElement;
                Check(request.Method == "POST" && request.Url == UpdatePackage.AuthorEventsUri(trust.AuthorBaseUrl).AbsoluteUri &&
                    evt.GetProperty("installationId").GetString() == installation && evt.GetProperty("attemptId").GetString() == attempt &&
                    evt.EnumerateObject().Select(x => x.Name).Order().SequenceEqual(new[] { "eventId", "installationId", "attemptId", "stage", "currentVersion", "targetVersion", "errorCode", "source" }.Order()), "Event JSON contains only contract fields at fixed endpoint");
            }
            Check(Enumerable.Range(0, 100).All(_ => telemetry.Queue("check", "2.8.1")), "Outbox accepts 100 valid events");
            Check(!telemetry.Queue("check", "2.8.1") && Directory.GetFiles(state, "*.json").Length == 101, "Outbox has hard 100-event limit plus settings");
            telemetry.Configure(false); await telemetry.FlushAsync();
            Check(Directory.GetFiles(state).Length == 0 && events.Requests.Count == 3, "Opt-out erases identifier and pending events and stops requests");
        }
        var retryState = Path.Combine(root, "telemetry-retry");
        using var failing = new RecordingHandler(_ => Json("{}", HttpStatusCode.ServiceUnavailable));
        using (var telemetry = new UpdateTelemetry(trust, failing, stateDirectory: retryState))
        {
            telemetry.Configure(true); telemetry.Queue("failed", "2.8.1", "2.8.2", "INSTALL_FAILED", attempt, "github");
            await telemetry.FlushAsync(); await telemetry.FlushAsync();
            Check(failing.Requests.Count == 2 && failing.Requests[0].Body == failing.Requests[1].Body, "Failed telemetry preserves same eventId for idempotent retry");
        }
        var slowState = Path.Combine(root, "telemetry-timeout");
        using (var telemetry = new UpdateTelemetry(trust, new StalledEventHandler(), stateDirectory: slowState))
        {
            telemetry.Configure(true); telemetry.Queue("check", "2.8.1"); telemetry.Queue("check", "2.8.1");
            var elapsed = Stopwatch.StartNew();
            await telemetry.FlushAsync();
            Check(elapsed.Elapsed < TimeSpan.FromSeconds(7) && Directory.GetFiles(slowState, "*.json").Length == 3,
                "Stalled reporting has one bounded deadline and retains pending events");
            File.WriteAllText(Path.Combine(slowState, "settings.json"), new string('x', 4097));
            Check(!telemetry.Queue("check", "2.8.1"), "Corrupt or oversized consent fails closed without blocking updates");
        }
        var elevatedState = Path.Combine(root, "telemetry-uac");
        string otherInstallation;
        using (var other = new UpdateTelemetry(trust, stateDirectory: elevatedState))
        { other.Configure(true); otherInstallation = other.ReadSettings()!.InstallationId; }
        var passedInstallation = Guid.NewGuid().ToString();
        using var elevatedEvents = new RecordingHandler(_ => Json("{}"));
        using (var elevated = new UpdateTelemetry(trust, elevatedEvents, passedInstallation, elevatedState))
        {
            elevated.Queue("installing", "2.8.1", "2.8.2", attemptId: attempt, source: "github");
            await elevated.FlushAsync();
            Check(elevatedEvents.Requests.Single().Body!.Contains(passedInstallation) && !elevatedEvents.Requests.Single().Body!.Contains(otherInstallation), "UAC uses initiating user's identifier, not administrator's");
        }
        var invocation = UpdateInvocation.Parse(["--install", root, "--installation-id", passedInstallation, "--attempt-id", attempt]);
        Check(invocation.InstallationId == passedInstallation && invocation.AttemptId == attempt, "Six-argument updater invocation retains installation and attempt IDs");
        invocation = UpdateInvocation.Parse(["--install", root, "--installation-id", passedInstallation, "--attempt-id", attempt, "--source", "github"]);
        Check(invocation.Source == "github" && UpdateInvocation.Parse(["--recover", "--installation-id", passedInstallation]).Recover, "Source and recovery consent survive UAC arguments");
        await Reject(() => { UpdateInvocation.Parse(["--install", root, "--installation-id", "../../escape"]); return Task.CompletedTask; }, "Invalid installation identifier rejected before paths");
    }
}

sealed class RecordingHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
{
    public List<(string Method, string Url, string? Body)> Requests { get; } = [];
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Requests.Add((request.Method.Method, request.RequestUri!.AbsoluteUri, request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken)));
        return respond(request);
    }
}

sealed class StalledEventHandler : HttpMessageHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        await Task.Delay(Timeout.Infinite, cancellationToken);
        return new(HttpStatusCode.OK);
    }
}
