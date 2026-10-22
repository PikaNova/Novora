using System.Drawing.Drawing2D;

namespace Novora.Ui;

public static class UiTheme
{
    public static readonly Color Ink = Color.FromArgb(31, 31, 31);
    public static readonly Color Surface = Color.FromArgb(243, 243, 243);
    public static readonly Color SurfaceRaised = Color.FromArgb(255, 255, 255);
    public static readonly Color SurfaceSoft = Color.FromArgb(232, 232, 232);
    public static readonly Color Signal = Color.FromArgb(0, 103, 192);
    public static readonly Color Nova = Color.FromArgb(255, 185, 0);
    public static readonly Color Text = Color.FromArgb(31, 31, 31);
    public static readonly Color Muted = Color.FromArgb(91, 91, 91);
    public static readonly Color Good = Color.FromArgb(16, 124, 16);
    public static readonly Color Bad = Color.FromArgb(196, 43, 28);

    public static void Apply(Control control)
    {
        control.BackColor = Surface;
        control.ForeColor = Text;
        control.Font = new Font("Segoe UI", 10F);
    }

    public static void ApplyBorder(Control control)
    {
        control.Paint += (_, e) => {
            using var pen = new Pen(Color.FromArgb(214, 214, 214), 1);
            var rect = new Rectangle(0, 0, control.Width - 1, control.Height - 1);
            e.Graphics.DrawRectangle(pen, rect);
        };
    }

    public static void Round(Control control, int radius = 14)
    {
        void Resize(object? _, EventArgs __)
        {
            using var path = RoundedPath(control.ClientRectangle, radius);
            control.Region = new Region(path);
        }
        control.Resize += Resize;
        Resize(null, EventArgs.Empty);
    }

    public static GraphicsPath RoundedPath(Rectangle bounds, int radius)
    {
        var path = new GraphicsPath();
        var d = radius * 2;
        var rect = new Rectangle(bounds.X, bounds.Y, Math.Max(1, bounds.Width - 1), Math.Max(1, bounds.Height - 1));
        path.AddArc(rect.X, rect.Y, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Y, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.X, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}

public sealed class AccentButton : Button
{
    public AccentButton()
    {
        FlatStyle = FlatStyle.Flat;
        FlatAppearance.BorderSize = 1;
        FlatAppearance.BorderColor = Color.FromArgb(0, 95, 184);
        BackColor = UiTheme.Signal;
        ForeColor = Color.White;
        Font = new Font("Segoe UI Semibold", 10F);
        Cursor = Cursors.Hand;
        Padding = new Padding(14, 0, 14, 0);
        UiTheme.Round(this, 6);
    }
    protected override void OnMouseEnter(EventArgs e) { base.OnMouseEnter(e); BackColor = Color.FromArgb(0, 83, 164); }
    protected override void OnMouseLeave(EventArgs e) { base.OnMouseLeave(e); BackColor = UiTheme.Signal; }
}

public sealed class ToggleSwitch : CheckBox
{
    private float thumb;
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 16 };
    public ToggleSwitch()
    {
        Appearance = Appearance.Button;
        FlatStyle = FlatStyle.Flat;
        FlatAppearance.BorderSize = 0;
        Text = string.Empty;
        Size = new Size(48, 28);
        Cursor = Cursors.Hand;
        thumb = 3;
        timer.Tick += (_, _) => { var target = Checked ? 23f : 3f; thumb += (target - thumb) * .28f; Invalidate(); if (Math.Abs(target - thumb) < .5f) timer.Stop(); };
        CheckedChanged += (_, _) => { timer.Start(); Invalidate(); };
    }
    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var track = new SolidBrush(Checked ? UiTheme.Signal : UiTheme.SurfaceSoft);
        e.Graphics.FillRoundedRectangle(track, new Rectangle(0, 2, Width - 1, Height - 5), 12);
        using var thumbBrush = new SolidBrush(Checked ? UiTheme.Ink : UiTheme.Muted);
        e.Graphics.FillEllipse(thumbBrush, new RectangleF(thumb, 6, 16, 16));
    }
}

public static class GraphicsExtensions
{
    public static void FillRoundedRectangle(this Graphics graphics, Brush brush, Rectangle rectangle, int radius)
    {
        using var path = UiTheme.RoundedPath(rectangle, radius);
        graphics.FillPath(brush, path);
    }
}

public sealed class StatusPill : Control
{
    public bool Healthy { get; set; }
    public string Caption { get; set; } = "服务检查中";
    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var background = new SolidBrush(Healthy ? Color.FromArgb(218, 242, 218) : Color.FromArgb(253, 231, 229));
        e.Graphics.FillRoundedRectangle(background, ClientRectangle, 12);
        using var dot = new SolidBrush(Healthy ? UiTheme.Good : UiTheme.Bad);
        e.Graphics.FillEllipse(dot, new Rectangle(10, 9, 8, 8));
        using var text = new SolidBrush(UiTheme.Text);
        e.Graphics.DrawString(Caption, Font, text, 25, 5);
    }
}
