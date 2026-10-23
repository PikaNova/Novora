using System.Text.Json;

namespace Novora.Update;

public sealed record ActiveVersion(string Version, string Directory);
public sealed record UpdateState(string Phase, string TargetVersion, ActiveVersion Previous, string Detail, DateTimeOffset Time, string? AttemptId = null, string? Source = null);

public interface IUpdatePlatform
{
    Task PreflightAsync();
    Task BackupAsync();
    Task StopAsync();
    Task MigrateAsync(string directory, ReleaseManifest manifest);
    Task StartAsync();
    Task<bool> HealthyAsync(string expectedVersion);
}

public sealed class UpdateEngine(string root, IUpdatePlatform platform, IProgress<UpdateProgress>? progress = null, UpdateTelemetry? telemetry = null)
{
    public string StatePath => Path.Combine(root, "updater", "state.json");
    public string ActivePath => Path.Combine(root, "active-version.json");
    public ActiveVersion ReadActive() => ReadActive(root);

    public static ActiveVersion ReadActive(string root)
    {
        var path = Path.Combine(root, "active-version.json");
        if (!File.Exists(path))
        {
            using var package = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "package.json")));
            var version = package.RootElement.GetProperty("version").GetString()!;
            UpdatePackage.ParseVersion(version);
            return new(version, ".");
        }
        var active = JsonSerializer.Deserialize<ActiveVersion>(File.ReadAllText(path), UpdatePackage.Json) ?? throw new InvalidDataException("活动版本配置无效。");
        UpdatePackage.ParseVersion(active.Version);
        if (active.Directory != "." && active.Directory != "versions/" + active.Version) throw new InvalidDataException("活动版本路径无效。");
        return active;
    }

    public UpdateState? ReadState() => File.Exists(StatePath) ? JsonSerializer.Deserialize<UpdateState>(File.ReadAllText(StatePath), UpdatePackage.Json) : null;
    public static bool NeedsRecovery(string phase) => phase is "stopping" or "migrating" or "switching" or "verifying" or "rolling-back" or "repair-required";

    public async Task InstallAsync(string source, UpdateTrust trust, CancellationToken token, string? updateAttemptId = null, string? updateSource = null)
    {
        if (ReadState() is { } existing && NeedsRecovery(existing.Phase)) throw new InvalidOperationException("存在未完成更新，请先恢复上一可用版本。");
        var previous = ReadActive();
        var attemptId = Guid.TryParse(updateAttemptId, out var parsedAttempt) ? parsedAttempt.ToString() : Guid.NewGuid().ToString();
        token.ThrowIfCancellationRequested();
        var manifestBytes = UpdatePackage.ReadBounded(Path.Combine(source, "release-manifest.json"), 64 * 1024);
        var signature = UpdatePackage.ReadBounded(Path.Combine(source, "release-manifest.sig"), 1024);
        var manifest = UpdatePackage.VerifyManifest(manifestBytes, signature, trust, previous.Version);
        if (!UpdatePackage.SupportsApplicationUpdate(manifest, previous.Version))
            throw new InvalidOperationException("此版本不满足应用包兼容要求，请下载签名清单指定的完整安装包。");
        var destination = Path.Combine(root, "versions", manifest.Version);
        var staging = destination + ".staging-" + Guid.NewGuid().ToString("N");
        void State(string phase, string detail)
        {
            var state = new UpdateState(phase, manifest.Version, previous, detail, DateTimeOffset.Now, attemptId, updateSource);
            UpdatePackage.WriteAtomic(StatePath, state);
            if (phase is "succeeded" or "failed" or "rolled-back" or "repair-required") RecordHistory(state);
            var stage = phase switch { "stopping" => "installing", "succeeded" => "succeeded", "failed" => "failed", "rolled-back" => "rolled-back", _ => null };
            if (stage is not null)
            {
                var current = stage == "succeeded" ? manifest.Version : previous.Version;
                telemetry?.Queue(stage, current, manifest.Version, stage is "failed" or "rolled-back" ? "INSTALL_FAILED" : null, attemptId, updateSource);
            }
            progress?.Report(new(detail));
        }
        var stopping = false;
        var createdVersion = false;
        try
        {
            State("preparing", "检查安装状态与运行环境");
            await platform.PreflightAsync();
            token.ThrowIfCancellationRequested();
            if (Directory.Exists(destination)) throw new InvalidOperationException("目标版本目录已存在，请使用完整安装包修复或联系管理员检查。");
            // Copy untrusted user cache into an administrator-owned location before validating/extracting.
            Directory.CreateDirectory(staging);
            var payload = Path.Combine(staging, "payload.zip");
            File.Copy(Path.Combine(source, "payload.zip"), payload);
            State("preparing", "验证签名与应用文件完整性");
            await UpdatePackage.VerifyPayloadAsync(payload, manifest, token);
            var application = Path.Combine(staging, "application");
            UpdatePackage.ExtractPayload(payload, application, progress, token);
            using (var package = JsonDocument.Parse(File.ReadAllText(Path.Combine(application, "package.json"))))
                if (package.RootElement.GetProperty("version").GetString() != manifest.Version) throw new InvalidDataException("应用版本与签名清单不一致。");
            State("backing-up", "创建数据库保护备份，业务服务继续运行");
            await platform.BackupAsync();
            token.ThrowIfCancellationRequested();
            Directory.Move(application, destination);
            createdVersion = true;
            State("stopping", "停止业务服务，准备切换版本");
            stopping = true;
            await platform.StopAsync();
            State("migrating", "执行与上一版兼容的数据库迁移");
            await platform.MigrateAsync(destination, manifest);
            State("switching", "切换应用版本");
            UpdatePackage.WriteAtomic(ActivePath, new ActiveVersion(manifest.Version, "versions/" + manifest.Version));
            State("verifying", "启动新版本并检查实际版本与 HTTP 健康");
            await platform.StartAsync();
            if (!await platform.HealthyAsync(manifest.Version)) throw new InvalidOperationException("新版健康检查失败。");
            State("succeeded", "更新成功，上一可用版本与数据库保护备份已保留");
        }
        catch (Exception error)
        {
            if (stopping) telemetry?.Queue("failed", previous.Version, manifest.Version, "INSTALL_FAILED", attemptId, updateSource);
            if (stopping)
            {
                State("rolling-back", "更新失败，正在恢复上一可用应用版本");
                try
                {
                    await platform.StopAsync();
                    UpdatePackage.WriteAtomic(ActivePath, previous);
                    await platform.StartAsync();
                    if (!await platform.HealthyAsync(previous.Version)) throw new InvalidOperationException("旧版健康检查失败。");
                    State("rolled-back", "更新失败，已恢复上一可用版本。数据库保护备份已保留。");
                }
                catch { State("repair-required", "自动恢复未完成，请查看更新记录并修复。数据库保护备份已保留。"); }
            }
            else State("failed", "更新未完成，未切换应用版本。");
            throw new InvalidOperationException(ReadState()!.Detail + " " + error.Message, error);
        }
        finally
        {
            // Only this invocation's exact GUID staging directory is removed.
            if (Directory.Exists(staging)) Directory.Delete(staging, true);
            // Failed prepared code can be downloaded/retried again. Never delete an active or unrecovered version.
            if (createdVersion && ReadState()?.Phase is "failed" or "rolled-back" && ReadActive().Version != manifest.Version)
            {
                var expected = Path.GetFullPath(Path.Combine(root, "versions", manifest.Version));
                if (Path.GetFullPath(destination) != expected || Path.GetDirectoryName(expected) != Path.GetFullPath(Path.Combine(root, "versions")))
                    throw new InvalidDataException("更新清理路径超出版本目录。");
                if (Directory.Exists(expected)) Directory.Delete(expected, true);
            }
        }
    }

    public async Task RecoverAsync()
    {
        var state = ReadState() ?? throw new InvalidOperationException("没有更新记录。");
        if (!NeedsRecovery(state.Phase)) throw new InvalidOperationException("当前没有需要恢复的更新。");
        UpdatePackage.ParseVersion(state.Previous.Version);
        if (state.Previous.Directory != "." && state.Previous.Directory != "versions/" + state.Previous.Version) throw new InvalidDataException("恢复路径无效。");
        progress?.Report(new("恢复上次更新前的应用版本"));
        var attemptId = state.AttemptId ?? Guid.NewGuid().ToString();
        await platform.StopAsync();
        UpdatePackage.WriteAtomic(ActivePath, state.Previous);
        UpdatePackage.WriteAtomic(StatePath, state with { Phase = "rolling-back", Detail = "正在验证恢复结果", Time = DateTimeOffset.Now });
        await platform.StartAsync();
        if (!await platform.HealthyAsync(state.Previous.Version)) throw new InvalidOperationException("上一版本健康检查未通过，请使用完整安装包修复。");
        UpdatePackage.WriteAtomic(StatePath, state with { Phase = "rolled-back", Detail = "已恢复上一可用版本", Time = DateTimeOffset.Now, AttemptId = attemptId });
        RecordHistory(ReadState()!);
        telemetry?.Queue("rolled-back", state.Previous.Version, state.TargetVersion, "RECOVERY_COMPLETED", attemptId, state.Source);
    }

    private void RecordHistory(UpdateState state)
    {
        try
        {
            var path = Path.Combine(root, "updater", "history.json");
            var entries = File.Exists(path)
                ? JsonSerializer.Deserialize<UpdateState[]>(UpdatePackage.ReadBounded(path, 256 * 1024), UpdatePackage.Json) ?? [] : [];
            UpdatePackage.WriteAtomic(path, entries.Append(state).TakeLast(50).ToArray());
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException) { /* Latest state remains authoritative. */ }
    }
}
