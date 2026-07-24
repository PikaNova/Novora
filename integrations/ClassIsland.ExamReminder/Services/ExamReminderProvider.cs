using Avalonia.Threading;
using ClassIsland.Core.Abstractions.Services.NotificationProviders;
using ClassIsland.Core.Attributes;
using ClassIsland.Core.Models.Notification;
using ClassIsland.ExamReminder.Models;

namespace ClassIsland.ExamReminder.Services;

[NotificationProviderInfo(
    "8A997522-E450-4FE8-924F-04A4829B8B5C",
    "考试提醒",
    "\uE7C0",
    "从考试看板同步考试，并在开考前显示提醒")]
public sealed class ExamReminderProvider : NotificationProviderBase
{
    public void ShowExamReminder(ExamBoardExam exam, int minutes)
    {
        var maskText = minutes > 0 ? $"{minutes} 分钟后开始考试" : "考试现在开始";
        var detailText = minutes > 0
            ? $"{exam.Name}考试将在 {exam.StartAt.ToLocalTime():HH:mm} 开始"
            : $"{exam.Name}考试现在开始";

        Dispatcher.UIThread.Post(() => ShowNotification(new NotificationRequest
        {
            MaskContent = NotificationContent.CreateTwoIconsMask(maskText),
            OverlayContent = NotificationContent.CreateSimpleTextContent(detailText),
        }));
    }

    public void ShowTestReminder()
    {
        ShowExamReminder(new ExamBoardExam
        {
            Id = "test",
            Name = "数学",
            StartAt = DateTimeOffset.Now.AddMinutes(15),
            EndAt = DateTimeOffset.Now.AddMinutes(105),
        }, 15);
    }
}
