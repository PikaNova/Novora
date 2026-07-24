import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAppSettings,
  updateAppSettings,
  updateTimeSyncSettings,
  updateExamSettings,
  APP_SETTINGS_KEY,
} from '../utils/appSettings';
import { DEFAULT_TYPOGRAPHY, updateAlertsSettings, updateMotionMode } from '../utils/appSettings';
import type { TimeSyncSettings, TypographyFontId, TypographySettings, MotionMode } from '../utils/appSettings';
import { applyTypographySettings } from '../utils/typographySettings';
import { applyMotionSettings } from '../utils/motionSettings';
import { isTimeSyncReady, formatDateTimeInZone } from '../utils/timeSource';
import { getDesignId, setDesignId } from '../utils/designPref';
import { DESIGNS } from '../designs/registry';
import { renderMarkdown } from '../utils/renderMarkdown';
import AnnouncementList from '../components/AnnouncementList';
import HelpTip from '../components/HelpTip';
import readmeRaw from '../../README.md?raw';
import { adminCan, getAdminUser, getCloudSnapshot, hasValidLocalToken, isLoginRequired, refreshAdminUser, saveExamsToServer, type AdminUserContext } from '../services/examService';
import type { WeeklyPlan, WeeklyWeekMode } from '../types/exam';
import { sortedClasses, sortedGrades } from '../utils/classSettings';
import { OFFICIAL_HOLIDAYS } from '../data/officialHolidays';
import { getConsent, isEnabled, setEnabled, getInstanceId, reportNow } from '../services/telemetry';
import { checkForUpdate, getRedeployConfigured, triggerRedeploy } from '../services/update';
import type { UpdateInfo } from '../services/update';
import { fetchAnnouncements } from '../services/announcements';
import type { Announcement } from '../services/announcements';
import '../styles/settings.css';

const APP_VERSION = __APP_VERSION__;
type ErrMode = 'off' | 'memory' | 'persist';
const FONT_OPTIONS: Array<{ value: TypographyFontId; label: string }> = [
  { value: 'alibaba', label: '阿里巴巴普惠体 3' },
  { value: 'sourceHan', label: '思源黑体' },
  { value: 'smiley', label: '得意黑 / Smiley Sans' },
  { value: 'wenkai', label: '霞鹜文楷' },
  { value: 'general', label: 'General Sans' },
];
const NUMERIC_FONT_OPTIONS: Array<{ value: TypographyFontId; label: string }> = [
  { value: 'jbmono', label: 'JetBrains Mono（默认 · 等宽）' },
  { value: 'general', label: 'General Sans' },
  { value: 'alibaba', label: '阿里巴巴普惠体 3' },
  { value: 'sourceHan', label: '思源黑体' },
  { value: 'smiley', label: '得意黑 / Smiley Sans' },
  { value: 'wenkai', label: '霞鹜文楷' },
];

function Switch({ checked, onChange, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="set-switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  // 已有本地令牌时立即展示页面，跳过鉴权网络往返（数据库在新加坡、服务器在美国，
  // 跨洲往返会造成数秒白屏）；无令牌时才等待是否需要登录的判断。
  const [authed, setAuthed] = useState(() => hasValidLocalToken());
  const [adminUser, setAdminUser] = useState<AdminUserContext | null>(() => getAdminUser());
  useEffect(() => {
    if (hasValidLocalToken()) {
      refreshAdminUser().then(user => {
        if (!user) { navigate('/login?next=/settings', { replace: true }); return; }
        if (user.mustChangePassword) { navigate('/admin?tab=users&password=1', { replace: true }); return; }
        if (!adminCan('settings.read', user)) { navigate('/admin', { replace: true }); return; }
        setAdminUser(user); setAuthed(true);
      });
      return;
    }
    isLoginRequired().then(required => { if (!required) setAuthed(true); else navigate('/login?next=/settings', { replace: true }); });
  }, [navigate]);
  const [ts, setTs] = useState<TimeSyncSettings>(() => getAppSettings().general.timeSync);
  const [errMode, setErrMode] = useState<ErrMode>(() => getAppSettings().study.alerts.errorCenterMode);
  const [silentMode, setSilentMode] = useState<'all' | 'keyOnly' | 'pauseUntilExamEnd'>(() => getAppSettings().alerts.silentMode ?? 'all');
  const [designId, setDesign] = useState<string>(() => getDesignId());
  const [typography, setTypography] = useState<TypographySettings>(() => getAppSettings().general.typography);
  const [motionMode, setMotionMode] = useState<MotionMode>(() => getAppSettings().general.motionMode);
  const [syncing, setSyncing] = useState(false);
  const [readmeOpen, setReadmeOpen] = useState(false);
  const [teleOn, setTeleOn] = useState(() => isEnabled());
  const [teleMsg, setTeleMsg] = useState('');
  const [upd, setUpd] = useState<{ status: 'idle' | 'checking' | 'done' | 'error'; info?: UpdateInfo; error?: string }>({ status: 'idle' });
  const [redeployOk, setRedeployOk] = useState(false);
  const [redeploy, setRedeploy] = useState<{ status: 'idle' | 'running' | 'done' | 'error'; msg?: string }>({ status: 'idle' });
  const [notesOpen, setNotesOpen] = useState(false);
  const instId = useMemo(() => getInstanceId(), []);
  const consent = getConsent();
  const [anns, setAnns] = useState<Announcement[]>([]);
  const [annLoading, setAnnLoading] = useState(true);
  const initialExam = useMemo(() => getAppSettings().exam, []);
  const [weeklyPlans, setWeeklyPlans] = useState<WeeklyPlan[]>(initialExam.weeklyPlans);
  const [calendarGradeId, setCalendarGradeId] = useState(initialExam.selectedGradeId || initialExam.grades[0]?.id || '');
  const [calendarClassId, setCalendarClassId] = useState(initialExam.selectedClassId);
  const [calendarPlanId, setCalendarPlanId] = useState(() => initialExam.activeWeeklyPlanIdByClassId[initialExam.selectedClassId] ?? initialExam.activeWeeklyPlanId ?? '');
  const [calendarSave, setCalendarSave] = useState('');
  const canEditSettings = adminUser ? adminCan('settings.edit', adminUser) : !hasValidLocalToken();
  const canEditWeekly = adminUser ? adminCan('weekly.edit', adminUser) : !hasValidLocalToken();
  const canReadAlerts = adminUser ? adminCan('alerts.read', adminUser) : !hasValidLocalToken();
  const canEditAlerts = adminUser ? adminCan('alerts.edit', adminUser) : !hasValidLocalToken();
  const toggleTele = (v: boolean) => { setEnabled(v); setTeleOn(v); };
  const reportTele = async () => {
    setTeleMsg('上报中…');
    const ok = await reportNow('manual');
    setTeleMsg(ok ? '已上报 ✓' : '上报失败或未启用');
  };

  useEffect(() => { getRedeployConfigured().then(setRedeployOk).catch(() => {}); }, []);

  // 每次进入设置页都强制拉取最新公告（绕过缓存），确保 md 公告内容及时更新。
  useEffect(() => {
    let alive = true;
    setAnnLoading(true);
    fetchAnnouncements(true)
      .then(list => { if (alive) setAnns(list); })
      .finally(() => { if (alive) setAnnLoading(false); });
    return () => { alive = false; };
  }, []);

  const doCheck = async () => {
    setUpd({ status: 'checking' });
    const info = await checkForUpdate(APP_VERSION);
    setUpd(info.ok ? { status: 'done', info } : { status: 'error', error: info.error });
  };

  const doRedeploy = async () => {
    if (!window.confirm('确定触发 Vercel 重新部署？\n将从 GitHub 拉取最新代码并重新构建，约需 1–3 分钟，完成后刷新页面即为新版本。')) return;
    setRedeploy({ status: 'running', msg: '已触发，正在部署…' });
    const r = await triggerRedeploy();
    if (r.ok) setRedeploy({ status: 'done', msg: '已触发部署 ✓ 请稍后在 Vercel 查看进度，构建完成后刷新页面。' });
    else setRedeploy({ status: 'error', msg: r.code === 'NO_HOOK' ? '未配置部署钩子（VERCEL_DEPLOY_HOOK_URL）' : (r.error || '触发失败') });
  };

  const readmeHtml = useMemo(() => renderMarkdown(readmeRaw), []);

  useEffect(() => {
    const onUpd = () => { setTs(getAppSettings().general.timeSync); setSyncing(false); };
    window.addEventListener('timeSync:updated', onUpd as EventListener);
    return () => window.removeEventListener('timeSync:updated', onUpd as EventListener);
  }, []);

  const patchTs = (p: Partial<TimeSyncSettings>, reschedule = false) => {
    updateTimeSyncSettings(p);
    setTs(getAppSettings().general.timeSync);
    if (reschedule) window.dispatchEvent(new CustomEvent('timeSync:reschedule'));
  };

  const syncNow = () => {
    setSyncing(true);
    window.dispatchEvent(new CustomEvent('timeSync:syncNow'));
    window.setTimeout(() => setSyncing(false), 8000);
  };

  const patchErr = (mode: ErrMode) => {
    updateAppSettings(c => ({ study: { ...c.study, alerts: { ...c.study.alerts, errorCenterMode: mode } } }));
    setErrMode(mode);
  };

  const patchDesign = (id: string) => { setDesignId(id); setDesign(id); };
  const patchMotion = (m: MotionMode) => { updateMotionMode(m); setMotionMode(m); applyMotionSettings(m); };
  const patchTypography = (role: keyof TypographySettings, font: TypographyFontId) => {
    const next = { ...typography, [role]: font };
    updateAppSettings(c => ({ general: { ...c.general, typography: next } }));
    setTypography(next);
    applyTypographySettings(next);
  };

  const resetTypography = () => {
    const next = { ...DEFAULT_TYPOGRAPHY };
    updateAppSettings(c => ({ general: { ...c.general, typography: next } }));
    setTypography(next); applyTypographySettings(next);
  };

  const openReadme = () => {
    const blob = new Blob([readmeRaw], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const resetLocal = () => {
    if (!window.confirm('确定清除本机所有本地设置并恢复默认？\n（仅影响当前浏览器，不影响云端考试数据）')) return;
    try { localStorage.removeItem(APP_SETTINGS_KEY); localStorage.removeItem('exam_design_id'); } catch { /* ignore */ }
    window.location.reload();
  };

  const grades = useMemo(() => sortedGrades(initialExam.grades), [initialExam]);
  const classes = useMemo(() => sortedClasses(initialExam.classes, calendarGradeId), [initialExam, calendarGradeId]);
  const classPlans = weeklyPlans.filter(plan => plan.classId === calendarClassId);
  const calendarPlan = classPlans.find(plan => plan.id === calendarPlanId) ?? classPlans[0] ?? null;

  const selectCalendarClass = (classId: string) => {
    setCalendarClassId(classId);
    const exam = getAppSettings().exam;
    setCalendarPlanId(exam.activeWeeklyPlanIdByClassId[classId] ?? weeklyPlans.find(plan => plan.classId === classId)?.id ?? '');
  };

  const saveCalendarPlan = async (updates: Partial<WeeklyPlan>) => {
    if (!calendarPlan || !canEditWeekly) return;
    const nextPlans = weeklyPlans.map(plan => plan.id === calendarPlan.id ? { ...plan, ...updates } : plan);
    setWeeklyPlans(nextPlans);
    updateExamSettings({ weeklyPlans: nextPlans, updatedAt: Date.now() });
    setCalendarSave('正在保存到云端…');
    const exam = getAppSettings().exam;
    const input = { items: exam.items, title: exam.title, majors: exam.majors, activeMajorId: exam.activeMajorId, alerts: getAppSettings().alerts, scheduleMode: exam.scheduleMode, weeklyPlans: nextPlans, activeWeeklyPlanId: exam.activeWeeklyPlanId, activeWeeklyPlanIdByClassId: exam.activeWeeklyPlanIdByClassId, grades: exam.grades, classes: exam.classes, weeklyConflictPolicy: exam.weeklyConflictPolicy };
    let persistedPlans = nextPlans;
    let result = await saveExamsToServer({ ...input, baseUpdatedAt: getCloudSnapshot()?.updatedAt ?? 0 });
    if (result && typeof result === 'object' && result.kind === 'conflict' && result.remote) {
      const remote = result.remote;
      const mergedPlans = (remote.weeklyPlans ?? nextPlans).map(plan => plan.id === calendarPlan.id ? { ...plan, ...updates } : plan);
      if (!mergedPlans.some(plan => plan.id === calendarPlan.id)) mergedPlans.push({ ...calendarPlan, ...updates });
      persistedPlans = mergedPlans;
      result = await saveExamsToServer({
        ...input,
        items: remote.items,
        title: remote.title,
        majors: remote.majors,
        activeMajorId: remote.activeMajorId,
        alerts: remote.alerts,
        scheduleMode: remote.scheduleMode ?? input.scheduleMode,
        weeklyPlans: mergedPlans,
        activeWeeklyPlanId: remote.activeWeeklyPlanId ?? input.activeWeeklyPlanId,
        activeWeeklyPlanIdByClassId: remote.activeWeeklyPlanIdByClassId ?? input.activeWeeklyPlanIdByClassId,
        grades: remote.grades ?? input.grades,
        classes: remote.classes ?? input.classes,
        weeklyConflictPolicy: remote.weeklyConflictPolicy ?? input.weeklyConflictPolicy,
        baseUpdatedAt: remote.updatedAt,
      });
    }
    if (result === 'unauthorized') { navigate('/login?next=/settings', { replace: true }); return; }
    if (typeof result === 'number') { setWeeklyPlans(persistedPlans); updateExamSettings({ weeklyPlans: persistedPlans, updatedAt: result }); setCalendarSave('已保存到云端'); }
    else setCalendarSave('保存失败，请检查网络后重试');
  };

  if (!authed) return <div className="set-loading">正在验证管理权限…</div>;

  const ready = isTimeSyncReady();
  const lastSyncLabel = ts.lastSyncAt > 0 ? formatDateTimeInZone(ts.lastSyncAt) : '尚未校时';

  return (
    <div className="set-page">
      <header className="set-header">
        <div className="set-header__left">
          <button className="set-back" onClick={() => navigate('/admin')}>← 返回管理</button>
          <h1 className="set-title">系统设置</h1>
        </div>
        <span className="set-version">v{APP_VERSION}</span>
      </header>

      <div className="set-body">
        {!canEditSettings && <div className="set-note set-note--warn">当前账号对系统设置只有查看权限。如需修改登录密码，请前往“用户与权限”。</div>}
        <section className="set-card">
          <div className="set-card__head"><h2 className="set-card__title">周测日历</h2></div>
          <p className="set-card__lead">配置学期周次和法定节假日。学期开始日期所在周按 A 周计算，下一周自动切换为 B 周。</p>
          <div className="set-fieldset">
            <div className="set-row"><label className="set-label">年级</label><select className="set-input" value={calendarGradeId} onChange={event => { setCalendarGradeId(event.target.value); setCalendarClassId(''); }}><option value="">请选择年级</option>{grades.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
            <div className="set-row"><label className="set-label">班级</label><select className="set-input" value={calendarClassId} onChange={event => selectCalendarClass(event.target.value)}><option value="">请选择班级</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
            {classPlans.length > 1 && <div className="set-row"><label className="set-label">周测计划</label><select className="set-input" value={calendarPlan?.id ?? ''} onChange={event => setCalendarPlanId(event.target.value)}>{classPlans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></div>}
            {calendarPlan ? <>
              <div className="set-row"><label className="set-label">学期开始日期 <HelpTip title="A/B 周基准">该日期所在周固定为 A 周，后续自然周按 A、B 交替推算。修改日期会立即反映到日历预览。</HelpTip></label><input className="set-input" type="date" disabled={!canEditWeekly} value={calendarPlan.anchorDate} onChange={event => void saveCalendarPlan({ anchorDate: event.target.value })} /></div>
              <div className="set-row"><label className="set-label">周次模式</label><select className="set-input" disabled={!canEditWeekly} value={calendarPlan.weekMode ?? 'single'} onChange={event => void saveCalendarPlan({ weekMode: event.target.value as WeeklyWeekMode })}><option value="single">统一周表</option><option value="ab">A/B 周交替</option></select></div>
              <div className="set-row"><label className="set-label">法定节假日自动排除</label><Switch checked={calendarPlan.excludeOfficialHolidays === true} disabled={!canEditWeekly} onChange={value => void saveCalendarPlan({ excludeOfficialHolidays: value })} /></div>
              {calendarPlan.excludeOfficialHolidays && <p className="set-note set-holiday-list">已启用：{OFFICIAL_HOLIDAYS.map(item => `${item.name} ${item.start.slice(5)}~${item.end.slice(5)}`).join(' · ')}</p>}
              {calendarSave && <p className="set-note" aria-live="polite">{calendarSave}</p>}
            </> : <div className="set-note set-note--warn">当前班级还没有周测计划，请先到管理后台的“周测”页创建计划。</div>}
          </div>
        </section>

        {/* ―― 时间同步 ―― */}
        <section className="set-card">
          <div className="set-card__head">
            <h2 className="set-card__title">🕐 时间同步（校时） <HelpTip title="校时方式">时间接口精度最高且适合大屏；HTTP Date 无需专用接口但精度较低；浏览器不能直接使用 NTP。</HelpTip></h2>
            <Switch checked={ts.enabled} disabled={!canEditSettings} onChange={v => patchTs({ enabled: v }, true)} />
          </div>
          <p className="set-card__lead">开启后大屏时钟、倒计时与全屏提醒均基于校准后的网络时间触发；关闭后回退使用本机时钟。</p>

          <div className={`set-fieldset${ts.enabled ? '' : ' is-dim'}`}>
            <div className="set-row">
              <label className="set-label">校时方式</label>
              <select className="set-input" disabled={!canEditSettings} value={ts.provider} onChange={e => patchTs({ provider: e.target.value as TimeSyncSettings['provider'] }, true)}>
                <option value="timeApi">时间接口 (timeApi · 推荐)</option>
                <option value="httpDate">HTTP 响应头 (Date)</option>
                <option value="ntp">NTP（仅服务端）</option>
              </select>
            </div>

            {ts.provider === 'timeApi' && (
              <div className="set-row">
                <label className="set-label">时间接口 URL</label>
                <input className="set-input" disabled={!canEditSettings} value={ts.timeApiUrl} placeholder="/api/time" onChange={e => patchTs({ timeApiUrl: e.target.value })} />
              </div>
            )}
            {ts.provider === 'httpDate' && (
              <div className="set-row">
                <label className="set-label">探测 URL</label>
                <input className="set-input" disabled={!canEditSettings} value={ts.httpDateUrl} placeholder="/" onChange={e => patchTs({ httpDateUrl: e.target.value })} />
              </div>
            )}
            {ts.provider === 'ntp' && (
              <div className="set-note set-note--warn">⚠️ 浏览器环境无法直连 NTP，请改用“时间接口”或“HTTP 响应头”方式；NTP 仅供服务端代理使用。</div>
            )}

            <div className="set-row">
              <label className="set-label">自动定时校时</label>
              <Switch checked={ts.autoSyncEnabled} disabled={!canEditSettings} onChange={v => patchTs({ autoSyncEnabled: v }, true)} />
            </div>
            <div className="set-row">
              <label className="set-label">校时间隔（秒）</label>
              <input
                className="set-input set-input--sm" type="number" min={10} step={10} inputMode="numeric" disabled={!canEditSettings}
                value={ts.autoSyncIntervalSec}
                onChange={e => patchTs({ autoSyncIntervalSec: Math.max(10, Number(e.target.value) || 10) }, true)}
              />
            </div>
            <div className="set-row">
              <label className="set-label">手动微调（毫秒）</label>
              <input
                className="set-input set-input--sm" type="number" step={100} disabled={!canEditSettings}
                value={ts.manualOffsetMs}
                onChange={e => patchTs({ manualOffsetMs: Number(e.target.value) || 0 })}
              />
            </div>
          </div>

          <div className="set-status">
            <div className="set-status__row">
              <span className={`set-dot ${ready ? 'ok' : 'wait'}`} />
              <span>{ready ? '已校时' : '尚未就绪'}</span>
            </div>
            <ul className="set-status__list">
              <li><span>上次校时</span><b>{lastSyncLabel}</b></li>
              <li><span>当前网络偏移</span><b>{ts.offsetMs} ms</b></li>
              <li><span>往返延迟</span><b>{ts.lastRttMs != null ? `${ts.lastRttMs} ms` : '—'}</b></li>
              {ts.lastError ? <li className="is-err"><span>上次错误</span><b>{ts.lastError}</b></li> : null}
            </ul>
            <button className="set-btn set-btn--primary" disabled={!ts.enabled || syncing} onClick={syncNow}>
              {syncing ? '正在校时…' : '立即校时'}
            </button>
          </div>
        </section>

        {/* ―― 显示 ―― */}
        <section className="set-card">
          <div className="set-card__head"><h2 className="set-card__title">🎨 显示</h2></div>
          <div className="set-row">
            <label className="set-label">默认大屏设计风格</label>
            <select className="set-input" disabled={!canEditSettings} value={designId} onChange={e => patchDesign(e.target.value)}>
              {DESIGNS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <p className="set-note">也可在大屏右上角“切换风格”里实时预览切换；此处设置作为本机默认。</p>
          <div className="set-row">
            <label className="set-label">动效模式</label>
            <select className="set-input" disabled={!canEditSettings} value={motionMode} onChange={e => patchMotion(e.target.value as MotionMode)}>
              <option value="auto">自动（跟随系统“减少动态效果”偏好）</option>
              <option value="best-effects">最佳效果（开满动效）</option>
              <option value="best-performance">最佳性能（关闭动画 / 过渡 / 毛玻璃）</option>
            </select>
          </div>
          <p className="set-note">最佳效果适合日常展示与体验；一体机、低端设备或投影出现卡顿时可切换到最佳性能，全局关闭动画、过渡与毛玻璃。</p>
        </section>

        {/* ―― 字体分区 ―― */}
        <section className="set-card">
          <div className="set-card__head"><h2 className="set-card__title">🔤 字体分区</h2><button className="set-btn set-btn--ghost" disabled={!canEditSettings} onClick={resetTypography}>恢复设计默认</button></div>
          <p className="set-card__lead">所有选择均为已随应用打包的本地字体。设置立即作用于当前大屏，并保存到本机；时钟默认使用 JetBrains Mono 等宽数字（子集已随应用打包）。</p>
          <div className="set-font-grid">
            <label className="set-font-field"><span>① 导航与标签</span><select className="set-input" disabled={!canEditSettings} value={typography.navigation} onChange={e => patchTypography('navigation', e.target.value as TypographyFontId)}>{FONT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select><small>页眉、状态、标签与说明</small><i className="set-font-preview set-font-preview--nav">导航 · 在线 · 已校时</i></label>
            <label className="set-font-field"><span>② 展示标题</span><select className="set-input" disabled={!canEditSettings} value={typography.display} onChange={e => patchTypography('display', e.target.value as TypographyFontId)}><option value="design">按当前设计默认</option>{FONT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select><small>科目主标题与核心强调</small><i className="set-font-preview set-font-preview--display">语文考试</i></label>
            <label className="set-font-field"><span>③ 动态内容</span><select className="set-input" disabled={!canEditSettings} value={typography.content} onChange={e => patchTypography('content', e.target.value as TypographyFontId)}>{FONT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select><small>下一科、卡片内容与动态中文</small><i className="set-font-preview set-font-preview--content">下一科：数学 · 14:30</i></label>
            <label className="set-font-field"><span>④ 时钟与数字</span><select className="set-input" disabled={!canEditSettings} value={typography.numeric} onChange={e => patchTypography('numeric', e.target.value as TypographyFontId)}>{NUMERIC_FONT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select><small>时钟、倒计时、百分比和进度数字</small><i className="set-font-preview set-font-preview--numeric">09:30:00</i></label>
          </div>
          <p className="set-note">默认方案不再使用霞鹜文楷；如需自定义，可仅在本页手动选择它。</p>
        </section>

        {/* ―― 提醒与高级 ―― */}
        <section className="set-card">
          <div className="set-card__head"><h2 className="set-card__title">🔔 提醒与高级</h2></div>
          <div className="set-row">
            <label className="set-label">全屏提醒管理</label>
            {canReadAlerts ? <button className="set-btn" onClick={() => navigate('/admin?alerts=1')}>前往提醒管理 →</button> : <span className="set-note">无查看权限</span>}
          </div>
          <div className="set-row">
            <label className="set-label">静默模式</label>
            <select className="set-input" disabled={!canEditAlerts} value={silentMode} onChange={e => { const v = e.target.value as 'all' | 'keyOnly' | 'pauseUntilExamEnd'; setSilentMode(v); updateAlertsSettings({ silentMode: v }); }}>
              <option value="all">全部提醒</option>
              <option value="keyOnly">仅关键提醒（5分钟 / 开考 / 结束 / 下一科）</option>
              <option value="pauseUntilExamEnd">本场进行中暂停提醒</option>
            </select>
          </div>
          <div className="set-row">
            <label className="set-label">错误中心模式</label>
            <select className="set-input" disabled={!canEditSettings} value={errMode} onChange={e => patchErr(e.target.value as ErrMode)}>
              <option value="off">关闭</option>
              <option value="memory">仅内存（本会话）</option>
              <option value="persist">持久化（本地保存）</option>
            </select>
          </div>
          <div className="set-row">
            <label className="set-label">重置本地设置</label>
            <button className="set-btn set-btn--danger" disabled={!canEditSettings} onClick={resetLocal}>清除本地缓存并恢复默认</button>
          </div>
        </section>

        {/* ―― 使用遥测 ―― */}
        <section className="set-card">
          <div className="set-card__head">
            <h2 className="set-card__title">🛰️ 使用遥测</h2>
            <Switch checked={teleOn} disabled={!canEditSettings} onChange={toggleTele} />
          </div>
          <p className="set-card__lead">作者端上报匿名部署/运行数据（版本、主机、时区、地区、匿名 IP 哈希）；不含考试内容与个人信息。</p>
          <ul className="set-status__list">
            <li><span>同意状态</span><b>{consent === 'granted' ? '已同意' : consent === 'denied' ? '已拒绝' : '未决定'}</b></li>
            <li><span>实例 ID</span><b>{instId.slice(0, 8)}…</b></li>
            <li><span>当前版本</span><b>v{APP_VERSION}</b></li>
          </ul>
          <button className="set-btn set-btn--primary" disabled={!teleOn || !canEditSettings} onClick={reportTele}>立即上报一次</button>
          {teleMsg ? <p className="set-note">{teleMsg}</p> : null}
        </section>

        {/* ―― 版本与更新 ―― */}
        <section className="set-card">
          <div className="set-card__head"><h2 className="set-card__title">🚀 版本与更新</h2></div>
          <p className="set-card__lead">检查 GitHub 仓库最新发布版本；如已配置 Vercel 部署钩子，可一键拉取最新代码并重新部署。</p>
          <ul className="set-status__list">
            <li><span>当前版本</span><b>v{APP_VERSION}</b></li>
            <li><span>最新版本</span><b>{upd.status === 'done' ? (upd.info?.latest ? `v${upd.info.latest}` : '尚无发布') : upd.status === 'checking' ? '检查中…' : '—'}</b></li>
          </ul>
          {upd.status === 'done' && upd.info && (
            upd.info.hasUpdate
              ? <div className="set-note set-note--warn">发现新版本 v{upd.info.latest}{upd.info.releaseUrl ? <> · <a href={upd.info.releaseUrl} target="_blank" rel="noopener noreferrer">查看发布说明</a></> : null}</div>
              : <p className="set-note">✓ 已是最新版本</p>
          )}
          {upd.status === 'done' && upd.info?.notes ? (
            <>
              <button className="set-btn" style={{ marginTop: 8 }} onClick={() => setNotesOpen(o => !o)}>{notesOpen ? '收起更新说明' : '查看更新说明'}</button>
              {notesOpen && <pre className="set-readme" style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' }}>{upd.info.notes}</pre>}
            </>
          ) : null}
          {upd.status === 'error' && <p className="set-note set-note--warn">检查失败：{upd.error}</p>}
          <div className="set-about__actions" style={{ marginTop: 12 }}>
            <button className="set-btn set-btn--primary" disabled={upd.status === 'checking'} onClick={doCheck}>{upd.status === 'checking' ? '检查中…' : '检查更新'}</button>
            {redeployOk && adminCan('deployment.trigger', adminUser) ? <button className="set-btn" disabled={redeploy.status === 'running'} onClick={doRedeploy}>{redeploy.status === 'running' ? '部署中…' : '一键拉取并重新部署'}</button> : null}
          </div>
          {!redeployOk && <p className="set-note">如需「一键重新部署」，请在 Vercel 项目环境变量中配置 <code>VERCEL_DEPLOY_HOOK_URL</code>（Project Settings → Git → Deploy Hooks 生成）。</p>}
          {redeploy.status !== 'idle' && redeploy.msg ? <p className={`set-note${redeploy.status === 'error' ? ' set-note--warn' : ''}`}>{redeploy.msg}</p> : null}
        </section>

        {/* ―― 公告（作者端统一发布） ―― */}
        <section className="set-card">
          <div className="set-card__head"><h2 className="set-card__title">📢 公告</h2></div>
          <p className="set-card__lead">由作者端统一发布，内容以 Markdown 渲染。</p>
          {annLoading ? (
            <p className="set-note">公告加载中…</p>
          ) : anns.length === 0 ? (
            <p className="set-note">暂无公告。</p>
          ) : (
            <AnnouncementList announcements={anns} formatTime={value => formatDateTimeInZone(value)} />
          )}
        </section>

        {/* ―― 关于（置于页面最底部） ―― */}
        <section className="set-card">
          <div className="set-card__head"><h2 className="set-card__title">ℹ️ 关于</h2></div>
          <div className="set-about">
            <div className="set-about__meta">
              <div><b>考试看板 Exam Board</b> · v{APP_VERSION}</div>
              <div className="set-note">React + Vite + Vercel Serverless · Neon Postgres</div>
            </div>
            <div className="set-about__actions">
              <button className="set-btn" onClick={() => setReadmeOpen(o => !o)}>{readmeOpen ? '收起 README' : '查看 README'}</button>
              <button className="set-btn set-btn--desktop-only" onClick={openReadme}>在新标签页打开 README.md</button>
            </div>
          </div>
          {readmeOpen && (
            <div className="set-readme md-body" dangerouslySetInnerHTML={{ __html: readmeHtml }} />
          )}
        </section>
      </div>
    </div>
  );
}
