import React, { useEffect, useMemo, useState } from 'react';
import type { SchoolClass, SchoolGrade } from '../types/school';
import { adminCan, getAdminUser, type AdminScope } from '../services/examService';
import {
  deleteManagedRole,
  fetchAuditLogs,
  fetchUserManagement,
  resetManagedUserPassword,
  saveManagedRole,
  saveManagedUser,
  type AuditLog,
  type ManagedRole,
  type ManagedUser,
} from '../services/adminUsers';

type Props = { grades: SchoolGrade[]; classes: SchoolClass[] };
type Section = 'users' | 'roles' | 'audit';
type UserDraft = { id?: number; username: string; displayName: string; password: string; roleId: string; status: 'active' | 'disabled'; allScope: boolean; gradeIds: string[]; classIds: string[] };
type RoleDraft = { id?: string; name: string; description: string; permissions: string[] };

const PERMISSION_GROUPS: Array<{ prefix: string; label: string }> = [
  { prefix: 'overview.', label: '概览' }, { prefix: 'major.', label: '大型考试' }, { prefix: 'weekly.', label: '周测' },
  { prefix: 'school.', label: '年级与班级' }, { prefix: 'device.', label: '设备' }, { prefix: 'schedule.', label: '调度规则' },
  { prefix: 'alerts.', label: '提醒' }, { prefix: 'settings.', label: '设置' }, { prefix: 'initialization.', label: '初始化' },
  { prefix: 'demo_', label: '演示数据' }, { prefix: 'user.', label: '用户' }, { prefix: 'role.', label: '角色' },
  { prefix: 'audit.', label: '日志' }, { prefix: 'deployment.', label: '部署' },
];

const ACTION_LABEL: Record<string, string> = {
  'auth.login': '登录后台', 'user.create': '创建用户', 'user.update': '修改用户', 'user.password.reset': '重置密码',
  'user.password.change': '修改自己的密码', 'role.create': '创建角色', 'role.update': '修改角色', 'role.delete': '删除角色',
  'exam-data.update': '修改考试数据', 'device.revoke': '删除设备绑定',
};
const fmt = (value?: number | null) => value ? new Date(Number(value)).toLocaleString('zh-CN', { hour12: false }) : '从未登录';

function scopeText(user: ManagedUser, grades: SchoolGrade[], classes: SchoolClass[]) {
  if (user.scopes.some(scope => scope.type === 'all')) return '全校';
  const names = user.scopes.map(scope => scope.type === 'grade'
    ? grades.find(item => item.id === scope.gradeId)?.name
    : `${grades.find(item => item.id === scope.gradeId)?.name ?? '未知年级'} · ${classes.find(item => item.id === scope.classId)?.name ?? '未知班级'}`);
  return names.filter(Boolean).join('、') || '未分配范围';
}

function draftScopes(draft: UserDraft, classes: SchoolClass[]): AdminScope[] {
  if (draft.allScope) return [{ type: 'all', gradeId: '', classId: '' }];
  return [
    ...draft.gradeIds.map(gradeId => ({ type: 'grade' as const, gradeId, classId: '' })),
    ...draft.classIds.map(classId => ({ type: 'class' as const, gradeId: classes.find(item => item.id === classId)?.gradeId ?? '', classId })),
  ];
}

export default function UserManagementPanel({ grades, classes }: Props) {
  const current = getAdminUser();
  const canCreateUser = adminCan('user.create', current);
  const canEditUser = adminCan('user.edit', current);
  const canResetPassword = adminCan('user.reset_password', current);
  const canManageRoles = adminCan('role.manage', current);
  const canReadAudit = adminCan('audit.read', current);
  const [section, setSection] = useState<Section>('users');
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<ManagedRole[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [userDraft, setUserDraft] = useState<UserDraft | null>(null);
  const [roleDraft, setRoleDraft] = useState<RoleDraft | null>(null);
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const load = async () => {
    setLoading(true); setMessage('');
    try { const data = await fetchUserManagement(); setUsers(data.users); setRoles(data.roles); setPermissions(data.permissions); }
    catch (error) { setMessage(error instanceof Error ? error.message : '用户数据加载失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (section !== 'audit') return;
    fetchAuditLogs().then(setLogs).catch(error => setMessage(error instanceof Error ? error.message : '日志加载失败'));
  }, [section]);

  const groupedPermissions = useMemo(() => PERMISSION_GROUPS.map(group => ({ ...group, items: permissions.filter(item => item.startsWith(group.prefix)) })).filter(group => group.items.length), [permissions]);
  const beginCreateUser = () => setUserDraft({ username: '', displayName: '', password: '', roleId: roles.find(role => role.id === 'viewer')?.id ?? roles[0]?.id ?? '', status: 'active', allScope: false, gradeIds: [], classIds: [] });
  const beginEditUser = (user: ManagedUser) => setUserDraft({ id: user.id, username: user.username, displayName: user.displayName, password: '', roleId: user.roleId, status: user.status, allScope: user.scopes.some(scope => scope.type === 'all'), gradeIds: user.scopes.filter(scope => scope.type === 'grade').map(scope => scope.gradeId), classIds: user.scopes.filter(scope => scope.type === 'class').map(scope => scope.classId) });
  const submitUser = async () => {
    if (!userDraft) return;
    setBusy(true); setMessage('');
    try {
      const next = await saveManagedUser({ action: userDraft.id ? 'update' : 'create', id: userDraft.id, username: userDraft.username, displayName: userDraft.displayName, password: userDraft.password, roleId: userDraft.roleId, status: userDraft.status, scopes: draftScopes(userDraft, classes) });
      setUsers(next); setUserDraft(null); setMessage(userDraft.id ? '用户权限已更新，原登录会话已失效。' : '用户已创建，首次登录必须修改密码。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const submitRole = async () => {
    if (!roleDraft) return;
    setBusy(true); setMessage('');
    try { setRoles(await saveManagedRole(roleDraft)); setRoleDraft(null); setMessage('角色权限已保存。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '角色保存失败'); }
    finally { setBusy(false); }
  };
  const submitReset = async () => {
    if (!resetTarget || resetPassword.length < 8) { setMessage('新密码至少需要 8 位'); return; }
    setBusy(true);
    try { await resetManagedUserPassword(resetTarget.id, resetPassword); setResetTarget(null); setResetPassword(''); setMessage('密码已重置，该用户需要重新登录并修改密码。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '重置失败'); }
    finally { setBusy(false); }
  };

  return <main className="user-management">
    <div className="device-status__heading"><div><h2>用户与权限</h2><p>为不同管理员分配可编辑内容和年级、班级范围。所有限制均由服务端再次校验。</p></div>{section === 'users' && canCreateUser && <button className="admin-btn admin-btn--primary" onClick={beginCreateUser}>添加用户</button>}{section === 'roles' && canManageRoles && <button className="admin-btn admin-btn--primary" onClick={() => setRoleDraft({ name: '', description: '', permissions: [] })}>新建角色</button>}</div>
    <div className="user-management__tabs"><button className={section === 'users' ? 'is-active' : ''} onClick={() => setSection('users')}>管理员</button>{canManageRoles && <button className={section === 'roles' ? 'is-active' : ''} onClick={() => setSection('roles')}>角色权限</button>}{canReadAudit && <button className={section === 'audit' ? 'is-active' : ''} onClick={() => setSection('audit')}>操作日志</button>}</div>
    {message && <div className="admin-info-banner">{message}</div>}
    {loading ? <div className="admin-loading">正在读取用户权限…</div> : section === 'users' ? <>
      <div className="device-status__stats"><div><span>管理员总数</span><strong>{users.length}</strong></div><div><span>当前启用</span><strong>{users.filter(user => user.status === 'active').length}</strong></div><div><span>自定义角色</span><strong>{roles.filter(role => !role.builtIn).length}</strong></div><div><span>需修改密码</span><strong>{users.filter(user => user.mustChangePassword).length}</strong></div></div>
      <div className="user-management__list">{users.map(user => <article className={`user-management__row${user.status === 'disabled' ? ' is-disabled' : ''}`} key={user.id}><div className="user-management__identity"><strong>{user.displayName}</strong><code>@{user.username}</code></div><div><span className="user-management__role">{user.roleName}</span><small>{scopeText(user, grades, classes)}</small></div><div><small>{user.status === 'active' ? '已启用' : '已停用'} · {fmt(user.lastLoginAt)}</small>{user.mustChangePassword && <em>首次登录需改密码</em>}</div>{(canEditUser || canResetPassword) && <div className="user-management__actions">{canEditUser && <button className="admin-btn" onClick={() => beginEditUser(user)}>编辑</button>}{canResetPassword && <button className="admin-btn" onClick={() => { setResetTarget(user); setResetPassword(''); }}>重置密码</button>}</div>}</article>)}</div>
    </> : section === 'roles' ? <div className="user-management__role-list">{roles.map(role => <article className="user-management__role-row" key={role.id}><div><strong>{role.name}</strong>{role.builtIn && <span>内置</span>}<p>{role.description || `${role.permissions.length} 项权限`}</p></div><div className="user-management__permission-summary">{role.permissions.includes('*') ? '全部权限' : `${role.permissions.length} 项权限`}</div>{!role.builtIn && <div className="user-management__actions"><button className="admin-btn" onClick={() => setRoleDraft({ id: role.id, name: role.name, description: role.description, permissions: role.permissions })}>编辑</button><button className="admin-btn admin-btn--danger" onClick={async () => { if (!window.confirm(`删除角色“${role.name}”？`)) return; try { setRoles(await deleteManagedRole(role.id)); } catch (error) { setMessage(error instanceof Error ? error.message : '删除失败'); } }}>删除</button></div>}</article>)}</div> : <div className="user-management__audit">{logs.length ? logs.map(log => <div className="user-management__audit-row" key={log.id}><time>{fmt(log.createdAt)}</time><strong>{log.username || '系统'}</strong><span>{ACTION_LABEL[log.action] || log.action}</span><code>{log.resourceId || log.resourceType}</code></div>) : <div className="admin-empty"><p>暂无操作记录</p></div>}</div>}

    {userDraft && <div className="admin-modal-overlay"><div className="admin-modal admin-modal--wide" onClick={event => event.stopPropagation()}><h2 className="admin-modal__title">{userDraft.id ? '编辑管理员' : '添加管理员'}</h2><div className="user-editor__grid"><label className="admin-label">用户名<input className="admin-input" disabled={!!userDraft.id} value={userDraft.username} onChange={event => setUserDraft(current => current && { ...current, username: event.target.value })} placeholder="如：grade3_admin" /></label><label className="admin-label">显示名称<input className="admin-input" value={userDraft.displayName} onChange={event => setUserDraft(current => current && { ...current, displayName: event.target.value })} placeholder="如：高三教务" /></label>{!userDraft.id && <label className="admin-label">初始密码<input className="admin-input" type="password" value={userDraft.password} onChange={event => setUserDraft(current => current && { ...current, password: event.target.value })} placeholder="至少 8 位" /></label>}<label className="admin-label">角色<select className="admin-input" value={userDraft.roleId} onChange={event => setUserDraft(current => current && { ...current, roleId: event.target.value })}>{roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>{userDraft.id && <label className="admin-label">状态<select className="admin-input" value={userDraft.status} onChange={event => setUserDraft(current => current && { ...current, status: event.target.value as UserDraft['status'] })}><option value="active">启用</option><option value="disabled">停用</option></select></label>}</div><div className="user-editor__scope"><label className="admin-toggle-label"><input type="checkbox" checked={userDraft.allScope || userDraft.roleId === 'super_admin'} disabled={userDraft.roleId === 'super_admin'} onChange={event => setUserDraft(current => current && { ...current, allScope: event.target.checked })} />管理全校数据</label>{!userDraft.allScope && userDraft.roleId !== 'super_admin' && <><h3>可管理年级</h3><div className="admin-major-targets">{grades.map(grade => <label key={grade.id}><input type="checkbox" checked={userDraft.gradeIds.includes(grade.id)} onChange={event => setUserDraft(current => current && { ...current, gradeIds: event.target.checked ? [...current.gradeIds, grade.id] : current.gradeIds.filter(id => id !== grade.id) })} />{grade.name}</label>)}</div><h3>额外指定班级</h3><div className="admin-major-targets">{classes.map(item => <label key={item.id}><input type="checkbox" checked={userDraft.classIds.includes(item.id)} onChange={event => setUserDraft(current => current && { ...current, classIds: event.target.checked ? [...current.classIds, item.id] : current.classIds.filter(id => id !== item.id) })} />{grades.find(grade => grade.id === item.gradeId)?.name} · {item.name}</label>)}</div></>}</div><div className="admin-modal__actions"><button className="admin-btn admin-btn--primary" disabled={busy} onClick={() => void submitUser()}>{busy ? '保存中…' : '保存'}</button><button className="admin-btn" onClick={() => setUserDraft(null)}>取消</button></div></div></div>}
    {roleDraft && <div className="admin-modal-overlay"><div className="admin-modal admin-modal--wide" onClick={event => event.stopPropagation()}><h2 className="admin-modal__title">{roleDraft.id ? '编辑自定义角色' : '新建自定义角色'}</h2><label className="admin-label">角色名称<input className="admin-input" value={roleDraft.name} onChange={event => setRoleDraft(current => current && { ...current, name: event.target.value })} /></label><label className="admin-label">说明<input className="admin-input" value={roleDraft.description} onChange={event => setRoleDraft(current => current && { ...current, description: event.target.value })} /></label><div className="role-editor__groups">{groupedPermissions.map(group => <section key={group.prefix}><div><strong>{group.label}</strong><button type="button" onClick={() => setRoleDraft(current => current && ({ ...current, permissions: group.items.every(item => current.permissions.includes(item)) ? current.permissions.filter(item => !group.items.includes(item)) : [...new Set([...current.permissions, ...group.items])] }))}>{group.items.every(item => roleDraft.permissions.includes(item)) ? '取消全选' : '全选'}</button></div>{group.items.map(permission => <label key={permission}><input type="checkbox" checked={roleDraft.permissions.includes(permission)} onChange={event => setRoleDraft(current => current && ({ ...current, permissions: event.target.checked ? [...current.permissions, permission] : current.permissions.filter(item => item !== permission) }))} />{permission}</label>)}</section>)}</div><div className="admin-modal__actions"><button className="admin-btn admin-btn--primary" disabled={busy} onClick={() => void submitRole()}>{busy ? '保存中…' : '保存角色'}</button><button className="admin-btn" onClick={() => setRoleDraft(null)}>取消</button></div></div></div>}
    {resetTarget && <div className="admin-modal-overlay"><div className="admin-modal" onClick={event => event.stopPropagation()}><h2 className="admin-modal__title">重置 {resetTarget.displayName} 的密码</h2><p className="admin-modal__body">重置后该用户当前登录立即失效，下次登录必须再次修改密码。</p><input className="admin-input" type="password" value={resetPassword} onChange={event => setResetPassword(event.target.value)} placeholder="新密码，至少 8 位" /><div className="admin-modal__actions"><button className="admin-btn admin-btn--primary" disabled={busy} onClick={() => void submitReset()}>确认重置</button><button className="admin-btn" onClick={() => setResetTarget(null)}>取消</button></div></div></div>}
  </main>;
}
