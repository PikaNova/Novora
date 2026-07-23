import { getAppSettings, APP_SETTINGS_CHANGED_EVENT, type TypographySettings, type TypographyFontId } from './appSettings';

const families: Record<Exclude<TypographyFontId, 'design'>, string> = {
  alibaba: '"Exam Alibaba", "Exam Source Han", var(--font-fallback)',
  sourceHan: '"Exam Source Han", var(--font-fallback)',
  smiley: '"Exam Smiley", "Exam Source Han", var(--font-fallback)',
  wenkai: '"Exam WenKai", "Exam Source Han", var(--font-fallback)',
  general: '"Exam General Sans", "Exam Alibaba", ui-sans-serif, sans-serif',
  jbmono: '"Exam Mono Digit", "Exam Numeric Mono", ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, monospace',
};

function family(id: TypographyFontId, fallback: string) {
  return id === 'design' ? fallback : families[id];
}

/** Applies persisted typography choices as CSS variables, without changing the page layout. */
export function applyTypographySettings(settings: TypographySettings = getAppSettings().general.typography): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--font-region-navigation', family(settings.navigation, '"Exam Source Han", var(--font-fallback)'));
  root.setProperty('--font-region-display', family(settings.display, 'var(--font-design-display, "Exam Source Han", var(--font-fallback))'));
  root.setProperty('--font-region-content', family(settings.content, '"Exam Source Han", var(--font-fallback)'));
  root.setProperty('--font-region-numeric', family(settings.numeric, '"Exam Mono Digit", "Exam Numeric Mono", ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, monospace'));
}

export function bindTypographySettings(): () => void {
  const apply = () => applyTypographySettings();
  apply();
  window.addEventListener(APP_SETTINGS_CHANGED_EVENT, apply);
  window.addEventListener('storage', apply);
  return () => { window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, apply); window.removeEventListener('storage', apply); };
}
