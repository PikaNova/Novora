import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SchoolClass, SchoolGrade } from '../types/school';
import { adminCan, getAdminUser, logoutAdmin, type AdminScope, type AdminUserContext } from '../services/examService';
import {
  changeOwnPassword,
  changeOwnUsername,
  deleteManagedRole,
  fetchAuditLogs,
  fetchUserManagement,
  resetManagedUserPassword,
  saveManagedRole,
  saveManagedUser,
  type AuditLog,
  type ManagedRole,
  type ManagedUser,
  AdminApiError,
} from '../services/adminUsers';

type Props = { grades: SchoolGrade[]; classes: SchoolClass[]; currentUser?: AdminUserContext | null; forcePasswordChange?: boolean };
type Section = 'users' | 'roles' | 'audit';
type UserDraft = { id?: number; username: string; displayName: string; password: string; roleId: string; status: 'active' | 'disabled'; allScope: boolean; gradeIds: string[]; classIds: string[] };
type RoleDraft = { id?: string; name: string; description: string; permissions: string[] };
type PasswordDraft = { current: string; next: string; confirm: string };
type RoleLevel = 'none' | 'read' | 'manage';

const ROLE_MODULES: Array<{ id: string; label: string; read: string[]; manage: string[] }> = [
  { id: 'overview', label: '运行总览', read: ['overview.read'], manage: [] },
  { id: 'major', label: '大型考试', read: ['major.read', 'major.export'], manage: ['major.create', 'major.edit', 'major.delete', 'major.import'] },
  { id: 'weekly', label: '周测排班', read: ['weekly.read', 'weekly.export'], manage: ['weekly.create', 'weekly.edit', 'weekly.delete', 'weekly.copy', 'weekly.override', 'weekly.import'] },
  { id: 'school', label: '年级与班级', read: ['school.read'], manage: ['school.grade_manage', 'school.class_manage'] },
  { id: 'device', label: '设备管理', read: ['device.read'], manage: ['device.bind', 'device.revoke'] },
  { id: 'calendar', label: '提醒与校历', read: ['alerts.read'], manage: ['alerts.edit', 'schedule.mode_edit', 'schedule.conflict_edit', 'schedule.term_edit', 'schedule.ab_week_edit', 'schedule.holiday_edit'] },
];

const moduleLevel = (permissions: string[], module: typeof ROLE_MODULES[number]): RoleLevel => module.manage.some(item => permissions.includes(item)) ? 'manage' : module.read.some(item => permissions.includes(item)) ? 'read' : 'none';

const PERMISSION_GROUPS: Array<{ prefix: string; label: string }> = [
  { prefix: 'overview.', label: '概览' }, { prefix: 'major.', label: '大型考试' }, { prefix: 'weekly.', label: '周测' },
  { prefix: 'school.', label: '年级与班级' }, { prefix: 'device.', label: '设备' }, { prefix: 'schedule.', label: '调度规则' },
  { prefix: 'alerts.', label: '提醒' }, { prefix: 'settings.', label: '设置' }, { prefix: 'initialization.', label: '初始化' },
  { prefix: 'demo_data.', label: '演示数据' }, { prefix: 'user.', label: '用户' }, { prefix: 'role.', label: '角色' },
  { prefix: 'audit.', label: '日志' }, { prefix: 'deployment.', label: '部署' },
];

const PERMISSION_META: Record<string, { label: string; description: string }> = {
  'overview.read': { label: '查看管理概览', description: '进入管理后台并查看基础运行状态。' },
  'major.read': { label: '查看大型考试', description: '查看授权范围内的大型考试及科目安排。' },
  'major.create': { label: '新建大型考试', description: '创建新的大型考试计划。' },
  'major.edit': { label: '编辑大型考试', description: '修改考试名称、适用年级和科目时间。' },
  'major.delete': { label: '删除大型考试', description: '删除已有大型考试计划。' },
  'major.import': { label: '导入大型考试', description: '通过 JSON 批量导入考试安排。' },
  'major.export': { label: '导出大型考试', description: '导出当前考试安排用于备份或复用。' },
  'weekly.read': { label: '查看周测', description: '查看授权班级的周测计划和日历。' },
  'weekly.create': { label: '新建周测', description: '为班级创建新的周测计划。' },
  'weekly.edit': { label: '编辑周测', description: '修改周测科目、时间和 A/B 周设置。' },
  'weekly.delete': { label: '删除周测', description: '删除已有周测计划。' },
  'weekly.copy': { label: '复制周测计划', description: '将一个计划批量应用到其他班级。' },
  'weekly.override': { label: '处理周测例外', description: '设置单日停用、补测或冲突覆盖。' },
  'weekly.import': { label: '导入周测', description: '批量导入周测计划。' },
  'weekly.export': { label: '导出周测', description: '导出周测计划用于备份。' },
  'school.read': { label: '查看年级班级', description: '查看学校年级和班级结构。' },
  'school.grade_manage': { label: '管理年级', description: '新增或删除年级。' },
  'school.class_manage': { label: '管理班级', description: '新增、调整或删除班级。' },
  'device.read': { label: '查看设备', description: '查看客户端绑定和当前运行状态。' },
  'device.bind': { label: '绑定设备', description: '将客户端绑定到指定年级和班级。' },
  'device.revoke': { label: '删除设备', description: '撤销设备实例并要求客户端重新绑定。' },
  'schedule.mode_edit': { label: '修改运行模式', description: '切换大型考试、周测或自动调度模式。' },
  'schedule.conflict_edit': { label: '修改冲突规则', description: '设置大型考试与周测发生冲突时的处理方式。' },
  'schedule.term_edit': { label: '修改学期日期', description: '调整学期开始日期和周次基准。' },
  'schedule.ab_week_edit': { label: '修改 A/B 周', description: '配置 A/B 周交替规则。' },
  'schedule.holiday_edit': { label: '修改节假日', description: '配置法定节假日排除和未来年度数据。' },
  'alerts.read': { label: '查看提醒', description: '查看全屏提醒与自定义提醒配置。' },
  'alerts.edit': { label: '编辑提醒', description: '修改提醒内容、时间和启停状态。' },
  'settings.read': { label: '查看系统设置', description: '查看校时、显示、字体和版本信息。' },
  'settings.edit': { label: '编辑系统设置', description: '修改系统级显示和运行参数。' },
  'initialization.run': { label: '运行初始化向导', description: '重新配置学校结构和初始数据。' },
  'demo_data.delete': { label: '清除演示数据', description: '删除初始化向导导入的测试内容。' },
  'user.read': { label: '查看管理员', description: '查看管理员账号、角色和数据范围。' },
  'user.create': { label: '创建管理员', description: '新增客户端管理员账号。' },
  'user.edit': { label: '编辑管理员', description: '修改显示名称、角色、状态和数据范围。' },
  'user.disable': { label: '启停管理员', description: '停用或重新启用管理员账号。' },
  'user.reset_password': { label: '重置他人密码', description: '为可管理的账号设置临时密码并使旧会话失效。' },
  'role.manage': { label: '管理角色', description: '创建、修改和删除自定义角色。' },
  'audit.read': { label: '查看操作日志', description: '查看最近的登录与数据修改记录。' },
  'deployment.trigger': { label: '触发重新部署', description: '通过已配置的部署钩子更新应用。' },
};

const ACTION_LABEL: Record<string, string> = {
  'auth.login': '登录后台', 'user.create': '创建用户', 'user.update': '修改用户', 'user.password.reset': '重置密码',
  'user.password.change': '修改自己的密码', 'role.create': '创建角色', 'role.update': '修改角色', 'role.delete': '删除角色',
  'exam-data.update': '修改考试数据', 'device.revoke': '删除设备绑定',
};
const fmt = (value?: number | null) => value ? new Date(Number(value)).toLocaleString('zh-CN', { hour12: false }) : '从未登录';
const permissionMeta = (permission: string) => PERMISSION_META[permission] ?? { label: permission, description: '自定义系统权限。' };

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

export default function UserManagementPanel({ grades, classes, currentUser, forcePasswordChange = false }: Props) {
  const navigate = useNavigate();
  const current = currentUser ?? getAdminUser();
  const canReadUsers = adminCan('user.read', current);
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
  const [loading, setLoading] = useState(canReadUsers && !current?.mustChangePassword);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [userDraft, setUserDraft] = useState<UserDraft | null>(null);
  const [userErrors, setUserErrors] = useState<Record<string, string>>({});
  const [roleDraft, setRoleDraft] = useState<RoleDraft | null>(null);
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [passwordOpen, setPasswordOpen] = useState(forcePasswordChange || current?.mustChangePassword === true);
  const [passwordDraft, setPasswordDraft] = useState<PasswordDraft>({ current: '', next: '', confirm: '' });
  const [usernameOpen, setUsernameOpen] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState({ currentPassword: '', username: current?.username ?? '' });

  const load = async () => {
    if (!canReadUsers || current?.mustChangePassword) { setLoading(false); return; }
    setLoading(true); setMessage('');
    try { const data = await fetchUserManagement(); setUsers(data.users); setRoles(data.roles); setPermissions(data.permissions); }
    catch (error) { setMessage(error instanceof Error ? error.message : '用户数据加载失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (forcePasswordChange || current?.mustChangePassword) setPasswordOpen(true); }, [forcePasswordChange, current?.mustChangePassword]);
  useEffect(() => {
    if (section !== 'audit') return;
    fetchAuditLogs().then(setLogs).catch(error => setMessage(error instanceof Error ? error.message : '日志加载失败'));
  }, [section]);

  const groupedPermissions = useMemo(() => PERMISSION_GROUPS.map(group => ({ ...group, items: permissions.filter(item => item.startsWith(group.prefix)) })).filter(group => group.items.length), [permissions]);
  const canAssignAll = !!current && (current.permissions.includes('*') || current.scopes.some(scope => scope.type === 'all'));
  const visibleGradeIds = new Set(canAssignAll ? grades.map(item => item.id) : current?.scopes.filter(scope => scope.type === 'grade').map(scope => scope.gradeId) || []);
  const visibleClassIds = new Set(canAssignAll ? classes.map(item => item.id) : current?.scopes.filter(scope => scope.type === 'class').map(scope => scope.classId) || []);
  classes.forEach(item => { if (visibleGradeIds.has(item.gradeId)) visibleClassIds.add(item.id); });
  const visibleGrades = grades.filter(item => visibleGradeIds.has(item.id));
  const visibleClasses = classes.filter(item => visibleClassIds.has(item.id));
  const delegableRoles = roles.filter(role => current?.permissions.includes('*') || (!role.permissions.includes('*') && role.permissions.every(permission => current?.permissions.includes(permission))));
  const beginCreateUser = () => { setUserErrors({}); setUserDraft({ username: '', displayName: '', password: '', roleId: delegableRoles.find(role => role.id === 'viewer')?.id ?? delegableRoles[0]?.id ?? '', status: 'active', allScope: false, gradeIds: [], classIds: [] }); };
  const beginEditUser = (user: ManagedUser) => { setUserErrors({}); setUserDraft({ id: user.id, username: user.username, displayName: user.displayName, password: '', roleId: user.roleId, status: user.status, allScope: user.scopes.some(scope => scope.type === 'all'), gradeIds: user.scopes.filter(scope => scope.type === 'grade').map(scope => scope.gradeId), classIds: user.scopes.filter(scope => scope.type === 'class').map(scope => scope.classId) }); };

  const submitUser = async () => {
    if (!userDraft) return;
    const errors: Record<string, string> = {};
    if (!userDraft.id && !/^[A-Za-z0-9._-]{3,40}$/.test(userDraft.username.trim())) errors.username = '请输入 3-40 位字母、数字、点、横线或下划线';
    if (!userDraft.displayName.trim()) errors.displayName = '请输入显示名称';
    if (!userDraft.id && userDraft.password.length < 8) errors.password = '初始密码至少需要 8 位';
    if (!userDraft.roleId) errors.roleId = '请选择角色';
    if (userDraft.roleId !== 'super_admin' && !userDraft.allScope && !userDraft.gradeIds.length && !userDraft.classIds.length) errors.scopes = '至少选择一个年级或班级';
    if (Object.keys(errors).length) { setUserErrors(errors); return; }
    setBusy(true); setMessage('');
    try {
      const next = await saveManagedUser({ action: userDraft.id ? 'update' : 'create', id: userDraft.id, username: userDraft.username, displayName: userDraft.displayName, password: userDraft.password, roleId: userDraft.roleId, status: userDraft.status, scopes: draftScopes(userDraft, classes) });
      setUsers(next); setUserDraft(null); setMessage(userDraft.id ? '用户权限已更新，原登录会话已失效。' : '用户已创建，首次登录必须修改密码。');
    } catch (error) { if (error instanceof AdminApiError && error.field) setUserErrors({ [error.field]: error.message }); else setMessage(error instanceof Error ? error.message : '保存失败'); }
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
  const submitOwnPassword = async () => {
    if (passwordDraft.next.length < 8) { setMessage('新密码至少需要 8 位'); return; }
    if (passwordDraft.next !== passwordDraft.confirm) { setMessage('两次输入的新密码不一致'); return; }
    setBusy(true); setMessage('');
    try {
      await changeOwnPassword(passwordDraft.current, passwordDraft.next);
      logoutAdmin();
      navigate('/login?next=/admin', { replace: true });
    } catch (error) { setMessage(error instanceof Error ? error.message : '密码修改失败'); setBusy(false); }
  };
  const submitOwnUsername = async () => {
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(usernameDraft.username.trim())) { setMessage('用户名需为 3-40 位字母、数字、点、横线或下划线'); return; }
    if (!usernameDraft.currentPassword) { setMessage('请输入当前密码'); return; }
    setBusy(true); setMessage('');
    try { await changeOwnUsername(usernameDraft.currentPassword, usernameDraft.username.trim()); logoutAdmin(); navigate('/login?next=/admin', { replace: true }); }
    catch (error) { setMessage(error instanceof Error ? error.message : '用户名修改失败'); setBusy(false); }
  };

  const setRoleModuleLevel = (module: typeof ROLE_MODULES[number], level: RoleLevel) => setRoleDraft(value => {
    if (!value) return value;
    const modulePermissions = [...module.read, ...module.manage];
    const retained = value.permissions.filter(item => !modulePermissions.includes(item));
    const added = level === 'none' ? [] : level === 'read' ? module.read : [...module.read, ...module.manage];
    return { ...value, permissions: [...new Set([...retained, ...added])] };
  });

  return <main className="user-management">
    <div className="device-status__heading user-management__heading">
      <div><h2>{canReadUsers ? '用户与权限' : '我的账户'}</h2><p>{canReadUsers ? '为不同管理员分配可编辑内容和年级、班级范围。所有限制均由服务端再次校验。' : '管理当前账号的登录密码。'}</p></div>
      <div className="user-management__heading-actions"><button className="admin-btn" onClick={() => { setUsernameDraft({ currentPassword: '', username: current?.username ?? '' }); setUsernameOpen(true); }}>修改用户名</button><button className="admin-btn" onClick={() => setPasswordOpen(true)}>修改密码</button>{section === 'users' && canCreateUser && <button className="admin-btn admin-btn--primary" onClick={beginCreateUser}>添加用户</button>}{section === 'roles' && canManageRoles && <button className="admin-btn admin-btn--primary" onClick={() => setRoleDraft({ name: '', description: '', permissions: [] })}>新建角色</button>}</div>
    </div>
    {current?.mustChangePassword && <div className="admin-info-banner admin-info-banner--warn">当前使用的是初始或重置密码。请先修改密码，完成后重新登录。</div>}
    {canReadUsers && <div className="user-management__tabs"><button className={section === 'users' ? 'is-active' : ''} onClick={() => setSection('users')}>管理员</button>{canManageRoles && <button className={section === 'roles' ? 'is-active' : ''} onClick={() => setSection('roles')}>角色权限</button>}{canReadAudit && <button className={section === 'audit' ? 'is-active' : ''} onClick={() => setSection('audit')}>操作日志</button>}</div>}
    {message && <div className="admin-info-banner" aria-live="polite">{message}</div>}
    {loading ? <div className="admin-loading">正在读取用户权限…</div> : !canReadUsers ? <section className="user-management__account-card"><span>当前账号</span><strong>{current?.displayName}</strong><code>@{current?.username}</code><small>{current?.roleName}</small></section> : section === 'users' ? <>
      <div className="device-status__stats"><div><span>管理员总数</span><strong>{users.length}</strong></div><div><span>当前启用</span><strong>{users.filter(user => user.status === 'active').length}</strong></div><div><span>自定义角色</span><strong>{roles.filter(role => !role.builtIn).length}</strong></div><div><span>需修改密码</span><strong>{users.filter(user => user.mustChangePassword).length}</strong></div></div>
      <div className="user-management__list">{users.map(user => <article className={`user-management__row${user.status === 'disabled' ? ' is-disabled' : ''}`} key={user.id}><div className="user-management__identity"><strong>{user.displayName}{user.id === current?.id && <span className="user-management__self">当前账号</span>}</strong><code>@{user.username}</code></div><div><span className="user-management__role">{user.roleName}</span><small>{scopeText(user, grades, classes)}</small></div><div><small>{user.status === 'active' ? '已启用' : '已停用'} · {fmt(user.lastLoginAt)}</small>{user.mustChangePassword && <em>首次登录需改密码</em>}</div>{(canEditUser || canResetPassword) && <div className="user-management__actions">{canEditUser && <button className="admin-btn" onClick={() => beginEditUser(user)}>编辑</button>}{canResetPassword && user.id !== current?.id && <button className="admin-btn" onClick={() => { setResetTarget(user); setResetPassword(''); }}>重置密码</button>}{user.id === current?.id && <button className="admin-btn" onClick={() => setPasswordOpen(true)}>修改密码</button>}</div>}</article>)}</div>
    </> : section === 'roles' ? <div className="user-management__role-list">{roles.map(role => {
      const roleGroups = groupedPermissions.map(group => ({ ...group, items: role.permissions.includes('*') ? group.items : group.items.filter(item => role.permissions.includes(item)) })).filter(group => group.items.length);
      return <article className="user-management__role-row" key={role.id}><div className="user-management__role-main"><div><strong>{role.name}</strong>{role.builtIn && <span>内置</span>}</div><p>{role.description || '尚未填写角色职责说明。'}</p><details className="user-management__role-detail"><summary>{role.permissions.includes('*') ? '查看全部系统权限说明' : `查看 ${role.permissions.length} 项权限说明`}</summary><div className="user-management__role-groups">{roleGroups.map(group => <section key={group.prefix}><b>{group.label}</b><ul>{group.items.map(permission => <li key={permission}><strong>{permissionMeta(permission).label}</strong><span>{permissionMeta(permission).description}</span></li>)}</ul></section>)}</div></details></div><div className="user-management__permission-summary">{role.permissions.includes('*') ? '全部权限' : `${role.permissions.length} 项权限`}</div>{!role.builtIn && <div className="user-management__actions"><button className="admin-btn" onClick={() => setRoleDraft({ id: role.id, name: role.name, description: role.description, permissions: role.permissions })}>编辑</button><button className="admin-btn admin-btn--danger" onClick={async () => { if (!window.confirm(`删除角色“${role.name}”？`)) return; try { setRoles(await deleteManagedRole(role.id)); } catch (error) { setMessage(error instanceof Error ? error.message : '删除失败'); } }}>删除</button></div>}</article>;
    })}</div> : <div className="user-management__audit">{logs.length ? logs.map(log => <div className="user-management__audit-row" key={log.id}><time>{fmt(log.createdAt)}</time><strong>{log.username || '系统'}</strong><span>{ACTION_LABEL[log.action] || log.action}</span><code>{log.resourceId || log.resourceType}</code></div>) : <div className="admin-empty"><p>暂无操作记录</p></div>}</div>}

    {userDraft && <div className="admin-modal-overlay"><div className="admin-modal admin-modal--wide" onClick={event => event.stopPropagation()}><h2 className="admin-modal__title">{userDraft.id ? '编辑管理员' : '添加管理员'}</h2><div className="user-editor__grid"><label className="admin-label">用户名<input className="admin-input" disabled={!!userDraft.id} value={userDraft.username} onChange={event => { setUserErrors(value => ({ ...value, username: '' })); setUserDraft(value => value && { ...value, username: event.target.value }); }} placeholder="如：grade3_admin" />{userErrors.username && <small className="admin-field-error">{userErrors.username}</small>}</label><label className="admin-label">显示名称<input className="admin-input" value={userDraft.displayName} onChange={event => { setUserErrors(value => ({ ...value, displayName: '' })); setUserDraft(value => value && { ...value, displayName: event.target.value }); }} placeholder="如：高三教务" />{userErrors.displayName && <small className="admin-field-error">{userErrors.displayName}</small>}</label>{!userDraft.id && <label className="admin-label">初始密码<input className="admin-input" type="password" value={userDraft.password} onChange={event => { setUserErrors(value => ({ ...value, password: '' })); setUserDraft(value => value && { ...value, password: event.target.value }); }} placeholder="至少 8 位" />{userErrors.password && <small className="admin-field-error">{userErrors.password}</small>}</label>}<label className="admin-label">角色<select className="admin-input" value={userDraft.roleId} onChange={event => { setUserErrors(value => ({ ...value, roleId: '' })); setUserDraft(value => value && { ...value, roleId: event.target.value }); }}>{delegableRoles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select>{userErrors.roleId && <small className="admin-field-error">{userErrors.roleId}</small>}</label>{userDraft.id && <label className="admin-label">状态<select className="admin-input" value={userDraft.status} onChange={event => setUserDraft(value => value && { ...value, status: event.target.value as UserDraft['status'] })}><option value="active">启用</option><option value="disabled">停用</option></select></label>}</div><div className="user-editor__scope">{canAssignAll && <label className="admin-toggle-label"><input type="checkbox" checked={userDraft.allScope || userDraft.roleId === 'super_admin'} disabled={userDraft.roleId === 'super_admin'} onChange={event => setUserDraft(value => value && { ...value, allScope: event.target.checked })} />管理全校数据</label>}{!userDraft.allScope && userDraft.roleId !== 'super_admin' && <><h3>可管理年级</h3><div className="admin-major-targets">{visibleGrades.map(grade => <label key={grade.id}><input type="checkbox" checked={userDraft.gradeIds.includes(grade.id)} onChange={event => { setUserErrors(value => ({ ...value, scopes: '' })); setUserDraft(value => value && { ...value, gradeIds: event.target.checked ? [...value.gradeIds, grade.id] : value.gradeIds.filter(id => id !== grade.id) }); }} />{grade.name}</label>)}</div><h3>额外指定班级</h3><div className="admin-major-targets">{visibleClasses.map(item => <label key={item.id}><input type="checkbox" checked={userDraft.classIds.includes(item.id)} onChange={event => { setUserErrors(value => ({ ...value, scopes: '' })); setUserDraft(value => value && { ...value, classIds: event.target.checked ? [...value.classIds, item.id] : value.classIds.filter(id => id !== item.id) }); }} />{grades.find(grade => grade.id === item.gradeId)?.name} · {item.name}</label>)}</div>{userErrors.scopes && <small className="admin-field-error">{userErrors.scopes}</small>}</>}</div><div className="admin-modal__actions"><button className="admin-btn admin-btn--primary" disabled={busy} onClick={() => void submitUser()}>{busy ? '保存中…' : '保存'}</button><button className="admin-btn" onClick={() => { setUserDraft(null); setUserErrors({}); }}>取消</button></div></div></div>}
    {roleDraft && <div className="admin-modal-overlay"><div className="admin-modal admin-modal--wide" onClick={event => event.stopPropagation()}><h2 className="admin-modal__title">{roleDraft.id ? '编辑自定义角色' : '新建自定义角色'}</h2><label className="admin-label">角色名称<input className="admin-input" value={roleDraft.name} onChange={event => setRoleDraft(value => value && { ...value, name: event.target.value })} /></label><label className="admin-label">角色职责说明<textarea className="admin-textarea" rows={2} value={roleDraft.description} onChange={event => setRoleDraft(value => value && { ...value, description: event.target.value })} placeholder="说明该角色负责什么、不能做什么，分配账号时会直接展示。" /></label><div className="role-editor__modules">{ROLE_MODULES.map(module => <label key={module.id}><span><strong>{module.label}</strong><small>{module.manage.length ? '选择查看或管理整个模块' : '控制是否显示该模块'}</small></span><select className="admin-input" value={moduleLevel(roleDraft.permissions, module)} onChange={event => setRoleModuleLevel(module, event.target.value as RoleLevel)}><option value="none">不可访问</option><option value="read">仅查看</option>{module.manage.length > 0 && <option value="manage">可管理</option>}</select></label>)}</div><p className="admin-major-card__hint">数据库重置、初始化、角色管理、部署和超级管理员操作仅保留给超级管理员。</p><div className="admin-modal__actions"><button className="admin-btn admin-btn--primary" disabled={busy} onClick={() => void submitRole()}>{busy ? '保存中…' : '保存角色'}</button><button className="admin-btn" onClick={() => setRoleDraft(null)}>取消</button></div></div></div>}
    {resetTarget && <div className="admin-modal-overlay"><div className="admin-modal" onClick={event => event.stopPropagation()}><h2 className="admin-modal__title">重置 {resetTarget.displayName} 的密码</h2><p className="admin-modal__body">重置后该用户当前登录立即失效，下次登录必须再次修改密码。</p><input className="admin-input" type="password" value={resetPassword} onChange={event => setResetPassword(event.target.value)} placeholder="新密码，至少 8 位" /><div className="admin-modal__actions"><button className="admin-btn admin-btn--primary" disabled={busy} onClick={() => void submitReset()}>确认重置</button><button className="admin-btn" onClick={() => setResetTarget(null)}>取消</button></div></div></div>}
    {passwordOpen && <div className="admin-modal-overlay"><div className="admin-modal" onClick={event => event.stopPropagation()}><h2 className="admin-modal__title">修改我的密码</h2><p className="admin-modal__body">密码保存在当前部署的 Neon 数据库。修改成功后所有旧会话会失效，需要使用新密码重新登录。</p><div className="user-management__password-fields"><input className="admin-input" type="password" autoComplete="current-password" value={passwordDraft.current} onChange={event => setPasswordDraft(value => ({ ...value, current: event.target.value }))} placeholder="当前密码" /><input className="admin-input" type="password" autoComplete="new-password" value={passwordDraft.next} onChange={event => setPasswordDraft(value => ({ ...value, next: event.target.value }))} placeholder="新密码，至少 8 位" /><input className="admin-input" type="password" autoComplete="new-password" value={passwordDraft.confirm} onChange={event => setPasswordDraft(value => ({ ...value, confirm: event.target.value }))} placeholder="再次输入新密码" /></div><div className="admin-modal__actions"><button className="admin-btn admin-btn--primary" disabled={busy} onClick={() => void submitOwnPassword()}>{busy ? '保存中…' : '保存并重新登录'}</button>{!forcePasswordChange && !current?.mustChangePassword && <button className="admin-btn" onClick={() => setPasswordOpen(false)}>取消</button>}</div></div></div>}
    {usernameOpen && <div className="admin-modal-overlay"><div className="admin-modal" onClick={event => event.stopPropagation()}><h2 className="admin-modal__title">修改我的用户名</h2><p className="admin-modal__body">修改后所有旧会话都会失效，需要使用新用户名重新登录。</p><div className="user-management__password-fields"><input className="admin-input" autoComplete="username" value={usernameDraft.username} onChange={event => setUsernameDraft(value => ({ ...value, username: event.target.value }))} placeholder="新用户名" /><input className="admin-input" type="password" autoComplete="current-password" value={usernameDraft.currentPassword} onChange={event => setUsernameDraft(value => ({ ...value, currentPassword: event.target.value }))} placeholder="当前密码" /></div><div className="admin-modal__actions"><button className="admin-btn admin-btn--primary" disabled={busy} onClick={() => void submitOwnUsername()}>{busy ? '保存中…' : '保存并重新登录'}</button><button className="admin-btn" onClick={() => setUsernameOpen(false)}>取消</button></div></div></div>}
  </main>;
}
