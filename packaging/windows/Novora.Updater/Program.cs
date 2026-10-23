using System.Diagnostics;
using System.Security.Principal;
using System.Text.Json;
using Novora.Update;
using Novora.Updater;

var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, ".."));
var data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Novora");
using var mutex = new Mutex(false, @"Global\Novora.DatabaseMaintenance");
var owned = false;
UpdateTelemetry? telemetry = null;
try
{
    if (!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)) throw new InvalidOperationException("更新需要管理员权限。");
    try { owned = mutex.WaitOne(0); } catch (AbandonedMutexException) { owned = true; }
    if (!owned) throw new InvalidOperationException("另一个更新、备份或恢复操作正在执行。");
    var progress = new FileProgress(Path.Combine(root, "updater", "progress.json"));
    // Mutex ownership is thread-affine. Keep acquire/release on this entry thread.
    var invocation = UpdateInvocation.Parse(args);
    var trust = JsonSerializer.Deserialize<UpdateTrust>(File.ReadAllText(Path.Combine(root, "updater", "trust.json")), UpdatePackage.Json)
        ?? throw new InvalidDataException("缺少可信发布配置。");
    // Never inherit another UAC account's consent or installation identifier.
    if (invocation.InstallationId is not null)
        telemetry = new UpdateTelemetry(trust, optedInInstallationId: invocation.InstallationId,
            stateDirectory: Path.Combine(root, "updater", "telemetry", invocation.InstallationId));
    if (invocation.Recover)
        new UpdateEngine(root, new WindowsPlatform(root, data, progress), progress, telemetry).RecoverAsync().GetAwaiter().GetResult();
    else
        new UpdateEngine(root, new WindowsPlatform(root, data, progress), progress, telemetry)
            .InstallAsync(invocation.Directory!, trust, CancellationToken.None, invocation.AttemptId, invocation.Source).GetAwaiter().GetResult();
    return 0;
}
catch (Exception error)
{
    Directory.CreateDirectory(Path.Combine(root, "updater"));
    // Do not persist SQL output, connection strings, or native command lines.
    UpdatePackage.WriteAtomic(Path.Combine(root, "updater", "result.json"), new { ok = false, error = error.Message, time = DateTimeOffset.Now });
    Console.Error.WriteLine(error.Message);
    return 1;
}
finally
{
    if (owned) mutex.ReleaseMutex();
    telemetry?.FlushAsync().GetAwaiter().GetResult();
    telemetry?.Dispose();
}

sealed class FileProgress(string path) : IProgress<UpdateProgress>
{
    private readonly Stopwatch throttle = Stopwatch.StartNew();
    private string item = "";
    public void Report(UpdateProgress value)
    {
        if (item == value.Item && throttle.ElapsedMilliseconds < 250 && value.Current != value.Total) return;
        item = value.Item; throttle.Restart();
        try { UpdatePackage.WriteAtomic(path, value); }
        catch (IOException) { /* Progress display must not interrupt a transaction or rollback. */ }
    }
}

