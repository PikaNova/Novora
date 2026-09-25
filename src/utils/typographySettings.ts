import {
  getAppSettings,
  APP_SETTINGS_CHANGED_EVENT,
  type TypographySettings,
  type TypographyFontId,
} from './appSettings';

const families: Record<Exclude<TypographyFontId, 'design'>, string> = {
  alibaba: '"Exam Alibaba", "Exam Source Han", var(--font-fallback)',
  sourceHan: '"Exam Source Han", var(--font-fallback)',
  smiley: '"Exam Smiley", "Exam Source Han", var(--font-fallback)',
  wenkai: '"Exam WenKai", "Exam Source Han", var(--font-fallback)',
  wenkaiGb: '"Exam WenKai GB", "Exam WenKai", "Exam Source Han", var(--font-fallback)',
  wenkaiTc: '"Exam WenKai TC", "Exam WenKai", "Exam Source Han", var(--font-fallback)',
  zhenkaiGb: '"Exam ZhenKai GB", "Exam WenKai", "Exam Source Han", var(--font-fallback)',
  markerGothic: '"Exam Marker Gothic", "Exam WenKai", "Exam Source Han", var(--font-fallback)',
  zhuqueFangsong: '"Exam Zhuque Fangsong", "Exam Source Han", var(--font-fallback)',
  general: '"Exam General Sans", "Exam Alibaba", ui-sans-serif, sans-serif',
  jbmono:
    '"Exam Mono Digit", "Exam Numeric Mono", ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, monospace',
};

export const TYPOGRAPHY_FONT_CATALOG: Record<Exclude<TypographyFontId, 'design'>, { family: string; group: string }> = {
  alibaba: { family: 'Exam Alibaba', group: '阿里系' },
  sourceHan: { family: 'Exam Source Han', group: '思源系' },
  smiley: { family: 'Exam Smiley', group: '其他' },
  wenkai: { family: 'Exam WenKai', group: '霞鹜系' },
  wenkaiGb: { family: 'Exam WenKai GB', group: '霞鹜系' },
  wenkaiTc: { family: 'Exam WenKai TC', group: '霞鹜系' },
  zhenkaiGb: { family: 'Exam ZhenKai GB', group: '霞鹜系' },
  markerGothic: { family: 'Exam Marker Gothic', group: '霞鹜系' },
  zhuqueFangsong: { family: 'Exam Zhuque Fangsong', group: '朱雀系' },
  general: { family: 'Exam General Sans', group: '其他' },
  jbmono: { family: 'Exam Mono Digit', group: '其他' },
};

export type TypographyFontOption = {
  value: Exclude<TypographyFontId, 'design'>;
  label: string;
  group: string;
  fontFamily: string;
};

export const TYPOGRAPHY_FONT_OPTIONS: TypographyFontOption[] = [
  { value: 'wenkai', label: '霞鹜文楷', group: '霞鹜系', fontFamily: TYPOGRAPHY_FONT_CATALOG.wenkai.family },
  { value: 'wenkaiGb', label: '霞鹜文楷 GB', group: '霞鹜系', fontFamily: TYPOGRAPHY_FONT_CATALOG.wenkaiGb.family },
  { value: 'wenkaiTc', label: '霞鹜文楷 TC', group: '霞鹜系', fontFamily: TYPOGRAPHY_FONT_CATALOG.wenkaiTc.family },
  { value: 'zhenkaiGb', label: '霞鹜臻楷 GB', group: '霞鹜系', fontFamily: TYPOGRAPHY_FONT_CATALOG.zhenkaiGb.family },
  {
    value: 'markerGothic',
    label: '霞鹜漫黑',
    group: '霞鹜系',
    fontFamily: TYPOGRAPHY_FONT_CATALOG.markerGothic.family,
  },
  { value: 'sourceHan', label: '思源黑体', group: '思源系', fontFamily: TYPOGRAPHY_FONT_CATALOG.sourceHan.family },
  { value: 'alibaba', label: '阿里巴巴普惠体 3', group: '阿里系', fontFamily: TYPOGRAPHY_FONT_CATALOG.alibaba.family },
  {
    value: 'zhuqueFangsong',
    label: '朱雀仿宋',
    group: '朱雀系',
    fontFamily: TYPOGRAPHY_FONT_CATALOG.zhuqueFangsong.family,
  },
  { value: 'smiley', label: '得意黑', group: '其他', fontFamily: TYPOGRAPHY_FONT_CATALOG.smiley.family },
  { value: 'general', label: 'General Sans', group: '其他', fontFamily: TYPOGRAPHY_FONT_CATALOG.general.family },
  { value: 'jbmono', label: 'JetBrains Mono', group: '其他', fontFamily: TYPOGRAPHY_FONT_CATALOG.jbmono.family },
];

const fontLoaders = new Map<string, Promise<void>>();

/** Loads a bundled font only when the selector or a user choice needs it. */
export function loadTypographyFont(id: TypographyFontId): Promise<void> {
  if (typeof document === 'undefined' || id === 'design') return Promise.resolve();
  const catalog = TYPOGRAPHY_FONT_CATALOG[id];
  if (!catalog) return Promise.resolve();
  const existing = fontLoaders.get(catalog.family);
  if (existing) return existing;
  const promise = document.fonts
    .load(`400 16px "${catalog.family}"`)
    .then(() => undefined)
    .catch(() => undefined);
  fontLoaders.set(catalog.family, promise);
  return promise;
}

function family(id: TypographyFontId, fallback: string) {
  return id === 'design' ? fallback : families[id];
}

export function typographyFontStack(id: TypographyFontId): string {
  return family(id, 'var(--font-fallback)');
}

/** Applies persisted typography choices as CSS variables, without changing the page layout. */
export function applyTypographySettings(settings: TypographySettings = getAppSettings().general.typography): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--font-region-navigation', family(settings.navigation, '"Exam Source Han", var(--font-fallback)'));
  root.setProperty(
    '--font-region-display',
    family(settings.display, 'var(--font-design-display, "Exam Source Han", var(--font-fallback))'),
  );
  root.setProperty('--font-region-content', family(settings.content, '"Exam Source Han", var(--font-fallback)'));
  root.setProperty(
    '--font-region-numeric',
    family(
      settings.numeric,
      '"Exam Mono Digit", "Exam Numeric Mono", ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, monospace',
    ),
  );
}

export function bindTypographySettings(): () => void {
  const apply = () => applyTypographySettings();
  apply();
  window.addEventListener(APP_SETTINGS_CHANGED_EVENT, apply);
  window.addEventListener('storage', apply);
  return () => {
    window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, apply);
    window.removeEventListener('storage', apply);
  };
}
