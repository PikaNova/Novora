import React, { useEffect, useState } from 'react';
import { ArrowLeft, MonitorCog, Palette, School, Type } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DESIGNS } from '../designs/registry';
import { fetchOccupiedClassIds, saveDeviceBinding } from '../services/classBinding';
import { useExamSync } from '../hooks/useExamSync';
import { notify } from '../services/notify';
import { confirmDialog } from '../services/appDialog';
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
import { getDesignId, setDesignId } from '../utils/designPref';
import { applyMotionSettings } from '../utils/motionSettings';
import { applyTypographySettings, loadTypographyFont, TYPOGRAPHY_FONT_OPTIONS } from '../utils/typographySettings';
import '../styles/settings.css';
import ClassMultiPicker from '../components/ClassMultiPicker';
import InlineSelect from '../components/InlineSelect';
import AboutSection from '../components/settings/AboutSection';

const FONT_OPTIONS = TYPOGRAPHY_FONT_OPTIONS;
const NUMERIC_OPTIONS = TYPOGRAPHY_FONT_OPTIONS;

const selectFontOptions = (includeDesign = false) => [
  ...(includeDesign ? [{ value: 'design' as TypographyFontId, label: '按设计默认' }] : []),
  ...FONT_OPTIONS,
];

export default function LocalSettingsPage() {
  const navigate = useNavigate();
  const initial = getAppSettings();
  const [dataVersion, setDataVersion] = useState(0);
  const { syncState, refresh } = useExamSync({ onUpdate: () => setDataVersion((value) => value + 1) });
  const exam = getAppSettings().exam;
  const schoolDesignRule = exam.designPolicy.rules.find((rule) => rule.scope === 'school');
  const [gradeId, setGradeId] = useState(initial.exam.selectedGradeId);
  const [classId, setClassId] = useState(initial.exam.selectedClassId);
  const [occupiedClassIds, setOccupiedClassIds] = useState<string[]>([]);
  const [bindingClassId, setBindingClassId] = useState('');
  const [design, setDesign] = useState(getDesignId());
  const [motion, setMotion] = useState<MotionMode>(initial.general.motionMode);
  const [fonts, setFonts] = useState<TypographySettings>(initial.general.typography);
  useEffect(() => {
    const latest = getAppSettings().exam;
    setGradeId((value) => (latest.grades.some((item) => item.id === value) ? value : latest.selectedGradeId));
    setClassId((value) => (latest.classes.some((item) => item.id === value) ? value : latest.selectedClassId));
  }, [dataVersion]);
  useEffect(() => {
    let active = true;
    void fetchOccupiedClassIds()
      .then((ids) => {
        if (active) setOccupiedClassIds(ids);
      })
      .catch(() => {
        if (active) setOccupiedClassIds([]);
      });
    return () => {
      active = false;
    };
  }, [dataVersion]);
  const patchFont = (key: keyof TypographySettings, value: TypographyFontId) => {
    const next = { ...fonts, [key]: value };
    setFonts(next);
    updateAppSettings((current) => ({ general: { ...current.general, typography: next } }));
    applyTypographySettings(next);
    void loadTypographyFont(value);
  };
  const bind = async (value: string) => {
    if (!value || bindingClassId) return;
    setBindingClassId(value);
    try {
      let replaceExisting = occupiedClassIds.includes(value);
      if (
        replaceExisting &&
        !(await confirmDialog({
          title: '该班级已绑定其他设备',
          message: '继续后将解除原考试端及其 ClassIsland 配对，并将当前设备设为该班级的新考试端。',
          tone: 'warning',
          confirmLabel: '解除旧设备并绑定本机',
        }))
      )
        return;
      let result = await saveDeviceBinding(gradeId, value, replaceExisting);
      if (!result.ok && result.conflict && !replaceExisting) {
        replaceExisting = await confirmDialog({
          title: '该班级已绑定其他设备',
          message: '继续后将解除原考试端及其 ClassIsland 配对，并将当前设备设为该班级的新考试端。',
          tone: 'warning',
          confirmLabel: '解除旧设备并绑定本机',
        });
        if (!replaceExisting) return;
        result = await saveDeviceBinding(gradeId, value, true);
      }
      if (!result.ok) {
        notify('error', result.error);
        return;
      }
      setClassId(value);
      updateExamSettings({ selectedGradeId: gradeId, selectedClassId: value });
      setOccupiedClassIds((ids) => ids.filter((id) => id !== value));
      notify('success', result.replaced ? '已解除旧设备并将本机绑定为新的班级考试端。' : '本机已切换为该班级考试端。');
    } finally {
      setBindingClassId('');
    }
  };
  const classOptions = exam.classes.map((item) => ({
    id: item.id,
    gradeId: item.gradeId,
    gradeName: exam.grades.find((grade) => grade.id === item.gradeId)?.name || '未知年级',
    className: item.name,
    statusLabel: occupiedClassIds.includes(item.id) ? '已绑定' : undefined,
  }));
  return (
    <div className="set-page">
      <header className="set-header">
        <div className="set-header__left">
          <button className="set-back set-back--icon" onClick={() => navigate(-1)} aria-label="返回">
            <ArrowLeft />
          </button>
          <div>
            <h1 className="set-title">本地设置</h1>
            <small>仅影响当前设备，无需登录</small>
          </div>
        </div>
        <MonitorCog />
      </header>
      <main className="set-body">
        <section className="set-card">
          <div className="set-card__head">
            <h2 className="set-card__title">
              <School />
              班级选择
            </h2>
            {!exam.grades.length && (
              <button className="set-btn set-btn--ghost" onClick={() => void refresh(true)}>
                {syncState === 'syncing' ? '正在同步…' : '重新同步'}
              </button>
            )}
          </div>
          {!exam.grades.length && (
            <p className="set-card__lead">
              {syncState === 'local' || syncState === 'syncing'
                ? '正在从云端获取年级和班级…'
                : '暂时没有可选择的班级，请检查网络或由管理员完成初始化。'}
            </p>
          )}
          <div className="set-row">
            <label className="set-label">年级</label>
            <InlineSelect
              className="set-input"
              value={gradeId}
              disabled={!exam.grades.length}
              onChange={(value) => {
                setGradeId(value);
                setClassId('');
                updateExamSettings({ selectedGradeId: value, selectedClassId: '' });
              }}
              options={[
                { value: '', label: '请选择年级' },
                ...exam.grades.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
          </div>
          <div className="set-row set-row--picker">
            <label className="set-label">班级</label>
            <ClassMultiPicker
              options={classOptions}
              gradeId={gradeId}
              selectedIds={bindingClassId ? [bindingClassId] : classId ? [classId] : []}
              onChange={(ids) => void bind(ids[0] || '')}
              disabled={!gradeId || Boolean(bindingClassId)}
              single
            />
          </div>
        </section>
        <section className="set-card">
          <div className="set-card__head">
            <h2 className="set-card__title">
              <Palette />
              显示设置
            </h2>
          </div>
          <div className="set-row">
            <label className="set-label">大屏设计</label>
            {schoolDesignRule ? (
              <button
                type="button"
                className="set-input set-input--locked"
                onClick={() => notify('warning', '全校设计正在生效，请先由管理员在设备管理中删除全校设计。')}
              >
                {DESIGNS.find((item) => item.id === schoolDesignRule.designId)?.name || schoolDesignRule.designId} ·
                全校固定
              </button>
            ) : (
              <InlineSelect
                className="set-input"
                value={design}
                onChange={(value) => {
                  setDesign(value);
                  setDesignId(value);
                }}
                options={DESIGNS.map((item) => ({ value: item.id, label: item.name }))}
              />
            )}
          </div>
          <div className="set-row">
            <label className="set-label">动效模式</label>
            <InlineSelect
              className="set-input"
              value={motion}
              onChange={(value) => {
                const next = value as MotionMode;
                setMotion(next);
                updateMotionMode(next);
                applyMotionSettings(next);
              }}
              options={[
                { value: 'auto', label: '跟随系统' },
                { value: 'best-effects', label: '最佳效果' },
                { value: 'best-performance', label: '最佳性能' },
              ]}
            />
          </div>
          <p className="set-note">
            最佳效果适合日常展示与体验；一体机、低端设备或投影出现卡顿时可切换到最佳性能，全局关闭动画、过渡与毛玻璃。
          </p>
        </section>
        <section className="set-card">
          <div className="set-card__head">
            <h2 className="set-card__title">
              <Type />
              字体分区
            </h2>
            <button
              className="set-btn set-btn--ghost"
              onClick={() => {
                setFonts(DEFAULT_TYPOGRAPHY);
                updateAppSettings((current) => ({ general: { ...current.general, typography: DEFAULT_TYPOGRAPHY } }));
                applyTypographySettings(DEFAULT_TYPOGRAPHY);
              }}
            >
              恢复默认
            </button>
          </div>
          <div className="set-font-grid">
            <label className="set-font-field">
              <span>① 导航与标签</span>
              <InlineSelect
                className="set-input"
                value={fonts.navigation}
                onChange={(value) => patchFont('navigation', value as TypographyFontId)}
                options={selectFontOptions()}
              />
              <small>页眉、状态、标签与说明</small>
              <i className="set-font-preview set-font-preview--nav">导航 · 在线 · 已校时</i>
            </label>
            <label className="set-font-field">
              <span>② 展示标题</span>
              <InlineSelect
                className="set-input"
                value={fonts.display}
                onChange={(value) => patchFont('display', value as TypographyFontId)}
                options={selectFontOptions(true)}
              />
              <small>科目主标题与核心强调</small>
              <i className="set-font-preview set-font-preview--display">语文考试</i>
            </label>
            <label className="set-font-field">
              <span>③ 动态内容</span>
              <InlineSelect
                className="set-input"
                value={fonts.content}
                onChange={(value) => patchFont('content', value as TypographyFontId)}
                options={selectFontOptions()}
              />
              <small>下一科、卡片内容与动态中文</small>
              <i className="set-font-preview set-font-preview--content">下一科：数学 · 14:30</i>
            </label>
            <label className="set-font-field">
              <span>④ 时钟与数字</span>
              <InlineSelect
                className="set-input"
                value={fonts.numeric}
                onChange={(value) => patchFont('numeric', value as TypographyFontId)}
                options={NUMERIC_OPTIONS}
              />
              <small>时钟、倒计时、百分比和进度数字</small>
              <i className="set-font-preview set-font-preview--numeric">09:30:00</i>
            </label>
          </div>
          <p className="set-note">默认方案不再使用霞鹜文楷；如需自定义，可仅在本页手动选择它。</p>
        </section>
        <AboutSection />
      </main>
    </div>
  );
}
