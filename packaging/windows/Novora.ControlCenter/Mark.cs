using System.Windows;

namespace Novora.ControlCenter;

/// <summary>只用于把界面状态映射到样式触发器：导航当前项、向导步骤阶段。</summary>
public static class Mark
{
    public static readonly DependencyProperty SelectedProperty = DependencyProperty.RegisterAttached(
        "Selected", typeof(bool), typeof(Mark), new PropertyMetadata(false));

    public static bool GetSelected(DependencyObject element) => (bool)element.GetValue(SelectedProperty);
    public static void SetSelected(DependencyObject element, bool value) => element.SetValue(SelectedProperty, value);

    public static readonly DependencyProperty PhaseProperty = DependencyProperty.RegisterAttached(
        "Phase", typeof(string), typeof(Mark), new PropertyMetadata("todo"));

    public static string GetPhase(DependencyObject element) => (string)element.GetValue(PhaseProperty);
    public static void SetPhase(DependencyObject element, string value) => element.SetValue(PhaseProperty, value);
}
