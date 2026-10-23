using System.Drawing.Drawing2D;
using System.Diagnostics;
using Novora.Ui;

namespace Novora.Tray;

public sealed class TrayFlyout : Form
{
    private readonly System.Windows.Forms.Timer animation = new() { Interval = 16 };
    private readonly Label title;
    private readonly Label details;
    private readonly StatusPill pill;
    private int targetTop;

    public TrayFlyout(bool healthy, string version, int port, string lanAddress)
    {
        FormBorderStyle = FormBorderStyle.FixedSingle;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        ClientSize = new Size(360, 214);
        BackColor = UiTheme.Surface;
        ForeColor = UiTheme.Text;
        Opacity = 0;
        UiTheme.ApplyBorder(this);
        title = new Label { Text = "Novora", Font = new Font("Segoe UI", 18, FontStyle.Bold), ForeColor = UiTheme.Text, Location = new Point(24, 22), AutoSize = true };
        pill = new StatusPill { Healthy = healthy, Caption = healthy ? "服务正常" : "服务未连接", Location = new Point(24, 64), Size = new Size(124, 28) };
        details = new Label { Text = $"版本 v{version}\r\n本机端口 {port}\r\n局域网 {lanAddress}", ForeColor = UiTheme.Muted, Location = new Point(24, 108), AutoSize = true };
        var open = new AccentButton { Text = "打开 Novora", Location = new Point(222, 158), Size = new Size(114, 36) };
        open.Click += (_, _) => { Process.Start(new ProcessStartInfo($"http://127.0.0.1:{port}") { UseShellExecute = true }); Close(); };
        Controls.AddRange(new Control[] { title, pill, details, open });
        Deactivate += (_, _) => Close();
        Shown += (_, _) => { targetTop = Top; Top += 16; animation.Start(); };
        animation.Tick += (_, _) => { Opacity = Math.Min(1, Opacity + .1); Top = Math.Min(targetTop, Top + 2); if (Opacity >= 1 && Top >= targetTop) animation.Stop(); };
    }
    protected override void OnPaintBackground(PaintEventArgs e)
    {
        using var brush = new LinearGradientBrush(ClientRectangle, UiTheme.Surface, UiTheme.SurfaceRaised, 25);
        e.Graphics.FillRectangle(brush, ClientRectangle);
    }
}
