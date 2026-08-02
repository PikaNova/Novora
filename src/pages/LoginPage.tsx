import React, { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getAdminRecoveryStatus, getAdminUser, getLastAuthApiError, hasValidLocalToken, isLoginRequired, loginAdmin, logoutAdmin, recoverSuperAdminAccount } from '../services/examService';
import { ApiError, formatApiError } from '../services/apiError';
import { changeOwnCredentials } from '../services/adminUsers';
import { useRetryCountdown } from '../hooks/useRetryCountdown';
import { computeLockedUntil, formatRetryMessage } from '../utils/retryCountdown';
import Watermark from '../components/Watermark';
import BrandMark from '../components/BrandMark';
import SuperAdminRepairLink from '../components/SuperAdminRepairLink';
import { ArrowLeft, ArrowRight, KeyRound } from 'lucide-react';
import { safeLoginDestination } from '../utils/safeNavigation';
import '../styles/login.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const remainingLockSeconds = useRetryCountdown(lockedUntil);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [recoveryView, setRecoveryView] = useState<'guide' | 'form' | null>(null);
  const [recoveryConfigured, setRecoveryConfigured] = useState<boolean | null>(null);
  const [recoveryDraft, setRecoveryDraft] = useState({ username: 'admin', recoveryKey: '', next: '', confirm: '' });
  const [passwordUpgrade, setPasswordUpgrade] = useState<{ current: string; username: string; next: string; confirm: string; token: string } | null>(null);
  const search = new URLSearchParams(location.search);
  const next = safeLoginDestination(search.get('next'));
  const initializing = search.get('mode') === 'initialize';
  const passwordChanged = search.get('passwordChanged') === '1';
  const deviceRemoved = search.get('deviceRemoved') === '1';

  useEffect(() => {
    isLoginRequired().then(required => {
      if (!required || hasValidLocalToken()) navigate(next, { replace: true });
      else if (getLastAuthApiError()) setError(formatApiError(getLastAuthApiError(), '无法连接管理服务'));
    });
  }, [navigate, next]);

  useEffect(() => {
    if (lockedUntil && remainingLockSeconds <= 0) setLockedUntil(null);
  }, [lockedUntil, remainingLockSeconds]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lockedUntil && remainingLockSeconds > 0) return;
    if (!username.trim() || !password) { setError('请输入用户名和密码'); return; }
    setLoading(true); setError('');
    const session = await loginAdmin(username.trim(), password);
    setLoading(false);
    if (!session) {
      const cause = getLastAuthApiError();
      if (cause instanceof ApiError && cause.code === 'LOGIN_LOCKED' && typeof cause.retryAfterMs === 'number') {
        setLockedUntil(computeLockedUntil(cause.retryAfterMs));
        setError('');
        return;
      }
      setLockedUntil(null);
      setError(cause ? formatApiError(cause) : '用户名或密码不正确，请重新输入');
      return;
    }
    setLockedUntil(null);
    if (session.user?.mustChangePassword || password.length < 8) {
      if (!session.token) { setError('当前登录未获得有效会话，请刷新后重试'); return; }
      setPasswordUpgrade({ current: password, username: session.user?.username || username.trim(), next: '', confirm: '', token: session.token });
      return;
    }
    navigate(next, { replace: true });
  };

  const upgradePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!passwordUpgrade) return;
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(passwordUpgrade.username.trim())) { setError('用户名需为 3-40 位字母、数字、点、横线或下划线'); return; }
    if (getAdminUser()?.roleId === 'class_admin' && passwordUpgrade.username.trim().toLowerCase() === getAdminUser()?.username.toLowerCase()) { setError('班级管理员首次登录必须设置新的用户名'); return; }
    if (passwordUpgrade.next.length < 8) { setError('新密码至少需要 8 位'); return; }
    if (passwordUpgrade.next !== passwordUpgrade.confirm) { setError('两次输入的新密码不一致'); return; }
    setLoading(true); setError('');
    try { const nextUsername = await changeOwnCredentials(passwordUpgrade.current, passwordUpgrade.username.trim(), passwordUpgrade.next, passwordUpgrade.token); logoutAdmin(); setUsername(nextUsername); setPasswordUpgrade(null); setPassword(''); navigate(`/login?${initializing ? 'mode=initialize&' : ''}next=${encodeURIComponent(next)}`, { replace: true }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '账户信息修改失败'); }
    finally { setLoading(false); }
  };

  const openRecovery = async () => {
    setRecoveryView('guide'); setError(''); setNotice(''); setRecoveryConfigured(null);
    try { setRecoveryConfigured(await getAdminRecoveryStatus()); }
    catch (cause) { setRecoveryConfigured(false); setError(cause instanceof Error ? cause.message : '无法读取账户恢复配置'); }
  };

  const recoverAccount = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (!recoveryDraft.username.trim() || !recoveryDraft.recoveryKey) { setError('请输入超级管理员用户名和恢复密钥'); return; }
    if (recoveryDraft.next.length < 8) { setError('新密码至少需要 8 位'); return; }
    if (recoveryDraft.next !== recoveryDraft.confirm) { setError('两次输入的新密码不一致'); return; }
    setLoading(true);
    try {
      await recoverSuperAdminAccount(recoveryDraft.username.trim(), recoveryDraft.recoveryKey, recoveryDraft.next);
      setUsername(recoveryDraft.username.trim()); setPassword(''); setRecoveryView(null);
      setRecoveryDraft({ username: 'admin', recoveryKey: '', next: '', confirm: '' });
      setNotice('超级管理员密码已恢复，旧会话已失效。请使用新密码登录并完成账户信息确认。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '账户恢复失败'); }
    finally { setLoading(false); }
  };

  return (
    <main className="login-page">
      <div className="login-page__ambient login-page__ambient--one" />
      <div className="login-page__ambient login-page__ambient--two" />
      <section className="login-card" aria-label="考试管理登录">
        <BrandMark className="login-card__brand" />
        <h1 className="login-card__title">{initializing ? '系统初始化' : '考试管理'}</h1>
        <p className="login-card__subtitle">{initializing ? '验证超级管理员后直接打开初始化向导' : '使用管理员账号登录以继续'}</p>
        {recoveryView ? <div className="login-recovery">
          {recoveryView === 'guide' ? <>
            <div className="login-recovery__icon"><KeyRound aria-hidden="true" /></div>
            <h2>找回管理员账户</h2>
            <div className="login-recovery__rules"><p><strong>班级管理员</strong><span>联系所属年级管理员或超级管理员重置密码。</span></p><p><strong>年级管理员</strong><span>联系超级管理员重置密码。</span></p><p><strong>超级管理员</strong><span>使用首次初始化时保存的恢复密钥自行恢复。</span></p></div>
            {error && <p className="login-form__error">{error}</p>}
            {recoveryConfigured === null ? <p className="login-form__notice">正在检查恢复配置…</p> : recoveryConfigured ? <button className="login-form__submit" type="button" onClick={() => { setRecoveryView('form'); setError(''); }}>恢复超级管理员</button> : <p className="login-form__notice">当前项目尚未生成恢复密钥。请由超级管理员完成首次初始化并保存系统自动生成的密钥。</p>}
          </> : <form className="login-form" onSubmit={recoverAccount}>
            <p className="login-form__notice">恢复成功后旧登录会话会立即失效；数据库只保存恢复密钥的加盐哈希，不保存明文。</p>
            <label className="login-form__label" htmlFor="recovery-username">超级管理员用户名</label><div className="login-form__field"><span aria-hidden="true">@</span><input id="recovery-username" autoComplete="username" value={recoveryDraft.username} onChange={event => setRecoveryDraft(value => ({ ...value, username: event.target.value }))} /></div>
            <label className="login-form__label" htmlFor="recovery-key">超级管理员恢复密钥</label><div className="login-form__field"><span aria-hidden="true">◆</span><input id="recovery-key" type="password" autoComplete="off" value={recoveryDraft.recoveryKey} onChange={event => setRecoveryDraft(value => ({ ...value, recoveryKey: event.target.value }))} placeholder="初始化时保存的 NVR- 密钥" /></div>
            <label className="login-form__label" htmlFor="recovery-password">新密码</label><div className="login-form__field"><span aria-hidden="true">●</span><input id="recovery-password" type="password" autoComplete="new-password" value={recoveryDraft.next} onChange={event => setRecoveryDraft(value => ({ ...value, next: event.target.value }))} placeholder="至少 8 位" /></div>
            <label className="login-form__label" htmlFor="recovery-confirm">确认新密码</label><div className="login-form__field"><span aria-hidden="true">●</span><input id="recovery-confirm" type="password" autoComplete="new-password" value={recoveryDraft.confirm} onChange={event => setRecoveryDraft(value => ({ ...value, confirm: event.target.value }))} /></div>
            {error && <p className="login-form__error">{error}</p>}<button className="login-form__submit" disabled={loading} type="submit">{loading ? '正在恢复…' : '确认恢复'}</button>
          </form>}
          <button className="login-form__link" type="button" onClick={() => { setRecoveryView(recoveryView === 'form' ? 'guide' : null); setError(''); }}>{recoveryView === 'form' ? '返回找回说明' : '返回登录'}</button>
        </div> : passwordUpgrade ? <form className="login-form" onSubmit={upgradePassword}>
          <p className="login-form__notice">当前使用的是初始账户信息。请设置自己的登录用户名和新密码，保存后重新登录。</p>
          <label className="login-form__label" htmlFor="new-username">新登录用户名</label><div className={`login-form__field${error ? ' login-form__field--error' : ''}`}><span aria-hidden="true">@</span><input id="new-username" type="text" autoComplete="username" value={passwordUpgrade.username} onChange={event => { setPasswordUpgrade(value => value && ({ ...value, username: event.target.value })); setError(''); }} placeholder="3-40 位字母、数字、点、横线或下划线" /></div>
          <label className="login-form__label" htmlFor="new-password">新密码</label><div className={`login-form__field${error ? ' login-form__field--error' : ''}`}><span aria-hidden="true">●</span><input id="new-password" type="password" autoComplete="new-password" value={passwordUpgrade.next} onChange={event => { setPasswordUpgrade(value => value && ({ ...value, next: event.target.value })); setError(''); }} placeholder="至少 8 位" /></div>
          <label className="login-form__label" htmlFor="confirm-password">确认新密码</label><div className={`login-form__field${error ? ' login-form__field--error' : ''}`}><span aria-hidden="true">●</span><input id="confirm-password" type="password" autoComplete="new-password" value={passwordUpgrade.confirm} onChange={event => { setPasswordUpgrade(value => value && ({ ...value, confirm: event.target.value })); setError(''); }} placeholder="再次输入新密码" /></div>
          {error && <p className="login-form__error">{error}</p>}<button className="login-form__submit" disabled={loading} type="submit">{loading ? '正在保存…' : '保存用户名和新密码'}</button>
        </form> : <>
        <form className="login-form" onSubmit={submit}>
          {initializing && <p className="login-form__notice">首次部署请使用用户名 admin 和 Vercel 中设置的 ADMIN_PASSWORD。首次验证会自动创建超级管理员。</p>}
          {deviceRemoved && <p className="login-form__notice">当前设备已从设备管理中删除，本机登录令牌已失效。请重新登录后绑定或调整设备角色。</p>}
          {(notice || passwordChanged) && <p className="login-form__success">{notice || '超级管理员密码已修改，旧会话已失效。请使用新密码重新登录。'}</p>}
          <label className="login-form__label" htmlFor="admin-username">{initializing ? '超级管理员用户名' : '用户名'}</label>
          <div className={`login-form__field${error ? ' login-form__field--error' : ''}`}>
            <span aria-hidden="true">@</span>
            <input id="admin-username" type="text" autoComplete="username" autoFocus
              value={username} onChange={e => { setUsername(e.target.value); setError(''); }}
              placeholder="默认：admin" />
          </div>
          <label className="login-form__label" htmlFor="admin-password">{initializing ? '部署管理员密码' : '管理员密码'}</label>
          <div className={`login-form__field${error ? ' login-form__field--error' : ''}`}>
            <span aria-hidden="true">⌘</span>
            <input id="admin-password" type="password" autoComplete="current-password"
              value={password} onChange={e => { setPassword(e.target.value); setError(''); }}
              placeholder={initializing ? '输入 ADMIN_PASSWORD' : '输入密码'} />
          </div>
          {lockedUntil && remainingLockSeconds > 0 ? (
            <p className="login-form__error">{formatRetryMessage(remainingLockSeconds, '登录失败次数过多')}</p>
          ) : error && <p className="login-form__error">{error}</p>}
          <button className="login-form__submit" disabled={loading || (!!lockedUntil && remainingLockSeconds > 0)} type="submit">
            {loading
              ? '正在验证…'
              : lockedUntil && remainingLockSeconds > 0
                ? `请 ${remainingLockSeconds} 秒后再试`
                : initializing ? '验证并开始初始化' : '进入管理后台'} {!loading && <ArrowRight aria-hidden="true" />}
          </button>
        </form>
        {!initializing && <button className="login-form__link" type="button" onClick={() => void openRecovery()}>忘记密码？</button>}
        {!initializing && <SuperAdminRepairLink />}
        </>}
        <Link className="login-card__back" to="/"><ArrowLeft aria-hidden="true" />返回首页</Link>
      </section>
      <footer className="login-page__footer">Novora · 考试管理与教室大屏</footer>
      <Watermark />
    </main>
  );
}
