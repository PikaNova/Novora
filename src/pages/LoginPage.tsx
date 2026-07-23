import React, { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { hasValidLocalToken, isLoginRequired, loginAdmin } from '../services/examService';
import Watermark from '../components/Watermark';
import '../styles/login.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const next = new URLSearchParams(location.search).get('next') || '/admin';

  useEffect(() => {
    isLoginRequired().then(required => {
      if (!required || hasValidLocalToken()) navigate(next, { replace: true });
    });
  }, [navigate, next]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) { setError('请输入管理员密码'); return; }
    setLoading(true); setError('');
    const ok = await loginAdmin(password);
    setLoading(false);
    if (!ok) { setError('密码不正确，请重新输入'); return; }
    navigate(next, { replace: true });
  };

  return (
    <main className="login-page">
      <div className="login-page__ambient login-page__ambient--one" />
      <div className="login-page__ambient login-page__ambient--two" />
      <section className="login-card" aria-label="考试管理登录">
        <div className="login-card__mark">⌁</div>
        <p className="login-card__eyebrow">EXAM BOARD</p>
        <h1 className="login-card__title">考试管理</h1>
        <p className="login-card__subtitle">请输入管理员密码以继续</p>
        <form className="login-form" onSubmit={submit}>
          <label className="login-form__label" htmlFor="admin-password">管理员密码</label>
          <div className={`login-form__field${error ? ' login-form__field--error' : ''}`}>
            <span aria-hidden="true">⌘</span>
            <input id="admin-password" type="password" autoComplete="current-password" autoFocus
              value={password} onChange={e => { setPassword(e.target.value); setError(''); }}
              placeholder="输入密码" />
          </div>
          {error && <p className="login-form__error">{error}</p>}
          <button className="login-form__submit" disabled={loading} type="submit">
            {loading ? '正在验证…' : '进入管理后台'} <span aria-hidden="true">→</span>
          </button>
        </form>
        <Link className="login-card__back" to="/">← 返回首页</Link>
      </section>
      <footer className="login-page__footer">沉浸式时钟 · Exam Board</footer>
      <Watermark />
    </main>
  );
}
