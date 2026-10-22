using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;

namespace Novora.ControlCenter;

internal sealed record WindowsOptions(bool serviceAutoStart, bool databaseAutoStart, bool serviceAutoRestart,
    bool lanAccess, int port, bool trayStartup, bool desktopShortcut, bool startMenuShortcut, bool backupDaily, int backupKeep);
internal sealed record SettingsResult(bool Success, string Detail, string? InitialPassword);

internal static class WindowsManagement
{
    // restore-backup.ps1 can chain a 300s archive listing, two 1800s pg_dump/pg_restore
    // passes and bounded service waits; the wrapper must outlast that worst case.
    private const int BackupTimeoutSeconds = 4200;

    public static async Task<JsonElement> InspectAsync(CancellationToken token)
    {
        var script = Path.Combine(Runtime.Root, "inspect.ps1");
        if (!File.Exists(script)) throw new FileNotFoundException("缺少系统检查脚本，请使用完整发布目录。", script);
        using var process = new Process { StartInfo = new ProcessStartInfo("powershell.exe")
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            ArgumentList = { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
                $"[Console]::OutputEncoding = [Text.Encoding]::UTF8; & {Runtime.Quote(script)} -InstallRoot {Runtime.Quote(Runtime.Root)} -DataRoot {Runtime.Quote(Runtime.Data)}" }
        }};
        process.Start();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        // Cold inspection pays one-time ScheduledTasks/NetSecurity module loads; on the
        // school dual-core machines that alone approaches the old 20-second deadline.
        timeout.CancelAfter(TimeSpan.FromSeconds(45));
        var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
        var error = process.StandardError.ReadToEndAsync(timeout.Token);
        try
        {
            await process.WaitForExitAsync(timeout.Token);
            var text = await output;
            var detail = await error;
            if (process.ExitCode != 0) throw new InvalidOperationException("系统检查失败：" + detail);
            using var document = JsonDocument.Parse(text);
            return document.RootElement.Clone();
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(true); } catch (InvalidOperationException) { }
            if (!token.IsCancellationRequested) throw new TimeoutException("系统检查超过 45 秒，请重试。");
            throw;
        }
    }

    public static async Task<SettingsResult> ApplyAsync(WindowsOptions options, CancellationToken token, IProgress<OperationProgress>? progress = null)
    {
        var directory = Path.Combine(Path.GetTempPath(), $"novora-settings-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        var optionsPath = Path.Combine(directory, "options.json");
        var resultPath = Path.Combine(directory, "result.json");
        try
        {
            await File.WriteAllTextAsync(optionsPath, JsonSerializer.Serialize(options), token);
            try
            {
                await Runtime.RunElevatedAsync($"& {Runtime.Quote(Path.Combine(Runtime.Root, "initialize.ps1"))} -OptionsFile {Runtime.Quote(optionsPath)} -ResultFile {Runtime.Quote(resultPath)} -InstallRoot {Runtime.Quote(Runtime.Root)} -DataRoot {Runtime.Quote(Runtime.Data)}", token, progress);
            }
            catch (InvalidOperationException) when (File.Exists(resultPath))
            {
                using var failure = JsonDocument.Parse(await File.ReadAllTextAsync(resultPath, token));
                if (failure.RootElement.TryGetProperty("error", out var error))
                {
                    var partial = failure.RootElement.TryGetProperty("applied", out var entries)
                        ? string.Join("\n", entries.EnumerateArray().Select(x => "✓ " + x.GetString())) : "";
                    throw new InvalidOperationException(error.GetString() + "\n已应用项目：\n" + partial + "\n处理后可重试；之前应用的设置会保留。");
                }
            }
            using var document = JsonDocument.Parse(await File.ReadAllTextAsync(resultPath, token));
            var result = document.RootElement;
            var warnings = result.GetProperty("warnings").EnumerateArray().Select(x => x.GetString()).ToArray();
            var applied = string.Join("\n", result.GetProperty("applied").EnumerateArray().Select(x => "✓ " + x.GetString()));
            // Bootstrap credentials are intentionally not copied into general UI messages or diagnostics.
            var account = result.TryGetProperty("adminCredentialState", out var credential) ? credential.GetString() : "unknown";
            var password = account == "uninitialized" && result.TryGetProperty("adminPassword", out var initialPassword) ? initialPassword.GetString() : null;
            // Only a fatal failure (services, database, required files, port/configuration)
            // clears ok; warnings stay visible but do not turn the operation into a failure.
            return new(result.GetProperty("ok").GetBoolean(), applied +
                (warnings.Length > 0 ? "\n需要检查（不影响本次已完成的服务与数据库验证）：\n" + string.Join("\n", warnings) : "") +
                $"\n管理员账户初始化状态：{account}\n业务初始化请打开管理端完成。\n当前地址：http://127.0.0.1:{options.port}", password);
        }
        finally
        {
            foreach (var path in new[] { optionsPath, resultPath })
                try { File.Delete(path); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            try { Directory.Delete(directory); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }

    public static async Task<string> RunBackupScriptAsync(string script, string? backupName = null, int keep = 14,
        IProgress<OperationProgress>? progress = null, CancellationToken token = default)
    {
        var output = Path.Combine(Path.GetTempPath(), $"novora-operation-{Guid.NewGuid():N}.txt");
        var command = $"& {Runtime.Quote(Path.Combine(Runtime.Root, script))} -InstallRoot {Runtime.Quote(Runtime.Root)} -DataRoot {Runtime.Quote(Runtime.Data)}";
        if (backupName is not null) command += $" -BackupFile {Runtime.Quote(Path.Combine(Runtime.Data, "backups", backupName))}";
        if (script == "backup.ps1") command += $" -BackupRoot {Runtime.Quote(Path.Combine(Runtime.Data, "backups"))} -Keep {keep}";
        try
        {
            try { await Runtime.RunElevatedAsync($"& {{ try {{ {command} }} catch {{ Write-Error $_ -ErrorAction Continue; exit 1 }} }} *> {Runtime.Quote(output)}", token, progress, BackupTimeoutSeconds); }
            catch (InvalidOperationException)
            {
                var detail = File.Exists(output) ? string.Join("\n", Runtime.ReadLogTail(output).TakeLast(20)) : "请查看日志。";
                throw new InvalidOperationException(detail);
            }
            return File.Exists(output) ? string.Join("\n", Runtime.ReadLogTail(output).TakeLast(20)) : "操作已完成。";
        }
        finally { try { File.Delete(output); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
    }
}
