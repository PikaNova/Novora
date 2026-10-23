using System.Text.Json;

namespace Novora.ControlCenter;

internal sealed record InspectionItem(string Title, string Status, string Detail, bool Blocking = false);
internal sealed record InspectionResult(IReadOnlyList<InspectionItem> Items)
{
    public bool CanContinue => !Items.Any(x => x.Blocking);
    public string Summary => $"检查完成 · {Items.Count(x => x.Blocking)} 项需要处理 · {Items.Count(x => x.Status is "待初始化" or "待配置")} 项待准备。" + (CanContinue ? "可以继续设置，待准备项目将在应用时处理。" : "请先处理阻断项目，再重新检查。");

    public static InspectionResult From(JsonElement state)
    {
        var items = new List<InspectionItem>();
        foreach (var (key, title) in new[] { ("service", "Novora 业务服务"), ("database", "独立数据库服务") })
        {
            var value = state.GetProperty(key).GetProperty("state").GetString();
            items.Add(value switch
            {
                "未安装" => new(title, "待初始化", "尚未注册；初始化会创建并启动服务。"),
                "无法读取" => new(title, "未能读取", "无法读取 Windows 服务状态，请重新检查或检查系统权限。", true),
                "Running" => new(title, "正常", "服务正在运行；应用设置后会重新验证。"),
                _ => new(title, "待初始化", "服务已注册；应用设置时将启动并验证。")
            });
        }
        var files = state.GetProperty("files").EnumerateArray().ToArray();
        var present = files.Count(x => x.GetProperty("exists").GetBoolean());
        items.Add(new("运行文件", present == files.Length ? "正常" : "需要处理", $"{present} / {files.Length} 项文件已就绪；缺失文件见下方。"));
        foreach (var file in files.Where(x => !x.GetProperty("exists").GetBoolean()))
        {
            var name = file.GetProperty("name").GetString() ?? "运行文件";
            var required = !file.TryGetProperty("required", out var flag) || flag.GetBoolean();
            items.Add(new(name, required ? "需要处理" : "待配置", required ? "缺少核心文件，请重新安装完整文件后重新检查。" : "可选托盘组件未安装，不影响服务初始化。", required));
        }
        AddSetting("局域网访问", "lanAccess", "下一步选择是否允许本地子网访问。", "防火墙状态未能读取；可在下一步明确选择，应用时将请求管理员权限。");
        AddSetting("自动备份", "backupDaily", "下一步选择是否启用每日备份。", "备份计划未能读取；可在下一步明确选择，应用时重新配置。");
        var shortcuts = new[] { ("trayStartup", "登录托盘"), ("desktopShortcut", "桌面快捷方式"), ("startMenuShortcut", "开始菜单") };
        items.Add(new("快捷方式与托盘", "待配置", string.Join("；", shortcuts.Select(x => x.Item2 + (state.TryGetProperty(x.Item1, out var enabled) && enabled.ValueKind == JsonValueKind.True ? "：已配置" : "：未配置"))) + "。下一步可调整。"));
        items.Add(new("初始化记录", state.GetProperty("initialized").GetBoolean() ? "正常" : "待初始化", "已有数据会保留；服务健康验证通过后才记录初始化完成。"));
        foreach (var warning in state.GetProperty("warnings").EnumerateArray())
            items.Add(new("系统提示", "未能读取", warning.GetString() ?? "请重新检查。"));
        return new(items);

        void AddSetting(string title, string key, string detail, string unreadable)
        {
            var value = state.GetProperty(key).ValueKind;
            items.Add(value == JsonValueKind.Null ? new(title, "未能读取", unreadable) : new(title, value == JsonValueKind.True ? "正常" : "待配置", detail));
        }
    }
}
