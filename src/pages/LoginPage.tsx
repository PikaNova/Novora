import React, { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getAdminUser, hasValidLocalToken, isLoginRequired, loginAdmin, logoutAdmin } from '../services/examService';
import { changeOwnPassword } from '../services/adminUsers';
import Watermark from '../components/Watermark';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import '../styles/login.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [passwordUpgrade, setPasswordUpgrade] = useState<{ current: string; next: string; confirm: string } | null>(null);
  const next = new URLSearchParams(location.search).get('next') || '/admin';

  useEffect(() => {
    isLoginRequired().then(required => {
      if (!required || hasValidLocalToken()) navigate(next, { replace: true });
    });
  }, [navigate, next]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) { setError('请输入用户名和密码'); return; }
    setLoading(true); setError('');
    const ok = await loginAdmin(username.trim(), password);
    setLoading(false);
    if (!ok) { setError('用户名或密码不正确，请重新输入'); return; }
    if (getAdminUser()?.mustChangePassword || password.length < 8) { setPasswordUpgrade({ current: password, next: '', confirm: '' }); return; }
    navigate(next, { replace: true });
  };

  const upgradePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!passwordUpgrade) return;
    if (passwordUpgrade.next.length < 8) { setError('新密码至少需要 8 位'); return; }
    if (passwordUpgrade.next !== passwordUpgrade.confirm) { setError('两次输入的新密码不一致'); return; }
    setLoading(true); setError('');
    try { await changeOwnPassword(passwordUpgrade.current, passwordUpgrade.next); logoutAdmin(); navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true }); setPasswordUpgrade(null); setPassword(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '密码修改失败'); }
    finally { setLoading(false); }
  };

  return (
    <main className="login-page">
      <div className="login-page__ambient login-page__ambient--one" />
      <div className="login-page__ambient login-page__ambient--two" />
      <section className="login-card" aria-label="考试管理登录">
        <div className="login-card__mark">⌁</div>
        <p className="login-card__eyebrow">EXAM BOARD</p>
        <h1 className="login-card__title">考试管理</h1>
        <p className="login-card__subtitle">使用管理员账号登录以继续</p>
        {passwordUpgrade ? <form className="login-form" onSubmit={upgradePassword}>
          <p className="login-form__notice">当前密码不足 8 位或属于初始密码，请先设置新密码再进入后台。</p>
          <label className="login-form__label" htmlFor="new-password">新密码</label><div className={`login-form__field${error ? ' login-form__field--error' : ''}`}><span aria-hidden="true">●</span><input id="new-password" type="password" autoComplete="new-password" value={passwordUpgrade.next} onChange={event => { setPasswordUpgrade(value => value && ({ ...value, next: event.target.value })); setError(''); }} placeholder="至少 8 位" /></div>
          <label className="login-form__label" htmlFor="confirm-password">确认新密码</label><div className={`login-form__field${error ? ' login-form__field--error' : ''}`}><span aria-hidden="true">●</span><input id="confirm-password" type="password" autoComplete="new-password" value={passwordUpgrade.confirm} onChange={event => { setPasswordUpgrade(value => value && ({ ...value, confirm: event.target.value })); setError(''); }} placeholder="再次输入新密码" /></div>
          {error && <p className="login-form__error">{error}</p>}<button className="login-form__submit" disabled={loading} type="submit">{loading ? '正在保存…' : '保存新密码'}</button>
        </form> : <form className="login-form" onSubmit={submit}>
          <label className="login-form__label" htmlFor="admin-username">用户名</label>
          <div className={`login-form__field${error ? ' login-form__field--error' : ''}`}>
            <span aria-hidden="true">@</span>
            <input id="admin-username" type="text" autoComplete="username" autoFocus
              value={username} onChange={e => { setUsername(e.target.value); setError(''); }}
              placeholder="默认：admin" />
          </div>
          <label className="login-form__label" htmlFor="admin-password">管理员密码</label>
          <div className={`login-form__field${error ? ' login-form__field--error' : ''}`}>
            <span aria-hidden="true">⌘</span>
            <input id="admin-password" type="password" autoComplete="current-password"
              value={password} onChange={e => { setPassword(e.target.value); setError(''); }}
              placeholder="输入密码" />
          </div>
          {error && <p className="login-form__error">{error}</p>}
          <button className="login-form__submit" disabled={loading} type="submit">
            {loading ? '正在验证…' : '进入管理后台'} {!loading && <ArrowRight aria-hidden="true" />}
          </button>
        </form>}
        <Link className="login-card__back" to="/"><ArrowLeft aria-hidden="true" />返回首页</Link>
      </section>
      <footer className="login-page__footer">沉浸式时钟 · Exam Board</footer>
      <Watermark />
    </main>
  );
}
