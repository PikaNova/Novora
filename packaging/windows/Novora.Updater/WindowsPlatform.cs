using System.Diagnostics;
using System.Text.Json;
using Novora.Update;

namespace Novora.Updater;

public sealed class WindowsPlatform(string root, string data, IProgress<UpdateProgress> progress) : IUpdatePlatform
{
    private static async Task<string> RunAsync(string executable, IEnumerable<string> arguments, TimeSpan timeout, Dictionary<string, string>? environment = null, string? input = null)
    {
        using var process = new Process { StartInfo = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = input is not null } };
        foreach (var argument in arguments) process.StartInfo.ArgumentList.Add(argument);
        if (environment is not null) foreach (var pair in environment) process.StartInfo.Environment[pair.Key] = pair.Value;
        process.Start();
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        using var deadline = new CancellationTokenSource(timeout);
        try
        {
            if (input is not null) { await process.StandardInput.WriteAsync(input); process.StandardInput.Close(); }
            await process.WaitForExitAsync(deadline.Token);
            var result = await output;
            await error;
            if (process.ExitCode != 0) throw new InvalidOperationException($"{Path.GetFileName(executable)} 执行失败（{process.ExitCode}），请检查服务或数据库日志。");
            return result;
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(true); } catch (InvalidOperationException) { }
            throw new TimeoutException($"{Path.GetFileName(executable)} 执行超时。");
        }
    }
    private static Task<string> PowerShell(string command) => RunAsync("powershell.exe", new[] { "-NoProfile", "-NonInteractive", "-EncodedCommand",
        Convert.ToBase64String(System.Text.Encoding.Unicode.GetBytes("$ErrorActionPreference='Stop'; " + command)) }, TimeSpan.FromSeconds(100));

    private (Uri Uri, Dictionary<string, string> Environment) Database()
    {
        var line = File.ReadLines(Path.Combine(data, "config", ".env")).First(x => x.StartsWith("DATABASE_URL="));
        var uri = new Uri(line["DATABASE_URL=".Length..].Trim().Trim('"', '\''));
        if (uri.Host is not ("localhost" or "127.0.0.1") || uri.Port <= 0 || uri.Port == 5432 || uri.AbsolutePath != "/novora" || uri.UserInfo.Split(':')[0] != "novora")
            throw new InvalidDataException("更新仅适用于 Novora 安装器管理的独立数据库。");
        var password = File.ReadAllText(Path.Combine(data, "config", ".db-password")).Trim();
        if (password.Length == 0) throw new InvalidDataException("数据库凭据为空。");
        return (uri, new() { ["PGPASSWORD"] = password, ["PGCONNECT_TIMEOUT"] = "5" });
    }
    public async Task PreflightAsync()
    {
        if (!Environment.Is64BitProcess) throw new InvalidOperationException("更新程序需要 Windows x64。");
        await PowerShell("foreach($n in @('Novora','NovoraPostgreSQL')) { if ((Get-Service $n).Status -ne 'Running') { throw '请先修复并启动服务。' } }");
        var node = await RunAsync(Path.Combine(root, "runtime", "node.exe"), new[] { "--version" }, TimeSpan.FromSeconds(10));
        if (!node.Trim().StartsWith("v24.", StringComparison.Ordinal)) throw new InvalidOperationException("需要 Node.js 24，请使用完整安装包升级。");
        if (new DriveInfo(Path.GetPathRoot(root)!).AvailableFreeSpace < 5L * 1024 * 1024 * 1024) throw new IOException("应用磁盘至少需要 5 GB 可用空间。");
        _ = Database();
        if (!await HealthyAsync(UpdateEngine.ReadActive(root).Version)) throw new InvalidOperationException("当前版本健康检查未通过，请先修复服务。");
    }
    public async Task BackupAsync()
    {
        var database = Database();
        var directory = Path.Combine(data, "backups");
        Directory.CreateDirectory(directory);
        if (new DriveInfo(Path.GetPathRoot(data)!).AvailableFreeSpace < 1024L * 1024 * 1024) throw new IOException("备份磁盘至少需要 1 GB 可用空间。");
        var path = Path.Combine(directory, $"novora-before-update-{DateTime.Now:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}.dump");
        var partial = path + ".partial";
        try
        {
            await RunAsync(Path.Combine(root, "postgres", "bin", "pg_dump.exe"), new[] { "-w", "-h", "127.0.0.1", "-p", database.Uri.Port.ToString(), "-U", "novora", "-d", "novora", "-Fc", "--no-owner", "--no-privileges", "-f", partial }, TimeSpan.FromHours(2), database.Environment);
            await RunAsync(Path.Combine(root, "postgres", "bin", "pg_restore.exe"), new[] { "--list", partial }, TimeSpan.FromMinutes(5));
            File.Move(partial, path);
        }
        finally { if (File.Exists(partial)) File.Delete(partial); }
    }
    public async Task StopAsync() => await PowerShell("Stop-Service Novora -Force; (Get-Service Novora).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(45))");
    public async Task StartAsync() => await PowerShell("Start-Service Novora; (Get-Service Novora).WaitForStatus('Running',[TimeSpan]::FromSeconds(45))");
    public async Task MigrateAsync(string directory, ReleaseManifest manifest)
    {
        if (manifest.Migrations is not { Length: > 0 }) return;
        var database = Database();
        var sql = new System.Text.StringBuilder("CREATE TABLE IF NOT EXISTS public.novora_windows_updates (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());\n");
        sql.AppendLine($"SELECT EXISTS(SELECT 1 FROM public.novora_windows_updates WHERE version='{manifest.Version}') AS already_applied \\gset");
        sql.AppendLine("\\if :already_applied\n\\else");
        foreach (var relative in manifest.Migrations)
        {
            var path = Path.Combine(directory, relative);
            if (!File.Exists(path)) throw new InvalidDataException("缺少签名清单指定的迁移文件。");
            // Release migrations are trusted SQL, executed transactionally and never logged by the updater.
            sql.AppendLine(File.ReadAllText(path));
        }
        sql.AppendLine($"INSERT INTO public.novora_windows_updates(version) VALUES ('{manifest.Version}');\n\\endif");
        await RunAsync(Path.Combine(root, "postgres", "bin", "psql.exe"), new[] { "-X", "-w", "-h", "127.0.0.1", "-p", database.Uri.Port.ToString(), "-U", "novora", "-d", "novora", "--single-transaction", "-v", "ON_ERROR_STOP=1", "-f", "-" }, TimeSpan.FromMinutes(10), database.Environment, sql.ToString());
    }
    public async Task<bool> HealthyAsync(string expectedVersion)
    {
        var portLine = File.ReadLines(Path.Combine(data, "config", ".env")).FirstOrDefault(x => x.StartsWith("PORT="));
        var port = portLine is not null && int.TryParse(portLine[5..].Trim().Trim('"', '\''), out var value) ? value : 3000;
        using var http = new HttpClient(new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(3) };
        var watch = Stopwatch.StartNew();
        do
        {
            progress.Report(new($"等待 {expectedVersion} 健康检查 · 已等待 {(int)watch.Elapsed.TotalSeconds} 秒 / 90 秒"));
            try
            {
                using var response = await http.GetAsync($"http://127.0.0.1:{port}/api/health", HttpCompletionOption.ResponseHeadersRead);
                if (response.IsSuccessStatusCode)
                {
                    using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                    await using var stream = await response.Content.ReadAsStreamAsync(deadline.Token);
                    var buffer = new byte[16385];
                    var count = await stream.ReadAtLeastAsync(buffer, buffer.Length, false, deadline.Token);
                    if (count < buffer.Length)
                    {
                        using var json = JsonDocument.Parse(buffer.AsMemory(0, count));
                        if (json.RootElement.GetProperty("ok").GetBoolean() && json.RootElement.GetProperty("version").GetString() == expectedVersion) return true;
                    }
                }
            }
            catch (Exception e) when (e is HttpRequestException or OperationCanceledException or JsonException or KeyNotFoundException or IOException) { }
            await Task.Delay(500);
        } while (watch.Elapsed < TimeSpan.FromSeconds(90));
        return false;
    }
}
