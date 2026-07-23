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
import { fetchBoundClassTag, hasConfirmedClassChoice, markClassChoiceConfirmed, saveBoundClassTag } from '../services/classBinding';
import { collectClassTags } from '../utils/classSettings';
import { useExamSync } from '../hooks/useExamSync';
import '../styles/welcome.css';

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
  const { syncState } = useExamSync();
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
  const [classPromptOpen, setClassPromptOpen] = useState(() => !hasConfirmedClassChoice());
  const [remoteClassTag, setRemoteClassTag] = useState<string | null | undefined>(undefined);
  const [classTags, setClassTags] = useState<string[]>(() => { const exam = getAppSettings().exam; return collectClassTags(exam.weeklyPlans, exam.majors); });
  const deadline = useRef(Date.now() + IDLE_MS);
  const resetIdle = () => { deadline.current = Date.now() + IDLE_MS; setIdleLeft(10); };

  useEffect(() => { const update = () => { const t = nowMs(); const exam = getAppSettings().exam; setNow(t); setNextExam(getNextExam(getResolvedExamItems(t), t)); setClassTags(collectClassTags(exam.weeklyPlans, exam.majors)); }; const onStorage = (event: StorageEvent) => { if (event.key === APP_SETTINGS_KEY) update(); }; update(); const id = window.setInterval(update, 1000); window.addEventListener(APP_SETTINGS_CHANGED_EVENT, update); window.addEventListener('storage', onStorage); window.addEventListener('focus', update); window.addEventListener('pageshow', update); return () => { clearInterval(id); window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, update); window.removeEventListener('storage', onStorage); window.removeEventListener('focus', update); window.removeEventListener('pageshow', update); }; }, []);
  useEffect(() => { let cancelled = false; void (async () => { if (hasConfirmedClassChoice()) return; const remote = await fetchBoundClassTag(); if (cancelled || hasConfirmedClassChoice()) return; setRemoteClassTag(remote); })(); return () => { cancelled = true; }; }, []);
  useEffect(() => { if (remoteClassTag === undefined || hasConfirmedClassChoice()) return; if (remoteClassTag === '' || (remoteClassTag !== null && classTags.includes(remoteClassTag))) { updateExamSettings({ selectedClassTag: remoteClassTag }); markClassChoiceConfirmed(); setClassPromptOpen(false); } }, [remoteClassTag, classTags]);
  useEffect(() => { const tick = () => { if (classPromptOpen) { resetIdle(); return; } const left = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)); setIdleLeft(left); if (left <= 0) navigate('/exam'); }; const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'click']; events.forEach(e => window.addEventListener(e, resetIdle, { passive: true })); tick(); const id = window.setInterval(tick, 250); return () => { clearInterval(id); events.forEach(e => window.removeEventListener(e, resetIdle)); }; }, [navigate, classPromptOpen]);
  useEffect(() => { const refresh = () => { const dismissed = Number(localStorage.getItem(PWA_DISMISS_KEY) ?? 0); setPwaAvailable(!nextExam && !isStandalonePwa() && canInstallPwa() && Date.now() - dismissed > 7 * 86400000); }; refresh(); window.addEventListener('pwa:available', refresh); return () => window.removeEventListener('pwa:available', refresh); }, [nextExam]);
  const install = async () => { resetIdle(); const installed = await promptInstallPwa(); if (installed) setPwaAvailable(false); };
  const dismissPwa = () => { localStorage.setItem(PWA_DISMISS_KEY, String(Date.now())); setPwaAvailable(false); resetIdle(); };
  const chooseClass = (classTag: string) => { updateExamSettings({ selectedClassTag: classTag }); void saveBoundClassTag(classTag); setClassPromptOpen(false); resetIdle(); };
  const ongoing = nextExam?.phase === 'ongoing'; const startMs = nextExam ? parseZonedTime(nextExam.exam.startTime) : NaN; const endMs = nextExam ? parseZonedTime(nextExam.exam.endTime) : NaN; const countdownMs = nextExam ? (ongoing ? endMs - now : startMs - now) : 0;
  const currentClass = getAppSettings().exam.selectedClassTag;
  const classOptionsReady = classTags.length > 0 || (remoteClassTag !== undefined && syncState !== 'local' && syncState !== 'syncing');
  return <div className="welcome-page"><div className="welcome-header"><p className="welcome-kicker">EXAM BOARD · LOCAL FIRST</p><h1 className="welcome-title">考试看板</h1><p className="welcome-subtitle">{currentClass ? `${currentClass} · ` : ''}{getAppSettings().exam.title} · {new Date(now).toLocaleTimeString('zh-CN', { hour12: false })}</p>{lastOpenedRef.current > 0 && <p className="welcome-lastopen">上次打开 {formatDateTimeInZone(lastOpenedRef.current)}</p>}</div>
    {!nextExam && <div className="welcome-exam-banner is-ended"><div className="welcome-exam-banner__eyebrow">当前状态</div><span className="welcome-exam-banner__icon">✓</span><div className="welcome-exam-banner__info"><strong>暂无进行中的考试</strong><span>可进入管理后台安排下一场考试</span></div><div className="welcome-exam-banner__count"><small>看板状态</small>待安排</div></div>}
    {nextExam && <div className={`welcome-exam-banner ${ongoing ? 'is-ongoing' : 'is-waiting'}`}><div className="welcome-exam-banner__eyebrow">{ongoing ? (examKind(nextExam.exam) === 'weekly' ? '周测进行中' : '正在考试') : (examKind(nextExam.exam) === 'weekly' ? '下一场周测' : '下一场考试')}</div><span className="welcome-exam-banner__icon">{ongoing ? '●' : '→'}</span><div className="welcome-exam-banner__info"><strong>{nextExam.exam.name}</strong><span>{ongoing ? '开始 ' : '开考 '}{formatDateTimeInZone(startMs)}</span></div><div className="welcome-exam-banner__count"><small>{ongoing ? '距结束' : '距开考'}</small>{fmtRemain(countdownMs)}</div></div>}
    <div className={`welcome-grid${nextExam ? ' welcome-grid--has-exam' : ''}`}><button className={`welcome-card${nextExam ? ' welcome-card--featured' : ''}`} onClick={() => navigate('/exam')}><span className="welcome-card__icon">📊</span><span className="welcome-card__text"><span className="welcome-card__label">{ongoing ? '返回考试大屏' : nextExam ? '查看开考倒计时' : '查看考试大屏'}</span><span className="welcome-card__desc">{ongoing ? '正在进行，显示剩余时间' : nextExam ? '下一场考试与开考时间' : '暂无考试，可先进行安排'}</span></span></button><button className="welcome-card" onClick={() => navigate('/preferences')}><span className="welcome-card__icon">Aa</span><span className="welcome-card__text"><span className="welcome-card__label">偏好设置</span><span className="welcome-card__desc">显示、字体与班级选择</span></span></button><button className="welcome-card" onClick={() => navigate('/admin')}><span className="welcome-card__icon">⚙️</span><span className="welcome-card__text"><span className="welcome-card__label">管理后台</span><span className="welcome-card__desc">配置考试安排</span></span></button></div>
    {pwaAvailable && <div className="welcome-pwa"><span>📲 可添加到设备桌面，便于离线使用</span><button onClick={install}>添加</button><button className="welcome-pwa__dismiss" onClick={dismissPwa}>暂不</button></div>}
    <p className="welcome-idle-hint"><b>{idleLeft}</b> 秒后自动进入考试大屏</p><Watermark />
    {classPromptOpen && <div className="welcome-class-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-class-title"><div className="welcome-class-dialog"><span className="welcome-class-dialog__eyebrow">本机显示范围</span><h2 id="welcome-class-title">选择当前班级</h2><p>这台设备只显示所选班级的周测和适用考试，之后可在“偏好设置”中切换。</p>{classOptionsReady ? <div className="welcome-class-options">{classTags.map(tag => <button key={tag} onClick={() => chooseClass(tag)}>{tag}</button>)}<button className="is-general" onClick={() => chooseClass('')}>通用 / 未分组</button></div> : <div className="welcome-class-loading" role="status"><span />正在同步考试与班级设置…</div>}</div></div>}
  </div>;
}
