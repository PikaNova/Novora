import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getAppSettings, updateExamSettings } from '../utils/appSettings';
import { getResolvedExamItems } from '../utils/appSchedule';
import { nowMs, parseZonedTime, formatDateTimeInZone } from '../utils/timeSource';
import { canInstallPwa, isStandalonePwa, promptInstallPwa } from '../services/pwa';
import Watermark from '../components/Watermark';
import BrandMark from '../components/BrandMark';
import ClassMultiPicker from '../components/ClassMultiPicker';
import type { ExamItem } from '../types';
import { sortExamItemsByTime } from '../utils/examSchedule';
import { APP_SETTINGS_CHANGED_EVENT, APP_SETTINGS_KEY } from '../utils/appSettings';
import { cacheDeviceBinding, fetchOccupiedClassIds, getCachedDeviceBinding, getClassBindingInstanceId, hasConfirmedDevicePurpose, markClassChoiceConfirmed, markDevicePurposeConfirmed, markPendingManagementSetup, saveDeviceBinding, setupManagedDevice, type DeviceBinding } from '../services/classBinding';
import { classDisplayName, sortedClasses, sortedGrades } from '../utils/classSettings';
import { useExamSync } from '../hooks/useExamSync';
import { hasValidLocalToken } from '../services/examService';
import { notify } from '../services/notify';
import { confirmDialog } from '../services/appDialog';
import '../styles/welcome.css';
import { CalendarDays, Gauge, LogIn, MonitorCog, X } from 'lucide-react';

const IDLE_MS = 10000;
const PWA_DISMISS_KEY = 'exam_board_pwa_install_dismissed_at';
function getNextExam(items: ExamItem[], now: number): { exam: ExamItem; phase: 'waiting' | 'ongoing' } | null {
  const active = sortExamItemsByTime(items.filter(x => x.enabled));
  for (const exam of active) { const start = parseZonedTime(exam.startTime); const end = parseZonedTime(exam.endTime); if (now < start) return { exam, phase: 'waiting' }; if (now <= end) return { exam, phase: 'ongoing' }; }
  return null;
}
/** 周测实例结构上是标准 ExamItem，运行时附带 kind 字段；用于区分横幅文案（大型考试 / 周测）。 */
function examKind(exam: ExamItem): 'weekly' | 'major' | 'temporary' {
  const kind = (exam as unknown as { kind?: string }).kind;
  return kind === 'weekly' || kind === 'temporary' ? kind : 'major';
}
const pad2 = (n: number) => String(n).padStart(2, '0');
function fmtRemain(ms: number): string { const total = Math.max(0, Math.floor(ms / 1000)); const d = Math.floor(total / 86400); const h = Math.floor((total % 86400) / 3600); const m = Math.floor((total % 3600) / 60); const s = total % 60; return d > 0 ? `${d} 天 ${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(h)}:${pad2(m)}:${pad2(s)}`; }

const LAST_OPENED_KEY = 'exam_board_last_opened_at';
export default function WelcomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const lastOpenedRef = useRef<number>(0);
  useEffect(() => {
    const prev = Number(localStorage.getItem(LAST_OPENED_KEY) || 0);
    lastOpenedRef.current = prev;
    try { localStorage.setItem(LAST_OPENED_KEY, String(Date.now())); } catch { /* ignore */ }
  }, []);
  const [now, setNow] = useState(() => nowMs());
  const [nextExam, setNextExam] = useState<ReturnType<typeof getNextExam>>(() => getNextExam(getResolvedExamItems(nowMs()), nowMs()));
  const [idleLeft, setIdleLeft] = useState(10);
  const [pwaAvailable, setPwaAvailable] = useState(false);
  const [classPromptOpen, setClassPromptOpen] = useState(() => getCachedDeviceBinding()?.revoked === true || new URLSearchParams(location.search).get('selectClass') === '1');
  const initialExam = getAppSettings().exam;
  const [remoteBinding, setRemoteBinding] = useState<DeviceBinding | null | undefined>(() => getCachedDeviceBinding());
  const [grades, setGrades] = useState(() => sortedGrades(initialExam.grades));
  const [classes, setClasses] = useState(() => sortedClasses(initialExam.classes));
  const [promptGradeId, setPromptGradeId] = useState(initialExam.selectedGradeId || '');
  const [occupiedClassIds, setOccupiedClassIds] = useState<string[]>([]);
  const [bindingClassId, setBindingClassId] = useState('');
  const { syncState, refresh } = useExamSync({
    intervalMs: 10000,
    minRefreshMs: 5000,
    bootstrapInstanceId: hasConfirmedDevicePurpose() ? undefined : getClassBindingInstanceId(),
    onBootstrapBinding: binding => { cacheDeviceBinding(binding); if (binding && !binding.revoked) markDevicePurposeConfirmed(); setRemoteBinding(binding); },
  });
  const managementSetupRef = useRef(false);
  const appliedRemoteBindingRef = useRef('');
  const deadline = useRef(Date.now() + IDLE_MS);
  const resetIdle = () => { deadline.current = Date.now() + IDLE_MS; setIdleLeft(10); };

  useEffect(() => { const update = () => { const t = nowMs(); const exam = getAppSettings().exam; setNow(t); setNextExam(getNextExam(getResolvedExamItems(t), t)); setGrades(sortedGrades(exam.grades)); setClasses(sortedClasses(exam.classes)); }; const onStorage = (event: StorageEvent) => { if (event.key === APP_SETTINGS_KEY) update(); }; update(); const id = window.setInterval(update, 1000); window.addEventListener(APP_SETTINGS_CHANGED_EVENT, update); window.addEventListener('storage', onStorage); window.addEventListener('focus', update); window.addEventListener('pageshow', update); return () => { clearInterval(id); window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, update); window.removeEventListener('storage', onStorage); window.removeEventListener('focus', update); window.removeEventListener('pageshow', update); }; }, []);
  useEffect(() => { const key = remoteBinding ? `${remoteBinding.gradeId}:${remoteBinding.classId}:${remoteBinding.revoked}:${remoteBinding.isManagement}` : ''; if (!remoteBinding || appliedRemoteBindingRef.current === key) return; appliedRemoteBindingRef.current = key; if (remoteBinding.revoked) { updateExamSettings({ selectedGradeId: '', selectedClassId: '' }); setClassPromptOpen(true); return; } if (remoteBinding.isManagement) { updateExamSettings({ selectedGradeId: '', selectedClassId: '' }); markDevicePurposeConfirmed(); setClassPromptOpen(false); return; } if (classes.some(item => item.id === remoteBinding.classId && item.gradeId === remoteBinding.gradeId)) { updateExamSettings({ selectedGradeId: remoteBinding.gradeId, selectedClassId: remoteBinding.classId }); markClassChoiceConfirmed(); markDevicePurposeConfirmed(); setClassPromptOpen(false); } }, [remoteBinding, classes]);
  useEffect(() => { const revoked = () => { setRemoteBinding({ gradeId: '', classId: '', revoked: true }); setClassPromptOpen(true); resetIdle(); }; window.addEventListener('exam-board:device-revoked', revoked); return () => window.removeEventListener('exam-board:device-revoked', revoked); }, []);
  useEffect(() => { const updated = (event: Event) => setRemoteBinding((event as CustomEvent<DeviceBinding>).detail); window.addEventListener('exam-board:binding-updated', updated); return () => window.removeEventListener('exam-board:binding-updated', updated); }, []);
  const currentExamSettings = getAppSettings().exam;
  const isInitialized = grades.length > 0 && classes.length > 0;
  const isManagement = remoteBinding?.isManagement === true;
  const isBound = Boolean(currentExamSettings.selectedClassId && classes.some(item => item.id === currentExamSettings.selectedClassId));
  const classDataLoading = !isInitialized && (syncState === 'local' || syncState === 'syncing');
  useEffect(() => { const tick = () => { if (classPromptOpen || !isInitialized || !isBound) { resetIdle(); return; } const left = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)); setIdleLeft(left); if (left <= 0) navigate('/exam'); }; const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'click']; events.forEach(e => window.addEventListener(e, resetIdle, { passive: true })); tick(); const id = window.setInterval(tick, 250); return () => { clearInterval(id); events.forEach(e => window.removeEventListener(e, resetIdle)); }; }, [navigate, classPromptOpen, isInitialized, isBound]);
  useEffect(() => { const refresh = () => { const dismissed = Number(localStorage.getItem(PWA_DISMISS_KEY) ?? 0); setPwaAvailable(!nextExam && !isStandalonePwa() && canInstallPwa() && Date.now() - dismissed > 7 * 86400000); }; refresh(); window.addEventListener('pwa:available', refresh); return () => window.removeEventListener('pwa:available', refresh); }, [nextExam]);
  useEffect(() => {
    if (!isInitialized || syncState !== 'synced' || remoteBinding !== null || hasConfirmedDevicePurpose()) return;
    setClassPromptOpen(true);
  }, [isInitialized, remoteBinding, syncState]);
  useEffect(() => {
    if (!classPromptOpen || !isInitialized) return;
    let active = true;
    void fetchOccupiedClassIds().then(ids => { if (active) setOccupiedClassIds(ids); }).catch(() => { if (active) setOccupiedClassIds([]); });
    return () => { active = false; };
  }, [classPromptOpen, isInitialized]);
  useEffect(() => {
    const wantsManagement = new URLSearchParams(location.search).get('management') === '1';
    if (!wantsManagement || managementSetupRef.current || !hasValidLocalToken()) return;
    managementSetupRef.current = true;
    void setupManagedDevice({ bindManagement: true }).then(() => {
      const binding: DeviceBinding = { gradeId: '', classId: '', revoked: false, isManagement: true };
      updateExamSettings({ selectedGradeId: '', selectedClassId: '' });
      setRemoteBinding(binding);
      notify('success', '本设备已登记为管理设备。');
      navigate('/admin', { replace: true });
    }).catch(error => {
      managementSetupRef.current = false;
      notify('error', error instanceof Error ? error.message : '管理设备登记失败');
    });
  }, [location.search, navigate]);
  const install = async () => { resetIdle(); const installed = await promptInstallPwa(); if (installed) setPwaAvailable(false); };
  const dismissPwa = () => { localStorage.setItem(PWA_DISMISS_KEY, String(Date.now())); setPwaAvailable(false); resetIdle(); };
  const chooseClass = async (classId: string) => {
    if (!promptGradeId || !classId || bindingClassId) return;
    setBindingClassId(classId);
    try {
      let replaceExisting = occupiedClassIds.includes(classId);
      if (replaceExisting && !(await confirmDialog({ title: '该班级已绑定其他设备', message: '继续后将解除原考试端及其 ClassIsland 配对，并将当前设备设为该班级的新考试端。', tone: 'warning', confirmLabel: '解除旧设备并绑定本机' }))) return;
      let result = await saveDeviceBinding(promptGradeId, classId, replaceExisting);
      if (!result.ok && result.conflict && !replaceExisting) {
        replaceExisting = await confirmDialog({ title: '该班级已绑定其他设备', message: '继续后将解除原考试端及其 ClassIsland 配对，并将当前设备设为该班级的新考试端。', tone: 'warning', confirmLabel: '解除旧设备并绑定本机' });
        if (!replaceExisting) return;
        result = await saveDeviceBinding(promptGradeId, classId, true);
      }
      if (!result.ok) { notify('error', result.error); return; }
      const binding: DeviceBinding = { gradeId: promptGradeId, classId, revoked: false, isManagement: false };
      updateExamSettings({ selectedGradeId: promptGradeId, selectedClassId: classId });
      setRemoteBinding(binding);
      setClassPromptOpen(false);
      notify('success', result.replaced ? '已解除旧设备并将本机绑定为新的班级考试端。' : '本机已绑定为该班级考试端。');
      resetIdle();
    } finally { setBindingClassId(''); }
  };
  const openClassPrompt = () => { setPromptGradeId(currentExamSettings.selectedGradeId || ''); setClassPromptOpen(true); resetIdle(); };
  const enterExam = () => { if (!isBound) { openClassPrompt(); return; } navigate('/exam'); };
  const bindAsManagement = () => {
    const target = '/?management=1';
    markPendingManagementSetup();
    if (!hasValidLocalToken()) { navigate(`/login?next=${encodeURIComponent(target)}`); return; }
    if (managementSetupRef.current) return;
    managementSetupRef.current = true;
    void setupManagedDevice({ bindManagement: true }).then(() => {
      const binding: DeviceBinding = { gradeId: '', classId: '', revoked: false, isManagement: true };
      updateExamSettings({ selectedGradeId: '', selectedClassId: '' });
      setRemoteBinding(binding); setClassPromptOpen(false);
      notify('success', '本设备已登记为管理设备。');
      navigate('/admin');
    }).catch(error => { managementSetupRef.current = false; notify('error', error instanceof Error ? error.message : '管理设备登记失败'); });
  };
  const openInitialization = () => {
    const target = '/admin?initialize=1';
    navigate(hasValidLocalToken() ? target : `/login?mode=initialize&next=${encodeURIComponent(target)}`);
  };
  const ongoing = nextExam?.phase === 'ongoing'; const startMs = nextExam ? parseZonedTime(nextExam.exam.startTime) : NaN; const endMs = nextExam ? parseZonedTime(nextExam.exam.endTime) : NaN; const countdownMs = nextExam ? (ongoing ? endMs - now : startMs - now) : 0;
  const currentClass = classDisplayName(currentExamSettings.grades, currentExamSettings.classes, currentExamSettings.selectedClassId);
  const resolvedTitle = !isBound
    ? '未选择班级'
    : nextExam
      ? examKind(nextExam.exam) === 'weekly'
        ? '周测'
        : examKind(nextExam.exam) === 'temporary'
          ? `${nextExam.exam.name} · 临时考试`
          : ((nextExam.exam as ExamItem & { majorName?: string }).majorName || nextExam.exam.name)
      : '暂无考试安排';
  return <div className="welcome-page"><div className="welcome-header"><BrandMark className="welcome-brand" /><h1 className="welcome-title">考试看板</h1><p className="welcome-subtitle">{isBound ? `${currentClass} · ` : ''}{resolvedTitle} · {new Date(now).toLocaleTimeString('zh-CN', { hour12: false })}</p>{lastOpenedRef.current > 0 && <p className="welcome-lastopen">上次打开 {formatDateTimeInZone(lastOpenedRef.current)}</p>}</div>
    {!nextExam && <div className="welcome-exam-banner is-ended"><div className="welcome-exam-banner__eyebrow">当前状态</div><span className="welcome-exam-banner__icon">✓</span><div className="welcome-exam-banner__info"><strong>暂无进行中的考试</strong><span>可进入管理后台安排下一场考试</span></div><div className="welcome-exam-banner__count is-status"><small>看板状态</small>待安排</div></div>}
    {nextExam && <div className={`welcome-exam-banner ${ongoing ? 'is-ongoing' : 'is-waiting'}`}><div className="welcome-exam-banner__eyebrow">{ongoing ? (examKind(nextExam.exam) === 'weekly' ? '周测进行中' : '正在考试') : (examKind(nextExam.exam) === 'weekly' ? '下一场周测' : '下一场考试')}</div><span className="welcome-exam-banner__icon">{ongoing ? '●' : '→'}</span><div className="welcome-exam-banner__info"><strong>{nextExam.exam.name}</strong><span>{ongoing ? '开始 ' : '开考 '}{formatDateTimeInZone(startMs)}</span></div><div className="welcome-exam-banner__count"><small>{ongoing ? '距结束' : '距开考'}</small>{fmtRemain(countdownMs)}</div></div>}
    {!isInitialized && <div className="welcome-setup-notice"><div><strong>{classDataLoading ? '正在同步班级配置' : syncState === 'synced' ? '系统尚未初始化' : '暂时无法读取班级配置'}</strong><span>{classDataLoading ? '正在从云端获取年级与班级，请稍候。' : syncState === 'synced' ? '云端尚未创建年级和班级，请完成首次初始化。' : '请检查网络后重试；现有云端数据不会被当作未初始化。'}</span></div>{syncState === 'synced' ? <button onClick={openInitialization}>开始初始化</button> : !classDataLoading ? <button onClick={() => void refresh(true)}>重新同步</button> : null}</div>}
    {isInitialized && isManagement && <div className="welcome-setup-notice welcome-setup-notice--management"><div><strong>本设备为管理设备</strong><span>不绑定班级、不占用班级考试端名额，也不会自动进入考试大屏。</span></div><button onClick={() => navigate('/admin')}>进入管理后台</button><button onClick={openClassPrompt}>改为班级考试端</button></div>}
    {isInitialized && !isBound && !isManagement && <div className="welcome-setup-notice"><div><strong>本机尚未选择用途</strong><span>绑定班级考试端，或登录后将本机登记为管理设备。</span></div><button onClick={openClassPrompt}>选择设备用途</button></div>}
    <div className="welcome-grid welcome-grid--has-exam"><button className="welcome-card welcome-card--featured" onClick={enterExam}><span className="welcome-card__icon"><Gauge /></span><span className="welcome-card__text"><span className="welcome-card__label">{ongoing ? '返回考试大屏' : nextExam ? '查看开考倒计时' : '查看考试大屏'}</span><span className="welcome-card__desc">{ongoing ? '正在进行，显示剩余时间' : nextExam ? '下一场考试与开考时间' : classDataLoading ? '正在同步班级设置' : !isBound ? '进入时选择本机班级' : '暂无考试，可先进行安排'}</span></span></button><button className="welcome-card" onClick={() => navigate('/preferences')}><span className="welcome-card__icon"><CalendarDays /></span><span className="welcome-card__text"><span className="welcome-card__label">考试安排预览</span><span className="welcome-card__desc">本班日历与 A4 导出</span></span></button><button className="welcome-card" onClick={() => navigate('/local-settings')}><span className="welcome-card__icon"><MonitorCog /></span><span className="welcome-card__text"><span className="welcome-card__label">本地设置</span><span className="welcome-card__desc">班级、显示与字体</span></span></button><button className="welcome-card" onClick={() => navigate('/admin')}><span className="welcome-card__icon"><LogIn /></span><span className="welcome-card__text"><span className="welcome-card__label">登录管理</span><span className="welcome-card__desc">使用账户进入管理后台</span></span></button></div>
    {pwaAvailable && <div className="welcome-pwa"><span>📲 可添加到设备桌面，便于离线使用</span><button onClick={install}>添加</button><button className="welcome-pwa__dismiss" onClick={dismissPwa}>暂不</button></div>}
    <p className="welcome-idle-hint">{isInitialized && isBound ? <><b>{idleLeft}</b> 秒后自动进入考试大屏</> : isManagement ? '管理设备不会自动进入考试大屏' : '完成初始化并选择班级后启用自动进入大屏'}</p><Watermark />
    {classPromptOpen && <div className="welcome-class-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-class-title"><div className="welcome-class-dialog">{(isBound || isManagement) && <button type="button" className="welcome-class-dialog__close" onClick={() => setClassPromptOpen(false)} aria-label="关闭班级选择"><X /></button>}<span className="welcome-class-dialog__eyebrow">本设备用途</span><h2 id="welcome-class-title">绑定班级考试端</h2><p>{remoteBinding?.revoked ? '此设备已被管理员删除，请重新选择设备用途。' : '标记“已绑定”的班级仍可选择，确认后会由本机接替原考试端。'}</p>{isInitialized ? <div className="welcome-class-options"><div className="welcome-class-step"><span>1. 选择年级</span><div className="welcome-class-choices" role="listbox" aria-label="选择年级">{grades.map(item => <button type="button" role="option" aria-selected={promptGradeId === item.id} className={promptGradeId === item.id ? 'is-selected' : ''} key={item.id} onClick={() => setPromptGradeId(item.id)}>{item.name}</button>)}</div></div>{promptGradeId && <div className="welcome-class-step"><span>2. 搜索并选择班级</span><ClassMultiPicker options={classes.map(item => ({ id: item.id, gradeId: item.gradeId, gradeName: grades.find(grade => grade.id === item.gradeId)?.name || '未知年级', className: item.name, statusLabel: occupiedClassIds.includes(item.id) ? '已绑定' : undefined }))} gradeId={promptGradeId} selectedIds={bindingClassId ? [bindingClassId] : []} onChange={ids => void chooseClass(ids[0] || '')} disabled={Boolean(bindingClassId)} single /></div>}<div className="welcome-class-management"><span>本机仅用于管理？</span><button type="button" onClick={bindAsManagement}>登录并绑定为管理设备</button></div></div> : classDataLoading ? <div className="welcome-class-loading" role="status"><span />正在同步考试与班级设置…</div> : <div className="welcome-class-empty"><strong>{syncState === 'synced' ? '尚未创建可选择的班级' : '班级配置暂时不可用'}</strong><span>{syncState === 'synced' ? '请先由超级管理员完成学校、年级和班级初始化。' : '请检查网络后重新同步，避免覆盖已有云端配置。'}</span><div><button type="button" onClick={() => void refresh(true)}>重新同步</button>{syncState === 'synced' && <button type="button" className="is-primary" onClick={openInitialization}>开始初始化</button>}</div></div>}</div></div>}
  </div>;
}
