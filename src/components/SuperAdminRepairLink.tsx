import type { FormEvent } from 'react';
import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { repairSuperAdminAccount } from '../services/examService';

export default function SuperAdminRepairLink() {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('admin');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<'created' | 'repaired' | null>(null);

  const reset = () => {
    setOpen(false);
    setUsername('admin');
    setRecoveryKey('');
    setNext('');
    setConfirm('');
    setError('');
    setLoading(false);
    setResult(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setResult(null);
    if (!username.trim() || !recoveryKey) {
      setError('请输入目标用户名和恢复密钥');
      return;
    }
    if (next.length < 8) {
      setError('新密码至少需要 8 位');
      return;
    }
    if (next !== confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    setLoading(true);
    try {
      const { created } = await repairSuperAdminAccount(username.trim(), recoveryKey, next);
      setResult(created ? 'created' : 'repaired');
      setRecoveryKey('');
      setNext('');
      setConfirm('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '超级管理员账户修复失败');
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="login-form__link" onClick={() => { setOpen(true); setResult(null); setError(''); }}>
        超级管理员权限异常？修复/重建超级管理员
      </button>
    );
  }

  if (result) {
    return (
      <div className="login-recovery">
        <div className="login-recovery__icon"><KeyRound size={20} aria-hidden="true" /></div>
        <h2>{result === 'created' ? '已创建新的超级管理员账号' : '超级管理员账号已修复'}</h2>
        <p className="login-form__success">
          {result === 'created'
            ? '该用户名此前不存在，系统已创建新的超级管理员账号，授权范围为全部年级与班级。'
            : '该账号已被强制设为超级管理员，授权范围已重置为全部年级与班级，密码也已更新。'}
          旧登录会话已全部失效，请使用新密码重新登录。
        </p>
        <button type="button" className="login-form__link" onClick={reset}>返回登录</button>
      </div>
    );
  }

  return (
    <div className="login-recovery">
      <div className="login-recovery__icon"><KeyRound size={20} aria-hidden="true" /></div>
      <h2>修复/重建超级管理员账号</h2>
      <p className="login-form__notice">
        适用于账号角色或授权范围损坏，导致超级管理员仍提示“权限不足”的情况。此操作需要初始化时保存的恢复密钥；
        若用户名已存在，会将该账号修复为超级管理员并重置授权范围，若不存在则创建新账号。
      </p>
      <p className="login-form__notice">
        安全提醒：恢复密钥等同于最高权限凭据。知道恢复密钥的人可以把指定用户名修复或创建为拥有全校权限的超级管理员；
        请只在确认当前项目确实无法正常使用超级管理员账号时操作，并在修复后检查审计日志。
      </p>
      <form className="login-form" onSubmit={submit}>
        <label className="login-form__label" htmlFor="repair-username">目标用户名</label>
        <div className="login-form__field">
          <span aria-hidden="true">@</span>
          <input id="repair-username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} placeholder="默认：admin" />
        </div>
        <label className="login-form__label" htmlFor="repair-key">超级管理员恢复密钥</label>
        <div className="login-form__field">
          <span aria-hidden="true">◆</span>
          <input id="repair-key" type="password" autoComplete="off" value={recoveryKey} onChange={event => setRecoveryKey(event.target.value)} placeholder="初始化时保存的 NVR- 密钥" />
        </div>
        <label className="login-form__label" htmlFor="repair-password">新密码</label>
        <div className="login-form__field">
          <span aria-hidden="true">●</span>
          <input id="repair-password" type="password" autoComplete="new-password" value={next} onChange={event => setNext(event.target.value)} placeholder="至少 8 位" />
        </div>
        <label className="login-form__label" htmlFor="repair-confirm">确认新密码</label>
        <div className="login-form__field">
          <span aria-hidden="true">●</span>
          <input id="repair-confirm" type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} />
        </div>
        {error && <p className="login-form__error">{error}</p>}
        <button type="submit" className="login-form__submit" disabled={loading}>{loading ? '正在处理…' : '确认修复/创建'}</button>
      </form>
      <button type="button" className="login-form__link" onClick={reset}>返回登录</button>
    </div>
  );
}
