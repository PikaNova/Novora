using ClassIsland.ExamReminder.Models;
using Microsoft.Extensions.Hosting;

namespace ClassIsland.ExamReminder.Services;

public sealed class ExamSyncService : BackgroundService
{
    private static readonly TimeSpan SyncInterval = TimeSpan.FromSeconds(30);
    private readonly PluginSettingsStore _store;
    private readonly ExamBoardClient _client;
    private readonly ExamReminderProvider _provider;
    private readonly ExternalUriLauncher _uriLauncher;
    private ExamBoardBootstrapResponse? _snapshot;
    private DateTimeOffset _nextSyncAt = DateTimeOffset.MinValue;
    private DateTimeOffset _nextBrowserOpenAttemptAt = DateTimeOffset.MinValue;

    public ExamSyncService(
        PluginSettingsStore store,
        ExamBoardClient client,
        ExamReminderProvider provider,
        ExternalUriLauncher uriLauncher)
    {
        _store = store;
        _client = client;
        _provider = provider;
        _uriLauncher = uriLauncher;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        while (!stoppingToken.IsCancellationRequested)
        {
            if (DateTimeOffset.UtcNow >= _nextSyncAt)
            {
                await SynchronizeAsync(stoppingToken);
                _nextSyncAt = DateTimeOffset.UtcNow + SyncInterval;
            }

            EvaluateSchedule();
            if (!await timer.WaitForNextTickAsync(stoppingToken))
            {
                break;
            }
        }
    }

    public void RequestImmediateSync() => _nextSyncAt = DateTimeOffset.MinValue;

    private async Task SynchronizeAsync(CancellationToken cancellationToken)
    {
        var settings = _store.Settings;
        if (string.IsNullOrWhiteSpace(settings.BaseUrl))
        {
            return;
        }

        if (!settings.IsPaired)
        {
            if (string.IsNullOrWhiteSpace(settings.PendingPairToken))
            {
                return;
            }
            var pairResult = await _client.GetPairStatusAsync(settings, cancellationToken);
            if (!pairResult.IsSuccess || pairResult.Value is null)
            {
                _store.Update(value => value.LastStatus = pairResult.Error ?? "等待浏览器完成班级配对");
                return;
            }
            if (!pairResult.Value.Paired)
            {
                _store.Update(value => value.LastStatus = "等待浏览器完成班级配对");
                return;
            }
            _store.Update(value =>
            {
                value.IsPaired = true;
                value.BoundClassTag = pairResult.Value.ClassTag ?? string.Empty;
                value.PendingPairToken = string.Empty;
                value.PairExpiresAt = null;
                value.LastStatus = "班级配对成功，正在同步考试";
            });
        }

        var result = await _client.GetBootstrapAsync(settings, cancellationToken);
        if (!result.IsSuccess || result.Value is null)
        {
            _store.Update(value => value.LastStatus = result.Error ?? "考试同步失败");
            return;
        }
        if (result.Value.ApiVersion > 2)
        {
            _store.Update(value => value.LastStatus = "考试看板 API 版本过新，请更新 ClassIsland 插件");
            return;
        }

        _snapshot = result.Value;
        var offset = result.Value.ServerTime - DateTimeOffset.UtcNow;
        var nextExam = result.Value.Exams
            .Where(exam => exam.EndAt > result.Value.ServerTime)
            .OrderBy(exam => exam.StartAt)
            .FirstOrDefault();
        _store.Update(value =>
        {
            value.IsPaired = true;
            value.BoundClassTag = result.Value.Binding?.ClassTag ?? value.BoundClassTag;
            value.LastSyncAt = DateTimeOffset.Now;
            value.ServerOffsetMilliseconds = (long)offset.TotalMilliseconds;
            value.NextExamName = nextExam?.Name ?? string.Empty;
            value.NextExamStartAt = nextExam?.StartAt;
            value.LastStatus = "已同步考试看板";
        });
    }

    private void EvaluateSchedule()
    {
        if (_snapshot is null)
        {
            return;
        }

        var settings = _store.Settings;
        var now = DateTimeOffset.UtcNow.AddMilliseconds(settings.ServerOffsetMilliseconds);
        foreach (var exam in _snapshot.Exams.OrderBy(value => value.StartAt))
        {
            var remaining = exam.StartAt - now;
            if (remaining <= TimeSpan.Zero && remaining > TimeSpan.FromMinutes(-2))
            {
                TriggerReminder(exam, 0, "start", settings.EnableStartReminder);
                continue;
            }
            if (remaining <= TimeSpan.Zero)
            {
                continue;
            }

            if (remaining <= TimeSpan.FromMinutes(settings.BrowserLeadMinutes) && settings.AutoOpenBoard)
            {
                var key = ActionKey(exam, "open");
                if (!_store.HasCompletedAction(key) && _snapshot.ViewerOnline)
                {
                    _store.MarkCompletedAction(key);
                }
                else if (!_store.HasCompletedAction(key) && now >= _nextBrowserOpenAttemptAt)
                {
                    if (OpenBoard(settings, out var error))
                    {
                        _store.MarkCompletedAction(key);
                    }
                    else
                    {
                        _nextBrowserOpenAttemptAt = now.AddMinutes(1);
                        _store.Update(value => value.LastStatus = $"无法自动打开考试看板：{error}");
                    }
                }
            }
            if (remaining <= TimeSpan.FromMinutes(15) && remaining > TimeSpan.FromMinutes(5))
            {
                TriggerReminder(exam, Math.Max(1, (int)Math.Ceiling(remaining.TotalMinutes)),
                    "reminder-15", settings.EnableFifteenMinuteReminder);
            }
            if (remaining <= TimeSpan.FromMinutes(5))
            {
                TriggerReminder(exam, Math.Max(1, (int)Math.Ceiling(remaining.TotalMinutes)),
                    "reminder-5", settings.EnableFiveMinuteReminder);
            }
        }
    }

    private void TriggerReminder(ExamBoardExam exam, int minutes, string action, bool enabled)
    {
        if (!enabled)
        {
            return;
        }
        var key = ActionKey(exam, action);
        if (_store.HasCompletedAction(key))
        {
            return;
        }
        _provider.ShowExamReminder(exam, minutes);
        _store.MarkCompletedAction(key);
    }

    private bool OpenBoard(PluginSettings settings, out string error) =>
        _uriLauncher.TryOpen(ExamBoardUrls.Board(settings.BaseUrl, settings.PluginInstanceId), out error);

    private static string ActionKey(ExamBoardExam exam, string action) =>
        $"{exam.Id}|{exam.StartAt.UtcTicks}|{action}";
}
