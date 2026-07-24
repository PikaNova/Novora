import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAppSettings, updateExamSettings } from '../utils/appSettings';
import { getResolvedExamItems } from '../utils/appSchedule';
import { nowMs, parseZonedTime, formatDateTimeInZone } from '../utils/timeSource';
import { canInstallPwa, isStandalonePwa, promptInstallPwa } from '../services/pwa';
import Watermark from '../components/Watermark';
import type { ExamItem } from '../types';
import { sortExamItemsByTime } from '../utils/examSchedule';
import { APP_SETTINGS_CHANGED_EVENT, APP_SETTINGS_KEY } from '../utils/appSettings';
import { cacheDeviceBinding, getCachedDeviceBinding, getClassBindingInstanceId, hasConfirmedClassChoice, markClassChoiceConfirmed, saveDeviceBinding, type DeviceBinding } from '../services/classBinding';
import { classDisplayName, sortedClasses, sortedGrades } from '../utils/classSettings';
import { useExamSync } from '../hooks/useExamSync';
import '../styles/welcome.css';
import { CalendarDays, Gauge, LogIn, MonitorCog } from 'lucide-react';

const IDLE_MS = 10000;
const PWA_DISMISS_KEY = 'exam_board_pwa_install_dismissed_at';
function getNextExam(items: ExamItem[], now: number): { exam: ExamItem; phase: 'waiting' | 'ongoing' } | null {
  const active = sortExamItemsByTime(items.filter(x => x.enabled));
  for (const exam of active) { const start = parseZonedTime(exam.startTime); const end = parseZonedTime(exam.endTime); if (now < start) return { exam, phase: 'waiting' }; if (now <= end) return { exam, phase: 'ongoing' }; }
  return null;
}
/** 周测实例结构上是标准 ExamItem，运行时附带 kind 字段；用于区分横幅文案（大型考试 / 周测）。 */
function examKind(exam: ExamItem): 'weekly' | 'major' {
  return (exam as unknown as { kind?: string }).kind === 'weekly' ? 'weekly' : 'major';
}
const pad2 = (n: number) => String(n).padStart(2, '0');
function fmtRemain(ms: number): string { const total = Math.max(0, Math.floor(ms / 1000)); const d = Math.floor(total / 86400); const h = Math.floor((total % 86400) / 3600); const m = Math.floor((total % 3600) / 60); const s = total % 60; return d > 0 ? `${d} 天 ${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(h)}:${pad2(m)}:${pad2(s)}`; }

const LAST_OPENED_KEY = 'exam_board_last_opened_at';
export default function WelcomePage() {
  const navigate = useNavigate();
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
  const [classPromptOpen, setClassPromptOpen] = useState(() => getCachedDeviceBinding()?.revoked === true);
  const initialExam = getAppSettings().exam;
  const [remoteBinding, setRemoteBinding] = useState<DeviceBinding | null | undefined>(() => getCachedDeviceBinding());
  const [grades, setGrades] = useState(() => sortedGrades(initialExam.grades));
  const [classes, setClasses] = useState(() => sortedClasses(initialExam.classes));
  const [promptGradeId, setPromptGradeId] = useState(initialExam.selectedGradeId || '');
  const { syncState } = useExamSync({
    bootstrapInstanceId: hasConfirmedClassChoice() ? undefined : getClassBindingInstanceId(),
    onBootstrapBinding: binding => { cacheDeviceBinding(binding); setRemoteBinding(binding); },
  });
  const appliedRemoteBindingRef = useRef('');
  const deadline = useRef(Date.now() + IDLE_MS);
  const resetIdle = () => { deadline.current = Date.now() + IDLE_MS; setIdleLeft(10); };

  useEffect(() => { const update = () => { const t = nowMs(); const exam = getAppSettings().exam; setNow(t); setNextExam(getNextExam(getResolvedExamItems(t), t)); setGrades(sortedGrades(exam.grades)); setClasses(sortedClasses(exam.classes)); }; const onStorage = (event: StorageEvent) => { if (event.key === APP_SETTINGS_KEY) update(); }; update(); const id = window.setInterval(update, 1000); window.addEventListener(APP_SETTINGS_CHANGED_EVENT, update); window.addEventListener('storage', onStorage); window.addEventListener('focus', update); window.addEventListener('pageshow', update); return () => { clearInterval(id); window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, update); window.removeEventListener('storage', onStorage); window.removeEventListener('focus', update); window.removeEventListener('pageshow', update); }; }, []);
  useEffect(() => { const key = remoteBinding ? `${remoteBinding.gradeId}:${remoteBinding.classId}:${remoteBinding.revoked}` : ''; if (!remoteBinding || appliedRemoteBindingRef.current === key) return; appliedRemoteBindingRef.current = key; if (remoteBinding.revoked) { updateExamSettings({ selectedGradeId: '', selectedClassId: '' }); setClassPromptOpen(true); return; } if (classes.some(item => item.id === remoteBinding.classId && item.gradeId === remoteBinding.gradeId)) { updateExamSettings({ selectedGradeId: remoteBinding.gradeId, selectedClassId: remoteBinding.classId }); markClassChoiceConfirmed(); setClassPromptOpen(false); } }, [remoteBinding, classes]);
  useEffect(() => { const revoked = () => { setRemoteBinding({ gradeId: '', classId: '', revoked: true }); setClassPromptOpen(true); resetIdle(); }; window.addEventListener('exam-board:device-revoked', revoked); return () => window.removeEventListener('exam-board:device-revoked', revoked); }, []);
  const currentExamSettings = getAppSettings().exam;
  const isInitialized = grades.length > 0 && classes.length > 0;
  const isBound = Boolean(currentExamSettings.selectedClassId && classes.some(item => item.id === currentExamSettings.selectedClassId));
  useEffect(() => { const tick = () => { if (classPromptOpen || !isInitialized || !isBound) { resetIdle(); return; } const left = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)); setIdleLeft(left); if (left <= 0) navigate('/exam'); }; const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'click']; events.forEach(e => window.addEventListener(e, resetIdle, { passive: true })); tick(); const id = window.setInterval(tick, 250); return () => { clearInterval(id); events.forEach(e => window.removeEventListener(e, resetIdle)); }; }, [navigate, classPromptOpen, isInitialized, isBound]);
  useEffect(() => { const refresh = () => { const dismissed = Number(localStorage.getItem(PWA_DISMISS_KEY) ?? 0); setPwaAvailable(!nextExam && !isStandalonePwa() && canInstallPwa() && Date.now() - dismissed > 7 * 86400000); }; refresh(); window.addEventListener('pwa:available', refresh); return () => window.removeEventListener('pwa:available', refresh); }, [nextExam]);
  const install = async () => { resetIdle(); const installed = await promptInstallPwa(); if (installed) setPwaAvailable(false); };
  const dismissPwa = () => { localStorage.setItem(PWA_DISMISS_KEY, String(Date.now())); setPwaAvailable(false); resetIdle(); };
  const chooseClass = (classId: string) => { if (!promptGradeId || !classId) return; updateExamSettings({ selectedGradeId: promptGradeId, selectedClassId: classId }); void saveDeviceBinding(promptGradeId, classId); setClassPromptOpen(false); resetIdle(); };
  const enterExam = () => { if (!isInitialized) { navigate('/admin'); return; } if (!isBound) { setPromptGradeId(currentExamSettings.selectedGradeId || ''); setClassPromptOpen(true); return; } navigate('/exam'); };
  const ongoing = nextExam?.phase === 'ongoing'; const startMs = nextExam ? parseZonedTime(nextExam.exam.startTime) : NaN; const endMs = nextExam ? parseZonedTime(nextExam.exam.endTime) : NaN; const countdownMs = nextExam ? (ongoing ? endMs - now : startMs - now) : 0;
  const currentClass = classDisplayName(currentExamSettings.grades, currentExamSettings.classes, currentExamSettings.selectedClassId);
  const classOptionsReady = grades.length > 0 || (syncState !== 'local' && syncState !== 'syncing');
  return <div className="welcome-page"><div className="welcome-header"><p className="welcome-kicker">EXAM BOARD · LOCAL FIRST</p><h1 className="welcome-title">考试看板</h1><p className="welcome-subtitle">{currentExamSettings.selectedClassId ? `${currentClass} · ` : ''}{getAppSettings().exam.title} · {new Date(now).toLocaleTimeString('zh-CN', { hour12: false })}</p>{lastOpenedRef.current > 0 && <p className="welcome-lastopen">上次打开 {formatDateTimeInZone(lastOpenedRef.current)}</p>}</div>
    {!nextExam && <div className="welcome-exam-banner is-ended"><div className="welcome-exam-banner__eyebrow">当前状态</div><span className="welcome-exam-banner__icon">✓</span><div className="welcome-exam-banner__info"><strong>暂无进行中的考试</strong><span>可进入管理后台安排下一场考试</span></div><div className="welcome-exam-banner__count"><small>看板状态</small>待安排</div></div>}
    {nextExam && <div className={`welcome-exam-banner ${ongoing ? 'is-ongoing' : 'is-waiting'}`}><div className="welcome-exam-banner__eyebrow">{ongoing ? (examKind(nextExam.exam) === 'weekly' ? '周测进行中' : '正在考试') : (examKind(nextExam.exam) === 'weekly' ? '下一场周测' : '下一场考试')}</div><span className="welcome-exam-banner__icon">{ongoing ? '●' : '→'}</span><div className="welcome-exam-banner__info"><strong>{nextExam.exam.name}</strong><span>{ongoing ? '开始 ' : '开考 '}{formatDateTimeInZone(startMs)}</span></div><div className="welcome-exam-banner__count"><small>{ongoing ? '距结束' : '距开考'}</small>{fmtRemain(countdownMs)}</div></div>}
    {!isInitialized && <div className="welcome-setup-notice"><div><strong>系统尚未初始化</strong><span>首页可以正常查看，完成年级与班级设置后再绑定本机。</span></div><button onClick={() => navigate('/admin')}>开始初始化</button></div>}
    {isInitialized && !isBound && <div className="welcome-setup-notice"><div><strong>本机尚未选择班级</strong><span>选择后只显示该年级、班级适用的考试与周测。</span></div><button onClick={() => setClassPromptOpen(true)}>选择班级</button></div>}
    <div className={`welcome-grid${nextExam ? ' welcome-grid--has-exam' : ''}`}><button className={`welcome-card${nextExam ? ' welcome-card--featured' : ''}`} onClick={enterExam}><span className="welcome-card__icon"><Gauge /></span><span className="welcome-card__text"><span className="welcome-card__label">{ongoing ? '返回考试大屏' : nextExam ? '查看开考倒计时' : '查看考试大屏'}</span><span className="welcome-card__desc">{ongoing ? '正在进行，显示剩余时间' : nextExam ? '下一场考试与开考时间' : !isInitialized ? '先完成初始化设置' : !isBound ? '进入时选择本机班级' : '暂无考试，可先进行安排'}</span></span></button><button className="welcome-card" onClick={() => navigate('/preferences')}><span className="welcome-card__icon"><CalendarDays /></span><span className="welcome-card__text"><span className="welcome-card__label">考试安排预览</span><span className="welcome-card__desc">本班日历与 A4 导出</span></span></button><button className="welcome-card" onClick={() => navigate('/local-settings')}><span className="welcome-card__icon"><MonitorCog /></span><span className="welcome-card__text"><span className="welcome-card__label">本地设置</span><span className="welcome-card__desc">班级、显示与字体</span></span></button><button className="welcome-card" onClick={() => navigate('/admin')}><span className="welcome-card__icon"><LogIn /></span><span className="welcome-card__text"><span className="welcome-card__label">登录管理</span><span className="welcome-card__desc">使用账户进入管理后台</span></span></button></div>
    {pwaAvailable && <div className="welcome-pwa"><span>📲 可添加到设备桌面，便于离线使用</span><button onClick={install}>添加</button><button className="welcome-pwa__dismiss" onClick={dismissPwa}>暂不</button></div>}
    <p className="welcome-idle-hint">{isInitialized && isBound ? <><b>{idleLeft}</b> 秒后自动进入考试大屏</> : '完成初始化并选择班级后启用自动进入大屏'}</p><Watermark />
    {classPromptOpen && <div className="welcome-class-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-class-title"><div className="welcome-class-dialog"><span className="welcome-class-dialog__eyebrow">本机显示范围</span><h2 id="welcome-class-title">选择年级与班级</h2><p>{remoteBinding?.revoked ? '此设备已被管理员删除，请重新绑定。' : '这台设备只显示所选班级的周测和适用考试。'}</p>{classOptionsReady ? <div className="welcome-class-options"><div className="welcome-class-step"><span>1. 选择年级</span><div className="welcome-class-choices" role="listbox" aria-label="选择年级">{grades.map(item => <button type="button" role="option" aria-selected={promptGradeId === item.id} className={promptGradeId === item.id ? 'is-selected' : ''} key={item.id} onClick={() => setPromptGradeId(item.id)}>{item.name}</button>)}</div></div>{promptGradeId && <div className="welcome-class-step"><span>2. 选择班级</span><div className="welcome-class-choices welcome-class-choices--classes" role="listbox" aria-label="选择班级">{sortedClasses(classes, promptGradeId).map(item => <button type="button" role="option" aria-selected="false" key={item.id} onClick={() => chooseClass(item.id)}>{item.name}</button>)}</div></div>}</div> : <div className="welcome-class-loading" role="status"><span />正在同步考试与班级设置…</div>}</div></div>}
  </div>;
}
