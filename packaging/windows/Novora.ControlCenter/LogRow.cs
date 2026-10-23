namespace Novora.ControlCenter;

/// <summary>日志行的显示模型；Tone 只取 error、warn、info，配色由样式触发器决定以便跟随主题。</summary>
internal sealed record LogRow(string Text, string Tone);
