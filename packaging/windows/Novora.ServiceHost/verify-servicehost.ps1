# Runs the Novora.ServiceHost fixes against isolated temporary directories only:
# no installed service, no ProgramData\Novora, no machine state. The verification sources
# are compiled into a throwaway project under $env:TEMP, so nothing here adds a project,
# build dependency or NuGet package to the repository.
#
#   powershell -NoProfile -File .\verify-servicehost.ps1
$ErrorActionPreference = 'Stop'

$serviceRoot = $PSScriptRoot
$updateRoot = Join-Path (Split-Path $serviceRoot -Parent) 'Novora.Update'
foreach ($required in @($serviceRoot, $updateRoot)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Missing source directory: $required" }
}

$workspace = Join-Path $env:TEMP ('novora-servicehost-verify-' + [guid]::NewGuid().ToString('N'))
$project = Join-Path $workspace 'project'
$runtime = Join-Path $workspace 'run'
New-Item -ItemType Directory -Force -Path $project, $runtime | Out-Null

try {
  # The service sources are compiled straight from the repository (read-only) so the checks
  # always see the current code, including the update engine that writes updater/state.json.
  $compile = @(
    'Verify.cs',
    (Join-Path $serviceRoot 'ServiceLogWriter.cs'),
    (Join-Path $serviceRoot 'UpdateStartGate.cs')
  ) | ForEach-Object { "    <Compile Include=`"$_`" />" }
  $compile += "    <Compile Include=`"$(Join-Path $updateRoot '*.cs')`" />"
  [IO.File]::WriteAllText((Join-Path $project 'NovoraServiceHostVerify.csproj'), (@'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <AssemblyName>NovoraServiceHostVerify</AssemblyName>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
  </PropertyGroup>
  <ItemGroup>
__COMPILE__
  </ItemGroup>
</Project>
'@).Replace('__COMPILE__', ($compile -join [Environment]::NewLine)))

  [IO.File]::WriteAllText((Join-Path $project 'Verify.cs'), @'
using System.Text;
using System.Text.RegularExpressions;
using Novora.ServiceHost;
using Novora.Update;
using System.Security.Cryptography;
using System.IO.Compression;
using System.Reflection;
using System.Text.Json;

static void Check(bool condition, string name) { if (!condition) throw new Exception("FAIL: " + name); Console.WriteLine("PASS: " + name); }

var root = args.Length == 1 ? args[0] : throw new Exception("usage: NovoraServiceHostVerify <temporary-workspace>");
Directory.CreateDirectory(root);
Console.WriteLine("Verification workspace: " + root);

// ---------------------------------------------------------------------------
// 1. The start gate refuses to run the service while an update is unfinished.
// ---------------------------------------------------------------------------
foreach (var phase in new[] { "stopping", "migrating", "switching", "repair-required" })
    Check(UpdateStartGate.BlocksStart(phase), "gate blocks unfinished update phase " + phase);
foreach (var phase in new[] { "preparing", "backing-up", "succeeded", "failed", "rolled-back" })
    Check(!UpdateStartGate.BlocksStart(phase), "gate permits phase " + phase);
Check(!UpdateStartGate.BlocksStart(null), "gate permits a machine without update state");

var minimalStateDirectory = Path.Combine(root, "minimal-state", "updater");
Directory.CreateDirectory(minimalStateDirectory);
File.WriteAllText(Path.Combine(minimalStateDirectory, "state.json"), "{\"phase\":\"repair-required\"}");
var minimalPhase = UpdateStartGate.ReadState(Path.Combine(minimalStateDirectory, "state.json"))?.Phase;
Check(minimalPhase == "repair-required" && UpdateStartGate.BlocksStart(minimalPhase), "a minimal state.json still blocks the service");

// ---------------------------------------------------------------------------
// 2. Phase names are asserted against what the update engine really writes.
//    UpdateEngine starts this very Windows service while state.json still holds
//    "verifying" and "rolling-back", so the gate must keep those startable.
// ---------------------------------------------------------------------------
foreach (var phase in new[] { "stopping", "migrating", "switching", "verifying", "rolling-back", "repair-required" })
    Check(UpdateEngine.NeedsRecovery(phase), "update engine still calls " + phase + " an unfinished update");

using var rsa = RSA.Create(2048);
var trust = new UpdateTrust("PikaNova/Novora", rsa.ExportSubjectPublicKeyInfoPem());
var packageRoot = Path.Combine(root, "package");
var packageSource = Path.Combine(packageRoot, "source");
Directory.CreateDirectory(packageSource);
var payload = Path.Combine(packageSource, "payload.zip");
using (var zip = ZipFile.Open(payload, ZipArchiveMode.Create))
{
    foreach (var (entry, content) in new[]
             {
                 ("dist/index.html", "test"), ("server-build/server/serve.js", "test"),
                 ("node_modules/test/index.js", "test"), ("package.json", "{\"version\":\"2.8.2\"}")
             })
        using (var writer = new StreamWriter(zip.CreateEntry(entry).Open())) writer.Write(content);
}
var manifest = new ReleaseManifest(1, "2.8.2", "2.8.1", "1.0.0", "win-x64", 24, "backward-compatible", "Test",
    "https://github.com/PikaNova/Novora/releases/download/v2.8.2/app.zip", new FileInfo(payload).Length,
    Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(payload))));
var manifestBytes = JsonSerializer.SerializeToUtf8Bytes(manifest, UpdatePackage.Json);
File.WriteAllBytes(Path.Combine(packageSource, "release-manifest.json"), manifestBytes);
File.WriteAllBytes(Path.Combine(packageSource, "release-manifest.sig"),
    rsa.SignData(manifestBytes, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
string Installation(string name)
{
    var directory = Path.Combine(root, name);
    Directory.CreateDirectory(directory);
    File.WriteAllText(Path.Combine(directory, "package.json"), "{\"version\":\"2.8.1\"}");
    return directory;
}
async Task<Exception?> ExpectFailure(Func<Task> action)
{
    try { await action(); return null; } catch (Exception error) { return error; }
}

var successful = new FakePlatform(Installation("update-success"));
await new UpdateEngine(successful.Root, successful).InstallAsync(packageSource, trust, default);
Check(successful.StartPhases.SequenceEqual(new[] { "verifying" }), "successful update starts the service while phase is verifying");
Check(successful.StartPhases.All(phase => !UpdateStartGate.BlocksStart(phase)), "the gate never blocks an updater-driven start");

var rolledBack = new FakePlatform(Installation("update-rollback")) { FailNewHealth = true };
var rolledBackEngine = new UpdateEngine(rolledBack.Root, rolledBack);
Check(await ExpectFailure(() => rolledBackEngine.InstallAsync(packageSource, trust, default)) is not null,
    "unhealthy new version is reported as failure");
Check(rolledBackEngine.ReadState()?.Phase == "rolled-back" && rolledBack.StartPhases.SequenceEqual(new[] { "verifying", "rolling-back" }),
    "rollback starts the restored service while phase is rolling-back");
Check(rolledBack.StartPhases.All(phase => !UpdateStartGate.BlocksStart(phase)), "rollback is never blocked by the gate");

var repair = new FakePlatform(Installation("update-repair")) { FailNewHealth = true, FailOldHealth = true };
var repairEngine = new UpdateEngine(repair.Root, repair);
Check(await ExpectFailure(() => repairEngine.InstallAsync(packageSource, trust, default)) is not null,
    "failed rollback is reported");
var repairPhase = repairEngine.ReadState()?.Phase;
Check(repairPhase == "repair-required" && UpdateStartGate.BlocksStart(repairPhase), "repair-required stops the service from starting broken");

var recovered = new FakePlatform(repair.Root);
await new UpdateEngine(recovered.Root, recovered).RecoverAsync();
Check(recovered.StartPhases.SequenceEqual(new[] { "rolling-back" }), "recovery from repair-required still starts the service");
Check(repairEngine.ReadState()?.Phase == "rolled-back", "recovery leaves a startable terminal phase");

// ---------------------------------------------------------------------------
// 3. Concurrent stdout/stderr writers keep every line, intact and in order.
// ---------------------------------------------------------------------------
var logDirectory = Path.Combine(root, "logs");
Directory.CreateDirectory(logDirectory);   // StartAsync creates this before the writer is opened
var logPath = Path.Combine(logDirectory, "novora-service.log");
var streams = new[] { "stdout", "stderr", "stdout-2", "stderr-2" };
const int linesPerStream = 2000;
const string padding = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
var linePattern = new Regex(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,7}([+-]\d{2}:\d{2}|Z) [a-z0-9-]+\|\d+\|x+$");
{
    var log = new ServiceLogWriter(logPath);
    var producers = streams.Select((tag, index) => Task.Run(() =>
    {
        for (var sequence = 1; sequence <= linesPerStream; sequence++)
        {
            log.Append(tag + "|" + sequence + "|" + padding);
            log.Append(null);
            if (sequence % 50 == 0) Thread.SpinWait(200 * (index + 1));
        }
    })).ToArray();
    Task.WhenAll(producers).GetAwaiter().GetResult();
    log.Dispose();

    var lines = File.ReadAllLines(logPath);
    Check(lines.Length == streams.Length * linesPerStream, "no log line is lost while stdout and stderr write together");
    Check(lines.All(line => linePattern.IsMatch(line)), "every log line is intact, none interleaved into fragments");
    var lastSequence = new Dictionary<string, int>();
    var inOrder = true;
    foreach (var line in lines)
    {
        var parts = line.Substring(line.IndexOf(' ') + 1).Split('|');
        if (lastSequence.TryGetValue(parts[0], out var previous) && int.Parse(parts[1]) != previous + 1) inOrder = false;
        lastSequence[parts[0]] = int.Parse(parts[1]);
    }
    Check(inOrder, "each stream keeps its own line order");
    Check(lastSequence.Count == streams.Length && lastSequence.Values.All(count => count == linesPerStream),
        "all producers reached their final line");
}

// ---------------------------------------------------------------------------
// 4. Rotation caps the total size and keeps the newest lines in write order.
// ---------------------------------------------------------------------------
var rotationDirectory = Path.Combine(root, "rotation");
Directory.CreateDirectory(rotationDirectory);
var rotationPath = Path.Combine(rotationDirectory, "novora-service.log");
const int rotationLines = 60000;
var fatLine = "|" + new string('y', 400);
{
    var log = new ServiceLogWriter(rotationPath);
    for (var sequence = 1; sequence <= rotationLines; sequence++) log.Append("r" + sequence + fatLine);
    log.Dispose();

    // Directory.GetFiles(pattern) also matches the active file through DOS semantics, so the
    // archives are filtered by their exact ".<n>" suffix instead.
    var archives = Directory.GetFiles(rotationDirectory)
        .Where(path => Path.GetFileName(path).StartsWith("novora-service.log.", StringComparison.Ordinal))
        .Order(StringComparer.Ordinal)
        .ToArray();
    Check(archives.Length == ServiceLogWriter.ArchivedFileCount,
        $"rotation keeps exactly {ServiceLogWriter.ArchivedFileCount} archives, found {archives.Length}: "
        + string.Join(", ", new[] { rotationPath }.Concat(archives).Select(path => Path.GetFileName(path) + "=" + new FileInfo(path).Length)));
    Check(new FileInfo(rotationPath).Length <= ServiceLogWriter.MaximumFileBytes
        && archives.All(path => new FileInfo(path).Length <= ServiceLogWriter.MaximumFileBytes),
        "no log file exceeds the size cap");
    var retained = archives.Reverse().Append(rotationPath)
        .SelectMany(path => File.ReadLines(path))
        .Select(line => int.Parse(line.Substring(line.IndexOf(' ') + 1).Split('|')[0][1..]))
        .ToArray();
    Check(retained.SequenceEqual(retained.Order()), "rotation preserves write order across the surviving files");
    Check(retained[^1] == rotationLines, "the newest lines always survive rotation");
    Check(retained[0] > 1, "the oldest lines are dropped instead of growing forever");
    Check(retained.Length < rotationLines, "total retained log size is bounded");
}

// ---------------------------------------------------------------------------
// 5. Stopping drains the queue; a broken log target never takes the service down.
// ---------------------------------------------------------------------------
var drainDirectory = Path.Combine(root, "drain");
Directory.CreateDirectory(drainDirectory);
var drainPath = Path.Combine(drainDirectory, "novora-service.log");
var drain = new ServiceLogWriter(drainPath);
for (var sequence = 1; sequence <= 5000; sequence++) drain.Append("d" + sequence);
drain.Dispose();
Check(File.ReadAllLines(drainPath).Length == 5000, "service stop flushes and drains the pending queue");
drain.Append("late line after stop");
Check(File.ReadAllLines(drainPath).Length == 5000, "a log callback after stop is a silent no-op");

var blockedPath = Path.Combine(root, "blocked");
File.WriteAllText(blockedPath, "this file occupies the log directory");
var blockedStart = DateTime.UtcNow;
var unwritable = new ServiceLogWriter(Path.Combine(blockedPath, "novora-service.log"));
for (var sequence = 1; sequence <= 4000; sequence++) unwritable.Append("b" + sequence);
unwritable.Dispose();
Check(DateTime.UtcNow - blockedStart < TimeSpan.FromSeconds(30), "an unwritable log path never hangs or crashes the service");
Check(!File.Exists(Path.Combine(blockedPath, "novora-service.log")), "nothing is written through an unusable path");

// ---------------------------------------------------------------------------
// 6. A failure outside the IO family must not end the writer thread, or Append
//    would keep filling an unbounded queue that nothing ever drains again.
// ---------------------------------------------------------------------------
Exception? induced = null;
try { File.AppendAllText(null!, "probe"); } catch (Exception error) { induced = error; }
Check(induced is not null && induced is not IOException && induced is not UnauthorizedAccessException,
    "the injected failure is outside the family Write already filters (" + induced?.GetType().Name + ")");

var resilienceDirectory = Path.Combine(root, "resilience");
Directory.CreateDirectory(resilienceDirectory);
var recoveryPath = Path.Combine(resilienceDirectory, "novora-service.log");
var pathField = typeof(ServiceLogWriter).GetField("filePath", BindingFlags.NonPublic | BindingFlags.Instance);
var threadField = typeof(ServiceLogWriter).GetField("writer", BindingFlags.NonPublic | BindingFlags.Instance);
Check(pathField is not null && threadField is not null, "the writer still exposes the private fields this case drives");

var survivor = new ServiceLogWriter(null!);   // every batch now throws ArgumentNullException
for (var sequence = 1; sequence <= 300; sequence++) survivor.Append("lost" + sequence);
Thread.Sleep(800);                             // past the retry backoff, so the failure has landed
Check(threadField!.GetValue(survivor) is Task failing && !failing.IsCompleted, "the writer thread survives a non-IO batch failure");
pathField!.SetValue(survivor, recoveryPath);   // the log target becomes usable again
for (var sequence = 1; sequence <= 400; sequence++) survivor.Append("kept|" + sequence);
survivor.Dispose();
var afterFailure = File.ReadAllLines(recoveryPath);
Check(afterFailure.Length == 400, "lines appended after that failure still reach the disk");
Check(afterFailure.Select(line => line.Substring(line.IndexOf(' ') + 1)).SequenceEqual(
        Enumerable.Range(1, 400).Select(sequence => "kept|" + sequence)), "and those lines keep their order");
Check(threadField.GetValue(survivor) is Task stopped && stopped.IsCompleted, "service stop still finishes the writer");

Console.WriteLine("All Novora.ServiceHost verification cases passed.");

sealed class FakePlatform(string root) : IUpdatePlatform
{
    public List<string> StartPhases { get; } = [];
    public bool FailNewHealth, FailOldHealth;
    public string Root { get; } = root;
    public Task PreflightAsync() => Task.CompletedTask;
    public Task BackupAsync() => Task.CompletedTask;
    public Task StopAsync() => Task.CompletedTask;
    public Task MigrateAsync(string directory, ReleaseManifest manifest) => Task.CompletedTask;
    public Task StartAsync()
    {
        StartPhases.Add(UpdateStartGate.ReadState(Path.Combine(Root, "updater", "state.json"))?.Phase ?? "(none)");
        return Task.CompletedTask;
    }
    public Task<bool> HealthyAsync(string expectedVersion) => Task.FromResult(expectedVersion == "2.8.2" ? !FailNewHealth : !FailOldHealth);
}
'@)

  $verify = Join-Path $project 'NovoraServiceHostVerify.csproj'
  & dotnet run --project $verify -c Release --no-launch-profile -- $runtime
  if ($LASTEXITCODE -ne 0) { throw "Novora.ServiceHost verification failed (exit $LASTEXITCODE)." }
}
finally {
  Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue
}
