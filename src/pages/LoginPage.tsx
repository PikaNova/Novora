import React, { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  getAdminRecoveryStatus,
  getAdminUser,
  getLastAuthApiError,
  guestLogin,
  hasValidLocalToken,
  isLoginRequired,
  loginAdmin,
  logoutAdmin,
  recoverSuperAdminAccount,
  storeAdminSession,
  type AdminUserContext,
} from '../services/examService';
import { getCachedDeviceBinding, getClassBindingInstanceId } from '../services/classBinding';
import { getAppSettings } from '../utils/appSettings';
import { recordUserAction } from '../utils/diagnostics';
import {
  bindEmailConfirm,
  bindEmailRequest,
  fetchEmailConfig,
  fetchEmailSendStatus,
  loginWithEmail,
  sendEmailCode,
  type EmailBindPolicy,
} from '../services/emailAuth';
import { formatApiError } from '../services/apiError';
import { changeOwnCredentials, AdminApiError } from '../services/adminUsers';
import { useRetryCountdown } from '../hooks/useRetryCountdown';
import { computeLockedUntil, formatRetryMessage, loginLockoutRetryAfterMs } from '../utils/retryCountdown';
import Watermark from '../components/Watermark';
import BrandMark from '../components/BrandMark';
import { RecoveryView } from './login/RecoveryView';
import { PasswordUpgradeView } from './login/PasswordUpgradeView';
import Mascot from '../components/Mascot';
import SuperAdminRepairLink from '../components/SuperAdminRepairLink';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { safeLoginDestination } from '../utils/safeNavigation';
import '../styles/login.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const schoolNameForLogin = getAppSettings().exam.initialization.schoolName?.trim() ?? '';
  const handleGuestLogin = async () => {
    const binding = getCachedDeviceBinding();
    if (!binding || binding.revoked || !binding.gradeId || !binding.classId) {
      setError('当前设备未绑定班级，无法使用班级访客登录');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await guestLogin(getClassBindingInstanceId(), binding.gradeId, binding.classId);
      if (!result || !result.token) {
        setError(getLastAuthApiError()?.message ?? '访客登录失败');
        return;
      }
      navigate('/admin', { replace: true });
    } finally {
      setLoading(false);
    }
  };
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
  const [passwordUpgrade, setPasswordUpgrade] = useState<{
    current: string;
    username: string;
    next: string;
    confirm: string;
    token: string;
  } | null>(null);
  const [emailEnabled, setEmailEnabled] = useState<boolean | null>(null);
  const [emailPolicy, setEmailPolicy] = useState<EmailBindPolicy>('optional');
  const [emailView, setEmailView] = useState(true);
  const [emailAddr, setEmailAddr] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailSendUntil, setEmailSendUntil] = useState<number | null>(null);
  const emailSendRemaining = useRetryCountdown(emailSendUntil);
  const [emailLockUntil, setEmailLockUntil] = useState<number | null>(null);
  const emailLockRemaining = useRetryCountdown(emailLockUntil);
  const [bindEmail, setBindEmail] = useState('');
  const [bindCode, setBindCode] = useState('');
  const [bindStatus, setBindStatus] = useState<'idle' | 'requested' | 'bound'>('idle');
  const [bindLoading, setBindLoading] = useState(false);
  const [bindError, setBindError] = useState('');
  const [bindSendUntil, setBindSendUntil] = useState<number | null>(null);
  const bindSendRemaining = useRetryCountdown(bindSendUntil);
  const search = new URLSearchParams(location.search);
  const next = safeLoginDestination(search.get('next'));
  const initializing = search.get('mode') === 'initialize';
  const passwordChanged = search.get('passwordChanged') === '1';
  const deviceRemoved = search.get('deviceRemoved') === '1';

  useEffect(() => {
    isLoginRequired().then((required) => {
      if (!required || hasValidLocalToken()) navigate(next, { replace: true });
      else if (getLastAuthApiError()) setError(formatApiError(getLastAuthApiError(), '无法连接管理服务'));
    });
  }, [navigate, next]);

  useEffect(() => {
    if (lockedUntil && remainingLockSeconds <= 0) setLockedUntil(null);
  }, [lockedUntil, remainingLockSeconds]);

  useEffect(() => {
    if (emailLockUntil && emailLockRemaining <= 0) setEmailLockUntil(null);
  }, [emailLockUntil, emailLockRemaining]);

  useEffect(() => {
    let alive = true;
    fetchEmailConfig()
      .then((config) => {
        if (!alive) return;
        setEmailEnabled(config.enabled);
        setEmailPolicy(config.initBindPolicy);
        setEmailView(config.enabled);
      })
      .catch(() => {
        if (alive) {
          setEmailEnabled(false);
          setEmailView(false);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const pollEmailSendStatus = async (email: string) => {
    const delays = [4000, 8000, 12000];
    for (const delay of delays) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const status = await fetchEmailSendStatus(email);
        if (status.status === 'sent') {
          setNotice('验证码已发送到您的邮箱，5 分钟内有效');
          return;
        }
        if (status.status === 'failed') {
          setEmailSendUntil(null);
          setEmailError(`验证码发送失败：${status.lastError || '邮件服务错误'}，请重新发送`);
          return;
        }
      } catch {
        /* 继续等待下一次轮询 */
      }
    }
  };

  const sendEmailLoginCode = async () => {
    const email = emailAddr.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError('请输入有效的邮箱地址');
      return;
    }
    setEmailLoading(true);
    setEmailError('');
    try {
      const result = await sendEmailCode(email, 'login');
      setEmailSendUntil(Date.now() + 60_000);
      if (result?.queued) {
        setNotice('验证码已加入发送队列，请留意查收（5 分钟内有效）');
        void pollEmailSendStatus(email);
      } else {
        setNotice('验证码已发送到您的邮箱，5 分钟内有效');
      }
    } catch (cause) {
      const retryAfterMs = cause instanceof AdminApiError ? cause.retryAfterMs : undefined;
      if (retryAfterMs != null) {
        setEmailSendUntil(Date.now() + retryAfterMs);
        setEmailError(`发送过于频繁，请 ${Math.ceil(retryAfterMs / 1000)} 秒后再试`);
      } else {
        setEmailError(cause instanceof Error ? cause.message : '验证码发送失败，请稍后重试');
      }
    } finally {
      setEmailLoading(false);
    }
  };

  const submitEmailLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (emailLockUntil && emailLockRemaining > 0) return;
    if (!emailAddr.trim() || !emailCode.trim()) {
      setEmailError('请输入邮箱和验证码');
      return;
    }
    recordUserAction('邮箱验证码登录');
    setEmailLoading(true);
    setEmailError('');
    try {
      const session = await loginWithEmail(emailAddr.trim(), emailCode.trim());
      storeAdminSession(
        session.token || null,
        session.expiresAt,
        session.user as AdminUserContext | null,
        session.firstLogin,
      );
      setNotice('');
      if (session.user?.mustChangePassword) {
        if (!session.token) {
          setEmailError('当前登录未获得有效会话，请刷新后重试');
          return;
        }
        setPasswordUpgrade({
          current: '',
          username: session.user.username || emailAddr.trim(),
          next: '',
          confirm: '',
          token: session.token,
        });
        return;
      }
      navigate(next, { replace: true });
    } catch (cause) {
      const retryAfterMs = cause instanceof AdminApiError ? cause.retryAfterMs : undefined;
      if (cause instanceof AdminApiError && cause.code === 'EMAIL_CODE_LOCKED' && retryAfterMs != null) {
        setEmailLockUntil(Date.now() + retryAfterMs);
        setEmailError(`验证失败次数过多，请 ${Math.ceil(retryAfterMs / 1000)} 秒后再试`);
      } else {
        setEmailError(cause instanceof Error ? cause.message : '验证码登录失败，请重试');
      }
    } finally {
      setEmailLoading(false);
    }
  };

  const sendBindCode = async () => {
    if (!passwordUpgrade) return;
    const email = bindEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setBindError('请输入有效的邮箱地址');
      return;
    }
    setBindLoading(true);
    setBindError('');
    try {
      await bindEmailRequest(email, passwordUpgrade.token);
      setBindSendUntil(Date.now() + 60_000);
      setBindStatus('requested');
    } catch (cause) {
      const retryAfterMs = cause instanceof AdminApiError ? cause.retryAfterMs : undefined;
      if (retryAfterMs != null) {
        setBindSendUntil(Date.now() + retryAfterMs);
        setBindError(`发送过于频繁，请 ${Math.ceil(retryAfterMs / 1000)} 秒后再试`);
      } else {
        setBindError(cause instanceof Error ? cause.message : '验证码发送失败，请稍后重试');
      }
    } finally {
      setBindLoading(false);
    }
  };

  const confirmBind = async () => {
    if (!passwordUpgrade) return;
    const email = bindEmail.trim();
    if (!email || !bindCode.trim()) {
      setBindError('请输入邮箱和验证码');
      return;
    }
    setBindLoading(true);
    setBindError('');
    try {
      await bindEmailConfirm(email, bindCode.trim(), passwordUpgrade.token);
      setBindStatus('bound');
      setBindError('');
    } catch (cause) {
      setBindError(cause instanceof Error ? cause.message : '邮箱绑定失败，请重试');
    } finally {
      setBindLoading(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lockedUntil && remainingLockSeconds > 0) return;
    if (!username.trim() || !password) {
      setError('请输入用户名和密码');
      return;
    }
    recordUserAction('账号密码登录');
    setLoading(true);
    setError('');
    const session = await loginAdmin(username.trim(), password);
    setLoading(false);
    if (!session) {
      const cause = getLastAuthApiError();
      const retryAfterMs = loginLockoutRetryAfterMs(cause);
      if (retryAfterMs !== null) {
        setLockedUntil(computeLockedUntil(retryAfterMs));
        setError('');
        return;
      }
      setLockedUntil(null);
      setError(cause ? formatApiError(cause) : '用户名或密码不正确，请重新输入');
      return;
    }
    setLockedUntil(null);
    if (session.user?.mustChangePassword || password.length < 8) {
      if (!session.token) {
        setError('当前登录未获得有效会话，请刷新后重试');
        return;
      }
      setPasswordUpgrade({
        current: password,
        username: session.user?.username || username.trim(),
        next: '',
        confirm: '',
        token: session.token,
      });
      return;
    }
    navigate(next, { replace: true });
  };

  const upgradePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!passwordUpgrade) return;
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(passwordUpgrade.username.trim())) {
      setError('用户名需为 3-40 位字母、数字、点、横线或下划线');
      return;
    }
    if (
      getAdminUser()?.roleId === 'class_admin' &&
      passwordUpgrade.username.trim().toLowerCase() === getAdminUser()?.username.toLowerCase()
    ) {
      setError('班级管理员首次登录必须设置新的用户名');
      return;
    }
    if (passwordUpgrade.next.length < 8) {
      setError('新密码至少需要 8 位');
      return;
    }
    if (passwordUpgrade.next !== passwordUpgrade.confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    if (emailEnabled === true && emailPolicy === 'force' && bindStatus !== 'bound') {
      setError('当前系统要求初始化时必须先绑定邮箱，请先完成绑定');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const nextUsername = await changeOwnCredentials(
        passwordUpgrade.current,
        passwordUpgrade.username.trim(),
        passwordUpgrade.next,
        passwordUpgrade.token,
      );
      logoutAdmin();
      setUsername(nextUsername);
      setPasswordUpgrade(null);
      setPassword('');
      navigate(`/login?${initializing ? 'mode=initialize&' : ''}next=${encodeURIComponent(next)}`, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账户信息修改失败');
    } finally {
      setLoading(false);
    }
  };

  const openRecovery = async () => {
    setRecoveryView('guide');
    setError('');
    setNotice('');
    setRecoveryConfigured(null);
    try {
      setRecoveryConfigured(await getAdminRecoveryStatus());
    } catch (cause) {
      setRecoveryConfigured(false);
      setError(cause instanceof Error ? cause.message : '无法读取账户恢复配置');
    }
  };

  const recoverAccount = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!recoveryDraft.username.trim() || !recoveryDraft.recoveryKey) {
      setError('请输入超级管理员用户名和恢复密钥');
      return;
    }
    if (recoveryDraft.next.length < 8) {
      setError('新密码至少需要 8 位');
      return;
    }
    if (recoveryDraft.next !== recoveryDraft.confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    setLoading(true);
    try {
      await recoverSuperAdminAccount(recoveryDraft.username.trim(), recoveryDraft.recoveryKey, recoveryDraft.next);
      setUsername(recoveryDraft.username.trim());
      setPassword('');
      setRecoveryView(null);
      setRecoveryDraft({ username: 'admin', recoveryKey: '', next: '', confirm: '' });
      setNotice('超级管理员密码已恢复，旧会话已失效。请使用新密码登录并完成账户信息确认。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账户恢复失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-page__ambient login-page__ambient--one" />
      <div className="login-page__ambient login-page__ambient--two" />
      <section className="login-card" aria-label="考试管理登录">
        <BrandMark className="login-card__brand" />
        <h1 className="login-card__title">
          {initializing ? (
            '系统初始化'
          ) : (
            <>
              {schoolNameForLogin && <span className="login-card__school">{schoolNameForLogin}</span>}
              <span className="login-card__product">考试管理</span>
            </>
          )}
        </h1>
        <p className="login-card__subtitle">
          {initializing ? '验证超级管理员后直接打开初始化向导' : '使用管理员账号登录以继续'}
        </p>
        {recoveryView ? (
          <RecoveryView
            recoveryView={recoveryView}
            recoveryConfigured={recoveryConfigured}
            error={error}
            loading={loading}
            recoveryDraft={recoveryDraft}
            setRecoveryDraft={setRecoveryDraft}
            recoverAccount={recoverAccount}
            setRecoveryView={setRecoveryView}
            setError={setError}
          />
        ) : passwordUpgrade ? (
          <PasswordUpgradeView
            passwordUpgrade={passwordUpgrade}
            setPasswordUpgrade={setPasswordUpgrade}
            error={error}
            setError={setError}
            loading={loading}
            upgradePassword={upgradePassword}
            emailEnabled={emailEnabled}
            emailPolicy={emailPolicy}
            bindStatus={bindStatus}
            bindEmail={bindEmail}
            setBindEmail={setBindEmail}
            bindCode={bindCode}
            setBindCode={setBindCode}
            bindError={bindError}
            setBindError={setBindError}
            bindLoading={bindLoading}
            bindSendRemaining={bindSendRemaining}
            sendBindCode={sendBindCode}
            confirmBind={confirmBind}
          />
        ) : (
          <>
            {!initializing && emailEnabled === true && (
              <div className="login-form__tabs" role="tablist" aria-label="登录方式">
                <button
                  type="button"
                  className={emailView ? 'is-active' : ''}
                  onClick={() => {
                    setEmailView(true);
                    setError('');
                    setEmailError('');
                  }}
                >
                  验证码登录
                </button>
                <button
                  type="button"
                  className={emailView ? '' : 'is-active'}
                  onClick={() => {
                    setEmailView(false);
                    setError('');
                    setEmailError('');
                  }}
                >
                  密码登录
                </button>
              </div>
            )}
            {emailEnabled === true && emailView ? (
              <form className="login-form" onSubmit={submitEmailLogin}>
                <p className="login-form__notice">输入已绑定邮箱，我们会发送 6 位验证码到您的邮箱，5 分钟内有效。</p>
                <label className="login-form__label" htmlFor="email-address">
                  邮箱
                </label>
                <div className={'login-form__field' + (emailError ? ' login-form__field--error' : '')}>
                  <span aria-hidden="true">@</span>
                  <input
                    id="email-address"
                    type="email"
                    autoComplete="email"
                    value={emailAddr}
                    onChange={(e) => {
                      setEmailAddr(e.target.value);
                      setEmailError('');
                    }}
                    placeholder="已绑定的邮箱地址"
                  />
                </div>
                <label className="login-form__label" htmlFor="email-code">
                  验证码
                </label>
                <div className="login-form__code-row">
                  <div className={'login-form__field' + (emailError ? ' login-form__field--error' : '')}>
                    <span aria-hidden="true">#</span>
                    <input
                      id="email-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={emailCode}
                      onChange={(e) => {
                        setEmailCode(e.target.value);
                        setEmailError('');
                      }}
                      placeholder="6 位验证码"
                    />
                  </div>
                  <button
                    type="button"
                    className="login-form__send-code"
                    disabled={emailLoading || emailSendRemaining > 0}
                    onClick={() => void sendEmailLoginCode()}
                  >
                    {emailLoading ? '发送中…' : emailSendRemaining > 0 ? emailSendRemaining + 's' : '发送验证码'}
                  </button>
                </div>
                {emailLockUntil && emailLockRemaining > 0 ? (
                  <p className="login-form__error">{formatRetryMessage(emailLockRemaining, '验证失败次数过多')}</p>
                ) : emailError ? (
                  <p className="login-form__error">{emailError}</p>
                ) : null}
                <button
                  className="login-form__submit"
                  disabled={
                    emailLoading ||
                    !emailAddr.trim() ||
                    !emailCode.trim() ||
                    (!!emailLockUntil && emailLockRemaining > 0)
                  }
                  type="submit"
                >
                  {emailLoading
                    ? '正在登录…'
                    : emailLockUntil && emailLockRemaining > 0
                      ? `请 ${emailLockRemaining} 秒后再试`
                      : '验证并登录'}
                  {!emailLoading && <ArrowRight aria-hidden="true" />}
                </button>
              </form>
            ) : (
              <form className="login-form" onSubmit={submit}>
                {initializing && (
                  <p className="login-form__notice">
                    首次部署请使用用户名 admin 和 Vercel 中设置的 ADMIN_PASSWORD。首次验证会自动创建超级管理员。
                  </p>
                )}
                {deviceRemoved && (
                  <p className="login-form__notice">
                    当前设备已从设备管理中删除，本机登录令牌已失效。请重新登录后绑定或调整设备角色。
                  </p>
                )}
                {(notice || passwordChanged) && (
                  <p className="login-form__success">
                    {notice || '超级管理员密码已修改，旧会话已失效。请使用新密码重新登录。'}
                  </p>
                )}
                <label className="login-form__label" htmlFor="admin-username">
                  {initializing ? '超级管理员用户名' : '用户名'}
                </label>
                <div className={`login-form__field${error ? ' login-form__field--error' : ''}`}>
                  <span aria-hidden="true">@</span>
                  <input
                    id="admin-username"
                    type="text"
                    autoComplete="username"
                    autoFocus
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      setError('');
                    }}
                    placeholder="默认：admin"
                  />
                </div>
                <label className="login-form__label" htmlFor="admin-password">
                  {initializing ? '部署管理员密码' : '管理员密码'}
                </label>
                <div className={`login-form__field${error ? ' login-form__field--error' : ''}`}>
                  <span aria-hidden="true">⌘</span>
                  <input
                    id="admin-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError('');
                    }}
                    placeholder={initializing ? '输入 ADMIN_PASSWORD' : '输入密码'}
                  />
                </div>
                {lockedUntil && remainingLockSeconds > 0 ? (
                  <p className="login-form__error">{formatRetryMessage(remainingLockSeconds, '登录失败次数过多')}</p>
                ) : (
                  error && <p className="login-form__error">{error}</p>
                )}
                <button
                  className="login-form__submit"
                  disabled={loading || (!!lockedUntil && remainingLockSeconds > 0)}
                  type="submit"
                >
                  {loading
                    ? '正在验证…'
                    : lockedUntil && remainingLockSeconds > 0
                      ? `请 ${remainingLockSeconds} 秒后再试`
                      : initializing
                        ? '验证并开始初始化'
                        : '进入管理后台'}{' '}
                  {!loading && <ArrowRight aria-hidden="true" />}
                </button>
              </form>
            )}
            {!initializing && (
              <button className="login-form__link" type="button" onClick={() => void openRecovery()}>
                忘记密码？
              </button>
            )}
            {!initializing && <SuperAdminRepairLink />}
          </>
        )}
        {!initializing && !recoveryView && !passwordUpgrade && (
          <button
            className="login-card__guest"
            type="button"
            disabled={loading}
            onClick={() => void handleGuestLogin()}
          >
            使用班级访客身份查看
          </button>
        )}
        <Link className="login-card__back" to="/">
          <ArrowLeft aria-hidden="true" />
          返回首页
        </Link>
        <Mascot className="login-mascot" size={52} alt="" />
      </section>
      <footer className="login-page__footer">Novora · 考试管理与教室大屏</footer>
      <Watermark />
    </main>
  );
}
