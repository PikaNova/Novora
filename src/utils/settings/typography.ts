/** 从 src/utils/appSettings.ts 拆分出的字体/动效领域设置。 */

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

/** 动效模式：auto=跟随系统“减少动态效果”偏好；best-effects=开满动效；best-performance=关停动画/过渡/毛玻璃以省性能。 */
export type MotionMode = 'auto' | 'best-effects' | 'best-performance';
