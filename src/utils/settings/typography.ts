/** 从 src/utils/appSettings.ts 拆分出的字体排版领域设置。 */

export type TypographyFontId = 'design' | 'alibaba' | 'sourceHan' | 'smiley' | 'wenkai' | 'general' | 'jbmono';

export interface TypographySettings {
	navigation: TypographyFontId;
	display: TypographyFontId;
	content: TypographyFontId;
	numeric: TypographyFontId;
}

export const DEFAULT_TYPOGRAPHY: TypographySettings = {
	navigation: 'sourceHan', display: 'design', content: 'sourceHan', numeric: 'jbmono',
};
