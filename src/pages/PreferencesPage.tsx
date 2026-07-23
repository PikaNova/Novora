import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DEFAULT_TYPOGRAPHY,
  getAppSettings,
  updateAppSettings,
  updateExamSettings,
  updateMotionMode,
  type MotionMode,
  type TypographyFontId,
  type TypographySettings,
} from '../utils/appSettings';
import { applyTypographySettings } from '../utils/typographySettings';
import { applyMotionSettings } from '../utils/motionSettings';
import { getDesignId, setDesignId } from '../utils/designPref';
import { DESIGNS } from '../designs/registry';
import { saveBoundClassTag } from '../services/classBinding';
import { collectClassTags } from '../utils/classSettings';
import '../styles/settings.css';

const FONT_OPTIONS: Array<{ value: TypographyFontId; label: string }> = [
  { value: 'alibaba', label: '阿里巴巴普惠体 3' },
  { value: 'sourceHan', label: '思源黑体' },
  { value: 'smiley', label: '得意黑 / Smiley Sans' },
  { value: 'wenkai', label: '霞鹜文楷' },
  { value: 'general', label: 'General Sans' },
];
const NUMERIC_OPTIONS: Array<{ value: TypographyFontId; label: string }> = [
  { value: 'jbmono', label: 'JetBrains Mono（默认 · 等宽）' },
  ...FONT_OPTIONS,
];

export default function PreferencesPage() {
  const navigate = useNavigate();
  const initial = getAppSettings();
  const [designId, setDesign] = useState(getDesignId());
  const [motionMode, setMotionMode] = useState<MotionMode>(initial.general.motionMode);
  const [typography, setTypography] = useState<TypographySettings>(initial.general.typography);
  const [selectedClassTag, setSelectedClassTag] = useState(initial.exam.selectedClassTag);
  const classTags = useMemo(
    () => collectClassTags(initial.exam.weeklyPlans, initial.exam.majors),
    [],
  );

  const patchTypography = (key: keyof TypographySettings, value: TypographyFontId) => {
    const next = { ...typography, [key]: value };
    setTypography(next);
    updateAppSettings(current => ({ general: { ...current.general, typography: next } }));
    applyTypographySettings(next);
  };
  const resetTypography = () => {
    setTypography(DEFAULT_TYPOGRAPHY);
    updateAppSettings(current => ({ general: { ...current.general, typography: DEFAULT_TYPOGRAPHY } }));
    applyTypographySettings(DEFAULT_TYPOGRAPHY);
  };
  const patchMotion = (mode: MotionMode) => {
    setMotionMode(mode);
    updateMotionMode(mode);
    applyMotionSettings(mode);
  };
  const patchDesign = (id: string) => { setDesign(id); setDesignId(id); };
  const patchClass = (tag: string) => {
    setSelectedClassTag(tag);
    updateExamSettings({ selectedClassTag: tag });
    void saveBoundClassTag(tag);
  };

  return <div className="set-page">
    <header className="set-header"><div className="set-header__left"><button className="set-back" onClick={() => navigate('/')}>← 返回</button><h1 className="set-title">偏好设置</h1></div><span className="set-version">无需管理员密码</span></header>
    <main className="set-body">
      <section className="set-card">
        <div className="set-card__head"><h2 className="set-card__title">显示</h2></div>
        <div className="set-row"><label className="set-label">默认大屏设计</label><select className="set-input" value={designId} onChange={e => patchDesign(e.target.value)}>{DESIGNS.map(design => <option key={design.id} value={design.id}>{design.name}</option>)}</select></div>
        <div className="set-row"><label className="set-label">动效模式</label><select className="set-input" value={motionMode} onChange={e => patchMotion(e.target.value as MotionMode)}><option value="auto">自动</option><option value="best-effects">最佳效果</option><option value="best-performance">最佳性能</option></select></div>
      </section>

      <section className="set-card">
        <div className="set-card__head"><h2 className="set-card__title">字体分区</h2><button className="set-btn set-btn--ghost" onClick={resetTypography}>恢复默认</button></div>
        <div className="set-font-grid">
          <label className="set-font-field"><span>导航与标签</span><select className="set-input" value={typography.navigation} onChange={e => patchTypography('navigation', e.target.value as TypographyFontId)}>{FONT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select><i className="set-font-preview set-font-preview--nav">导航 · 在线 · 已校时</i></label>
          <label className="set-font-field"><span>展示标题</span><select className="set-input" value={typography.display} onChange={e => patchTypography('display', e.target.value as TypographyFontId)}><option value="design">按当前设计默认</option>{FONT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select><i className="set-font-preview set-font-preview--display">语文考试</i></label>
          <label className="set-font-field"><span>动态内容</span><select className="set-input" value={typography.content} onChange={e => patchTypography('content', e.target.value as TypographyFontId)}>{FONT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select><i className="set-font-preview set-font-preview--content">下一科：数学</i></label>
          <label className="set-font-field"><span>时钟与数字</span><select className="set-input" value={typography.numeric} onChange={e => patchTypography('numeric', e.target.value as TypographyFontId)}>{NUMERIC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select><i className="set-font-preview set-font-preview--numeric">09:30:00</i></label>
        </div>
      </section>

      <section className="set-card">
        <div className="set-card__head"><h2 className="set-card__title">当前班级</h2></div>
        <p className="set-card__lead">只影响这台设备显示的周测与适用班级考试，不会修改其他设备。</p>
        <div className="set-row"><label className="set-label">班级 / 分组</label><select className="set-input" value={selectedClassTag} onChange={e => patchClass(e.target.value)}><option value="">通用 / 未分组</option>{classTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}</select></div>
        {classTags.length === 0 && <p className="set-note">管理员尚未创建带班级标签的周测计划。</p>}
      </section>
    </main>
  </div>;
}
