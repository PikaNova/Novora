import { Palette, Type } from "lucide-react";
import InlineSelect from "../InlineSelect";
import { DESIGNS } from "../../designs/registry";
import type { MotionMode, TypographyFontId } from "../../utils/appSettings";
import { notify } from "../../services/notify";
import { useAppearanceSettings } from "../../hooks/settings/useAppearanceSettings";

const FONT_OPTIONS: Array<{ value: TypographyFontId; label: string }> = [
  { value: "alibaba", label: "阿里巴巴普惠体 3" },
  { value: "sourceHan", label: "思源黑体" },
  { value: "smiley", label: "得意黑 / Smiley Sans" },
  { value: "wenkai", label: "霞鹜文楷" },
  { value: "general", label: "General Sans" },
];
const NUMERIC_FONT_OPTIONS: Array<{ value: TypographyFontId; label: string }> =
  [
    { value: "jbmono", label: "JetBrains Mono（默认 · 等宽）" },
    { value: "general", label: "General Sans" },
    { value: "alibaba", label: "阿里巴巴普惠体 3" },
    { value: "sourceHan", label: "思源黑体" },
    { value: "smiley", label: "得意黑 / Smiley Sans" },
    { value: "wenkai", label: "霞鹜文楷" },
  ];

export default function AppearanceSection({
  canEditSettings,
}: {
  canEditSettings: boolean;
}) {
  const {
    designId,
    typography,
    motionMode,
    schoolDesignRule,
    patchDesign,
    patchMotion,
    patchTypography,
    resetTypography,
  } = useAppearanceSettings();

  return (
    <>
        <section className="set-card">
          <div className="set-card__head">
            <h2 className="set-card__title">
              <Palette size={20} />
              显示
            </h2>
          </div>
          <div className="set-row">
            <label className="set-label">默认大屏设计风格</label>
            {schoolDesignRule ? (
              <button
                type="button"
                className="set-input set-input--locked"
                onClick={() =>
                  notify(
                    "warning",
                    "全校设计正在生效，请先由管理员在设备管理中删除全校设计。",
                  )
                }
              >
                {DESIGNS.find((item) => item.id === schoolDesignRule.designId)
                  ?.name ?? schoolDesignRule.designId}
                {" · 全校固定"}
              </button>
            ) : (
              <InlineSelect
                className="set-input"
                disabled={!canEditSettings}
                value={designId}
                onChange={patchDesign}
                options={DESIGNS.map((d) => ({ value: d.id, label: d.name }))}
              />
            )}
          </div>
          <p className="set-note">
            {schoolDesignRule
              ? "全校设计覆盖年级、班级、设备和本地设计，删除全校规则后才可修改。"
              : "也可在大屏右上角“切换风格”里实时预览切换；此处设置作为本机默认。"}
          </p>
          <div className="set-row">
            <label className="set-label">动效模式</label>
            <InlineSelect
              className="set-input"
              disabled={!canEditSettings}
              value={motionMode}
              onChange={(value) => patchMotion(value as MotionMode)}
              options={[
                { value: "auto", label: "自动（跟随系统“减少动态效果”偏好）" },
                { value: "best-effects", label: "最佳效果（开满动效）" },
                {
                  value: "best-performance",
                  label: "最佳性能（关闭动画 / 过渡 / 毛玻璃）",
                },
              ]}
            />
          </div>
          <p className="set-note">
            最佳效果适合日常展示与体验；一体机、低端设备或投影出现卡顿时可切换到最佳性能，全局关闭动画、过渡与毛玻璃。
          </p>
        </section>
        {/* ―― 字体分区 ―― */}
        <section className="set-card">
          <div className="set-card__head">
            <h2 className="set-card__title">
              <Type size={20} />
              字体分区
            </h2>
            <button
              className="set-btn set-btn--ghost"
              disabled={!canEditSettings}
              onClick={resetTypography}
            >
              恢复设计默认
            </button>
          </div>
          <p className="set-card__lead">
            所有选择均为已随应用打包的本地字体。设置立即作用于当前大屏，并保存到本机；时钟默认使用
            JetBrains Mono 等宽数字（子集已随应用打包）。
          </p>
          <div className="set-font-grid">
            <label className="set-font-field">
              <span>① 导航与标签</span>
              <InlineSelect
                className="set-input"
                disabled={!canEditSettings}
                value={typography.navigation}
                onChange={(value) =>
                  patchTypography("navigation", value as TypographyFontId)
                }
                options={FONT_OPTIONS}
              />
              <small>页眉、状态、标签与说明</small>
              <i className="set-font-preview set-font-preview--nav">
                导航 · 在线 · 已校时
              </i>
            </label>
            <label className="set-font-field">
              <span>② 展示标题</span>
              <InlineSelect
                className="set-input"
                disabled={!canEditSettings}
                value={typography.display}
                onChange={(value) =>
                  patchTypography("display", value as TypographyFontId)
                }
                options={[
                  { value: "design", label: "按当前设计默认" },
                  ...FONT_OPTIONS,
                ]}
              />
              <small>科目主标题与核心强调</small>
              <i className="set-font-preview set-font-preview--display">
                语文考试
              </i>
            </label>
            <label className="set-font-field">
              <span>③ 动态内容</span>
              <InlineSelect
                className="set-input"
                disabled={!canEditSettings}
                value={typography.content}
                onChange={(value) =>
                  patchTypography("content", value as TypographyFontId)
                }
                options={FONT_OPTIONS}
              />
              <small>下一科、卡片内容与动态中文</small>
              <i className="set-font-preview set-font-preview--content">
                下一科：数学 · 14:30
              </i>
            </label>
            <label className="set-font-field">
              <span>④ 时钟与数字</span>
              <InlineSelect
                className="set-input"
                disabled={!canEditSettings}
                value={typography.numeric}
                onChange={(value) =>
                  patchTypography("numeric", value as TypographyFontId)
                }
                options={NUMERIC_FONT_OPTIONS}
              />
              <small>时钟、倒计时、百分比和进度数字</small>
              <i className="set-font-preview set-font-preview--numeric">
                09:30:00
              </i>
            </label>
          </div>
          <p className="set-note">
            默认方案不再使用霞鹜文楷；如需自定义，可仅在本页手动选择它。
          </p>
        </section>
    </>
  );
}
