using System.IO.Compression;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using Novora.Update;
using Novora.Updater;

static void Check(bool condition, string name) { if (!condition) throw new Exception("FAIL: " + name); Console.WriteLine("PASS: " + name); }
static async Task Reject(Func<Task> action, string name)
{
    try { await action(); } catch (Exception e) when (e is InvalidDataException or InvalidOperationException or IOException) { Check(true, name); return; }
    throw new Exception("FAIL: accepted " + name);
}
static Task Sync(Action action) { action(); return Task.CompletedTask; }
if (args is ["--database", var runtimeRoot, var databaseData])
{
    var platform = new WindowsPlatform(runtimeRoot, databaseData, new Progress<UpdateProgress>());
    await platform.BackupAsync();
    Check(Directory.GetFiles(Path.Combine(databaseData, "backups"), "novora-before-update-*.dump").Length == 1, "Real updater protection backup");
    var migrations = Path.Combine(databaseData, "migration-app");
    Directory.CreateDirectory(Path.Combine(migrations, "migrations"));
    File.WriteAllText(Path.Combine(migrations, "migrations/0001_update_probe.sql"), "CREATE TABLE update_probe(value text); INSERT INTO update_probe VALUES ('kept');");
    var manifest = new ReleaseManifest(1, "2.8.2", "2.8.1", "1.0.0", "win-x64", 24, "backward-compatible", "test", "", 1, "", ["migrations/0001_update_probe.sql"]);
    await platform.MigrateAsync(migrations, manifest);
    await platform.MigrateAsync(migrations, manifest);
    Check(true, "Real SQL migration ledger prevents duplicate execution");
    File.WriteAllText(Path.Combine(migrations, "migrations/0002_bad_probe.sql"), "INSERT INTO update_probe VALUES ('must-rollback'); SELECT * FROM missing_update_table;");
    await Reject(() => platform.MigrateAsync(migrations, manifest with { Version = "2.8.3", Migrations = ["migrations/0002_bad_probe.sql"] }), "Real SQL transaction failure reported");
    return;
}
var testRoot = Path.Combine(Path.GetTempPath(), "novora-updates-tests-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(testRoot);
using var rsa = RSA.Create(2048); // Disposable test key; never a production signing key.
var trust = new UpdateTrust("PikaNova/Novora", rsa.ExportSubjectPublicKeyInfoPem());

(string Source, ReleaseManifest Manifest, byte[] Bytes, byte[] Signature) Fixture(string name, Action<ZipArchive>? add = null)
{
    var source = Path.Combine(testRoot, name, "source");
    Directory.CreateDirectory(source);
    var payload = Path.Combine(source, "payload.zip");
    using (var zip = ZipFile.Open(payload, ZipArchiveMode.Create))
    {
        foreach (var (path, content) in new[] { ("dist/index.html", "test"), ("server-build/server/serve.js", "test"), ("node_modules/test/index.js", "test"), ("package.json", "{\"version\":\"2.8.2\"}") })
        { using var writer = new StreamWriter(zip.CreateEntry(path).Open()); writer.Write(content); }
        add?.Invoke(zip);
    }
    var manifest = new ReleaseManifest(1, "2.8.2", "2.8.1", "1.0.0", "win-x64", 24, "backward-compatible", "Test", "https://github.com/PikaNova/Novora/releases/download/v2.8.2/app.zip", new FileInfo(payload).Length, Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(payload))));
    var bytes = JsonSerializer.SerializeToUtf8Bytes(manifest, UpdatePackage.Json);
    var signature = rsa.SignData(bytes, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
    File.WriteAllBytes(Path.Combine(source, "release-manifest.json"), bytes);
    File.WriteAllBytes(Path.Combine(source, "release-manifest.sig"), signature);
    return (source, manifest, bytes, signature);
}
string Installation(string name)
{
    var root = Path.Combine(testRoot, name, "installed");
    Directory.CreateDirectory(root);
    File.WriteAllText(Path.Combine(root, "package.json"), "{\"version\":\"2.8.1\"}");
    return root;
}
try
{
    var valid = Fixture("valid");
    await UpdateContractTests.RunAsync(valid.Manifest, valid.Bytes, valid.Signature, rsa, testRoot);
    Check(UpdatePackage.VerifyManifest(valid.Bytes, valid.Signature, trust, "2.8.1").Version == "2.8.2", "Valid publisher signature");
    var modified = valid.Bytes.ToArray(); modified[^2] ^= 1;
    await Reject(() => Sync(() => UpdatePackage.VerifyManifest(modified, valid.Signature, trust, "2.8.1")), "Tampered manifest denied");
    using var wrong = RSA.Create(2048);
    await Reject(() => Sync(() => UpdatePackage.VerifyManifest(valid.Bytes, valid.Signature, trust with { PublicKeyPem = wrong.ExportSubjectPublicKeyInfoPem() }, "2.8.1")), "Wrong signing key denied");
    await Reject(() => Sync(() => UpdatePackage.VerifyManifest(valid.Bytes, valid.Signature, trust, "2.8.2")), "Downgrade/reinstall denied");
    Check(UpdatePackage.VerifyManifest(valid.Bytes, valid.Signature, trust, "2.8.2", requireNewer: false).Version == "2.8.2", "Signed latest-version check can report already current");
    await Reject(() => Sync(() => UpdatePackage.ValidateAssetUrl("https://github.com/attacker/project/releases/download/v/app.zip", trust.Repository)), "Other repository denied");
    await Reject(() => Sync(() => UpdatePackage.ValidateAssetUrl("http://github.com/PikaNova/Novora/releases/download/v/app.zip", trust.Repository)), "HTTP asset denied");
    var incompatible = valid.Manifest with { DatabaseMode = "destructive" };
    var incompatibleBytes = JsonSerializer.SerializeToUtf8Bytes(incompatible, UpdatePackage.Json);
    var fullOnly = UpdatePackage.VerifyManifest(incompatibleBytes, rsa.SignData(incompatibleBytes, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1), trust, "2.8.1");
    Check(!UpdatePackage.SupportsApplicationUpdate(fullOnly, "2.8.1"), "Incompatible release can be displayed but cannot use application update");
    var incompatibleSource = Path.Combine(testRoot, "incompatible-source"); Directory.CreateDirectory(incompatibleSource);
    File.WriteAllBytes(Path.Combine(incompatibleSource, "release-manifest.json"), incompatibleBytes);
    File.WriteAllBytes(Path.Combine(incompatibleSource, "release-manifest.sig"), rsa.SignData(incompatibleBytes, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
    var incompatiblePlatform = new FakePlatform();
    await Reject(() => new UpdateEngine(Installation("incompatible"), incompatiblePlatform).InstallAsync(incompatibleSource, trust, default), "Incompatible release cannot start install or backup");
    Check(incompatiblePlatform.Calls.Count == 0, "Incompatible application update leaves services untouched");
    var bad = Fixture("traversal", zip => { using var writer = new StreamWriter(zip.CreateEntry("../outside.txt").Open()); writer.Write("bad"); });
    await Reject(() => Sync(() => UpdatePackage.ExtractPayload(Path.Combine(bad.Source, "payload.zip"), Path.Combine(testRoot, "extracted"), null, default)), "ZIP traversal denied before extraction");
    Check(!Directory.Exists(Path.Combine(testRoot, "extracted")), "Invalid archive leaves no files");
    var secrets = Fixture("secrets", zip => { using var writer = new StreamWriter(zip.CreateEntry("config/.env").Open()); writer.Write("bad"); });
    await Reject(() => Sync(() => UpdatePackage.ExtractPayload(Path.Combine(secrets.Source, "payload.zip"), Path.Combine(testRoot, "secrets-out"), null, default)), "Configuration overwrite denied");
    var damaged = Fixture("damaged");
    File.AppendAllText(Path.Combine(damaged.Source, "payload.zip"), "bad");
    await Reject(() => UpdatePackage.VerifyPayloadAsync(Path.Combine(damaged.Source, "payload.zip"), damaged.Manifest, default), "Corrupt payload denied");
    var payloadBytes = File.ReadAllBytes(Path.Combine(valid.Source, "payload.zip"));
    var resumeDirectory = Path.Combine(testRoot, "resume"); Directory.CreateDirectory(resumeDirectory);
    File.WriteAllBytes(Path.Combine(resumeDirectory, "payload.zip.partial"), payloadBytes[..(payloadBytes.Length / 2)]);
    var handler = new DownloadHandler(payloadBytes);
    using (var client = new UpdateClient(handler))
        await client.DownloadAsync(new(valid.Manifest, valid.Bytes, valid.Signature), resumeDirectory, new Progress<UpdateProgress>(), default);
    Check(handler.RangeStart == payloadBytes.Length / 2 && File.ReadAllBytes(Path.Combine(resumeDirectory, "payload.zip")).SequenceEqual(payloadBytes), "Interrupted download resumes with verified Content-Range");
    File.Move(Path.Combine(resumeDirectory, "payload.zip"), Path.Combine(resumeDirectory, "payload.zip.partial"));
    handler = new DownloadHandler(payloadBytes);
    using (var client = new UpdateClient(handler))
        await client.DownloadAsync(new(valid.Manifest, valid.Bytes, valid.Signature), resumeDirectory, new Progress<UpdateProgress>(), default);
    Check(handler.Calls == 0, "Complete partial file verifies without invalid end-of-file range request");

    var platform = new FakePlatform();
    var installRoot = Installation("success");
    var eventDirectory = Path.Combine(testRoot, "engine-events");
    var installationId = Guid.NewGuid().ToString(); var attemptId = Guid.NewGuid().ToString();
    using var telemetry = new UpdateTelemetry(trust, optedInInstallationId: installationId, stateDirectory: eventDirectory);
    var engine = new UpdateEngine(installRoot, platform, telemetry: telemetry);
    await engine.InstallAsync(valid.Source, trust, default, attemptId, "github");
    Check(engine.ReadActive().Version == "2.8.2" && engine.ReadState()?.Phase == "succeeded", "Successful version switch persisted");
    Check(platform.Calls.SequenceEqual(new[] { "preflight", "backup", "stop", "migrate", "start", "health:2.8.2" }), "Backup precedes stop, migration precedes switch health");
    Check(File.Exists(Path.Combine(installRoot, "package.json")), "Original application retained");
    var observations = Directory.GetFiles(eventDirectory, "*.json").Select(path => JsonSerializer.Deserialize<UpdateEvent>(File.ReadAllText(path), UpdatePackage.Json)!).ToArray();
    Check(observations.Select(x => x.Stage).Order().SequenceEqual(new[] { "installing", "succeeded" }) &&
        observations.All(x => x.InstallationId == installationId && x.AttemptId == attemptId && x.Source == "github"), "Install stages preserve initiating identity, attempt and source");
    var deniedOutbox = Path.Combine(testRoot, "outbox-is-file"); File.WriteAllText(deniedOutbox, "unwritable queue fixture");
    using (var deniedTelemetry = new UpdateTelemetry(trust, optedInInstallationId: installationId, stateDirectory: deniedOutbox))
    {
        var deniedEngine = new UpdateEngine(Installation("telemetry-denied"), new FakePlatform(), telemetry: deniedTelemetry);
        await deniedEngine.InstallAsync(valid.Source, trust, default);
        Check(deniedEngine.ReadState()?.Phase == "succeeded", "Telemetry storage failure never interrupts installation");
    }

    platform = new FakePlatform { FailBackup = true };
    engine = new UpdateEngine(Installation("backup-failure"), platform);
    await Reject(() => engine.InstallAsync(valid.Source, trust, default), "Backup failure aborts update");
    Check(engine.ReadActive().Version == "2.8.1" && !platform.Calls.Contains("stop"), "Backup failure leaves running version untouched");

    platform = new FakePlatform { FailNewHealth = true };
    var rollbackEvents = Path.Combine(testRoot, "rollback-events");
    using var rollbackTelemetry = new UpdateTelemetry(trust, optedInInstallationId: installationId, stateDirectory: rollbackEvents);
    engine = new UpdateEngine(Installation("rollback"), platform, telemetry: rollbackTelemetry);
    await Reject(() => engine.InstallAsync(valid.Source, trust, default, attemptId, "offline"), "Bad new health triggers rollback");
    Check(engine.ReadActive().Version == "2.8.1" && engine.ReadState()?.Phase == "rolled-back", "Previous version restored and checked");
    observations = Directory.GetFiles(rollbackEvents, "*.json").Select(path => JsonSerializer.Deserialize<UpdateEvent>(File.ReadAllText(path), UpdatePackage.Json)!).ToArray();
    Check(observations.Count(x => x.Stage == "failed") == 1 && observations.Count(x => x.Stage == "rolled-back") == 1 &&
        observations.All(x => x.AttemptId == attemptId && x.Source == "offline"), "Failure and rollback reported once with same attempt");
    platform.FailNewHealth = false;
    await engine.InstallAsync(valid.Source, trust, default);
    Check(engine.ReadActive().Version == "2.8.2", "Failed version can be safely retried after rollback");

    platform = new FakePlatform { FailMigration = true };
    engine = new UpdateEngine(Installation("migration"), platform);
    await Reject(() => engine.InstallAsync(valid.Source, trust, default), "Migration failure triggers rollback");
    Check(engine.ReadActive().Version == "2.8.1" && engine.ReadState()?.Phase == "rolled-back", "Migration failure never marks update complete");

    platform = new FakePlatform { FailNewHealth = true, FailOldHealth = true };
    engine = new UpdateEngine(Installation("repair"), platform);
    await Reject(() => engine.InstallAsync(valid.Source, trust, default), "Rollback health failure reported");
    Check(engine.ReadState()?.Phase == "repair-required", "Repair state retained");
    await Reject(() => engine.InstallAsync(valid.Source, trust, default), "Unfinished update blocks another update");
    platform.FailOldHealth = false;
    await engine.RecoverAsync();
    Check(engine.ReadState()?.Phase == "rolled-back", "Interrupted/failed rollback recoverable");

    var interruptedRoot = Installation("interrupted");
    engine = new UpdateEngine(interruptedRoot, new FakePlatform());
    UpdatePackage.WriteAtomic(engine.StatePath, new UpdateState("migrating", "2.8.2", new("2.8.1", "."), "interrupted", DateTimeOffset.Now));
    await engine.RecoverAsync();
    Check(engine.ReadActive().Version == "2.8.1" && engine.ReadState()?.Phase == "rolled-back", "Power loss journal recovers previous application");
    UpdatePackage.WriteAtomic(engine.ActivePath, new ActiveVersion("2.8.2", "../../outside"));
    await Reject(() => Sync(() => engine.ReadActive()), "Active version path escape denied");
    using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
    var cancellationEngine = new UpdateEngine(Installation("cancelled"), new FakePlatform());
    try { await cancellationEngine.InstallAsync(valid.Source, trust, cancelled.Token); throw new Exception("Cancellation ignored"); }
    catch (OperationCanceledException) { Check(true, "Cancellation before installation leaves service untouched"); }

    var packageStage = Path.Combine(testRoot, "package-stage");
    UpdatePackage.ExtractPayload(Path.Combine(valid.Source, "payload.zip"), packageStage, null, default);
    File.WriteAllText(Path.Combine(packageStage, "package-lock.json"), "{}");
    var signingKey = Path.Combine(testRoot, "disposable-test-key.pem");
    File.WriteAllText(signingKey, rsa.ExportPkcs8PrivateKeyPem());
    var notesPath = Path.Combine(testRoot, "notes.txt"); File.WriteAllText(notesPath, "Test release");
    var setupFile = Path.Combine(testRoot, "packager-setup-fixture.exe"); File.WriteAllText(setupFile, "Never executed setup fixture");
    var setupUrl = "https://github.com/PikaNova/Novora/releases/download/v2.8.2/Novora-Setup-2.8.2.exe";
    var packaged = Path.Combine(testRoot, "packaged");
    var packager = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../Novora.Update.Packager/Novora.Update.Packager.csproj"));
    using (var process = new Process { StartInfo = new ProcessStartInfo("dotnet") { UseShellExecute = false, CreateNoWindow = true } })
    {
        foreach (var value in new[] { "run", "--project", packager, "-c", "Release", "--", packageStage, packaged, trust.Repository, "2.8.1", notesPath, signingKey, setupFile, setupUrl }) process.StartInfo.ArgumentList.Add(value);
        process.Start(); await process.WaitForExitAsync();
        Check(process.ExitCode == 0, "Release packager creates signed assets from staged application");
    }
    File.Delete(signingKey);
    var imported = Path.Combine(testRoot, "offline-import");
    var offline = await UpdateClient.ImportAsync(Path.Combine(packaged, "Novora-App-2.8.2-win-x64.nvu"), imported, trust, "2.8.1", new Progress<UpdateProgress>(), default);
    Check(offline.Manifest.Version == "2.8.2" && File.Exists(Path.Combine(imported, "payload.zip")), "Built offline package passes signature and payload verification");
    Check(offline.Manifest.Setup is { } setup && setup.Url == setupUrl && setup.Size == new FileInfo(setupFile).Length &&
        setup.Sha256 == Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(setupFile))), "Packager signs full setup URL, size and computed hash");
    var offlineEngine = new UpdateEngine(Installation("offline-install"), new FakePlatform());
    await offlineEngine.InstallAsync(imported, trust, default);
    Check(offlineEngine.ReadState()?.Phase == "succeeded", "Built offline package installs through verified update engine");
    Console.WriteLine("Update fixtures retained at " + testRoot);
}
finally { /* Retain isolated artifacts for inspection; no installed services/databases were touched. */ }

sealed class FakePlatform : IUpdatePlatform
{
    public List<string> Calls { get; } = [];
    public bool FailBackup, FailNewHealth, FailOldHealth, FailMigration;
    public Task PreflightAsync() { Calls.Add("preflight"); return Task.CompletedTask; }
    public Task BackupAsync() { Calls.Add("backup"); if (FailBackup) throw new IOException("Simulated backup error"); return Task.CompletedTask; }
    public Task StopAsync() { Calls.Add("stop"); return Task.CompletedTask; }
    public Task StartAsync() { Calls.Add("start"); return Task.CompletedTask; }
    public Task MigrateAsync(string directory, ReleaseManifest manifest) { Calls.Add("migrate"); if (FailMigration) throw new InvalidOperationException("Simulated migration failure"); return Task.CompletedTask; }
    public Task<bool> HealthyAsync(string version) { Calls.Add("health:" + version); return Task.FromResult(version == "2.8.2" ? !FailNewHealth : !FailOldHealth); }
}

sealed class DownloadHandler(byte[] bytes) : HttpMessageHandler
{
    public long? RangeStart;
    public int Calls;
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Calls++; RangeStart = request.Headers.Range?.Ranges.Single().From;
        var start = checked((int)(RangeStart ?? 0));
        var response = new HttpResponseMessage(RangeStart is null ? System.Net.HttpStatusCode.OK : System.Net.HttpStatusCode.PartialContent) { Content = new ByteArrayContent(bytes[start..]) };
        if (RangeStart is not null) response.Content.Headers.ContentRange = new System.Net.Http.Headers.ContentRangeHeaderValue(start, bytes.Length - 1, bytes.Length);
        return Task.FromResult(response);
    }
}
