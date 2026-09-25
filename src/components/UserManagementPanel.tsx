import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SchoolClass, SchoolGrade } from '../types/school';
import AdminModalPortal from './AdminModalPortal';
import { getAdminUser, logoutAdmin, type AdminUserContext } from '../services/examService';
import {
  changeOwnPassword,
  changeOwnCredentials,
  changeOwnUsername,
  deleteManagedUser,
  fetchAuditLogs,
  fetchUserManagement,
  resetManagedUserPassword,
  saveManagedRole,
  saveManagedUser,
  type AuditLog,
  type ManagedRole,
  type ManagedUser,
} from '../services/adminUsers';
import type { ClassPickerOption } from './ClassMultiPicker';
import AuditSection from './user-management/AuditSection';
import { BatchUserWizardModal } from './user-management/BatchUserWizardModal';
import { BatchCredentialsModal } from './user-management/BatchCredentialsModal';
import { UserWizardModal } from './user-management/UserWizardModal';
import { RoleWizardModal } from './user-management/RoleWizardModal';
import { ResetPasswordModal } from './user-management/ResetPasswordModal';
import { IssuedPasswordModal } from './user-management/IssuedPasswordModal';
import { OwnPasswordModal } from './user-management/OwnPasswordModal';
import { OwnUsernameModal } from './user-management/OwnUsernameModal';
import RoleSection from './user-management/RoleSection';
import UserListSection from './user-management/UserListSection';
import {
  generateTemporaryPassword,
  draftScopes,
  routeAdminApiError,
  validateUserDraftFields,
  validateUserScopes,
} from './user-management/helpers';
import type { UserDraft, RoleDraft, PasswordDraft, BatchUserDraft, BatchCredential } from './user-management/types';
import AccountEmailBinding from './AccountEmailBinding';
import { confirmDialog } from '../services/appDialog';
import { notify } from '../services/notify';
import { ROLE_MODULES, PERMISSION_GROUPS, type RoleLevel } from '../constants/permissions';
import {
  canGrantModuleLevel,
  computeDelegablePermissionSet,
  computeUserManagementPermissionFlags,
  computeUserManagementScopeAccess,
} from '../services/userManagementAccess';

type Props = {
  grades: SchoolGrade[];
  classes: SchoolClass[];
  currentUser?: AdminUserContext | null;
  forcePasswordChange?: boolean;
  openBatchCreate?: boolean;
};
type Section = 'users' | 'roles' | 'audit';

const BUILTIN_GROUP_ORDER = ['super_admin', 'grade_admin', 'class_admin', 'viewer'];

export default function UserManagementPanel({
  grades,
  classes,
  currentUser,
  forcePasswordChange = false,
  openBatchCreate = false,
}: Props) {
  const navigate = useNavigate();
  const current = currentUser ?? getAdminUser();
  const { canReadUsers, canCreateUser, canEditUser, canResetPassword, canDeleteUser, canManageRoles, canReadAudit } =
    computeUserManagementPermissionFlags(current);
  /**
   * 统一的失败出口：面板横幅 + toast。
   * 弹窗打开时横幅被遮罩盖住，只有 toast 能保证用户一定看得到"为什么没保存"。
   */
  const announceFailure = useCallback((title: string, message: string) => {
    setMessage(message);
    notify('error', message, title);
  }, []);
  const [section, setSection] = useState<Section>('users');
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<ManagedRole[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(canReadUsers && !current?.mustChangePassword);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [userDraft, setUserDraft] = useState<UserDraft | null>(null);
  const [userWizardStep, setUserWizardStep] = useState(0);
  const [batchUserDraft, setBatchUserDraft] = useState<BatchUserDraft | null>(null);
  const [batchUserWizardStep, setBatchUserWizardStep] = useState(0);
  const [batchCredentials, setBatchCredentials] = useState<BatchCredential[] | null>(null);
  const [userErrors, setUserErrors] = useState<Record<string, string>>({});
  /** 用户向导的表单级错误：只写面板横幅会被弹窗遮罩盖住，所以单独留一个弹窗内的位置。 */
  const [userFormError, setUserFormError] = useState('');
  const [roleError, setRoleError] = useState('');
  const [batchUserError, setBatchUserError] = useState('');
  const [roleDraft, setRoleDraft] = useState<RoleDraft | null>(null);
  const [roleWizardStep, setRoleWizardStep] = useState(0);
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetMode, setResetMode] = useState<'generated' | 'manual'>('generated');
  const [issuedPassword, setIssuedPassword] = useState<{
    displayName: string;
    password: string;
  } | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [passwordOpen, setPasswordOpen] = useState(forcePasswordChange || current?.mustChangePassword === true);
  const [passwordDraft, setPasswordDraft] = useState<PasswordDraft>({
    current: '',
    username: current?.username ?? '',
    next: '',
    confirm: '',
  });
  const [usernameOpen, setUsernameOpen] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState({
    currentPassword: '',
    username: current?.username ?? '',
  });
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [usernameError, setUsernameError] = useState('');
  const [resetError, setResetError] = useState('');
  const [batchDeleteMode, setBatchDeleteMode] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [batchDeleteGradeId, setBatchDeleteGradeId] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [menuUser, setMenuUser] = useState<string | null>(null);
  const [menuRect, setMenuRect] = useState<{ left: number; top: number } | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [matrixDraft, setMatrixDraft] = useState<RoleDraft | null>(null);

  const load = useCallback(async () => {
    if (!canReadUsers || current?.mustChangePassword) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const data = await fetchUserManagement();
      setUsers(data.users);
      setRoles(data.roles);
      setPermissions(data.permissions);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '用户数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [canReadUsers, current?.mustChangePassword]);
  useEffect(() => {
    void load();
  }, [load]);
  const userDraftOpen = userDraft !== null;
  const roleDraftOpen = roleDraft !== null;
  const batchUserDraftOpen = batchUserDraft !== null;
  useEffect(() => {
    if (userDraftOpen) setUserWizardStep(0);
  }, [userDraftOpen]);
  useEffect(() => {
    if (roleDraftOpen) setRoleWizardStep(0);
  }, [roleDraftOpen]);
  useEffect(() => {
    if (batchUserDraftOpen) setBatchUserWizardStep(0);
  }, [batchUserDraftOpen]);
  useEffect(() => {
    if (forcePasswordChange || current?.mustChangePassword) setPasswordOpen(true);
  }, [forcePasswordChange, current?.mustChangePassword]);
  useEffect(() => {
    if (openBatchCreate && canCreateUser) setBatchUserDraft({ prefix: 'class_admin', password: '', classIds: [] });
  }, [canCreateUser, openBatchCreate]);
  useEffect(() => {
    if (section !== 'audit') return;
    fetchAuditLogs()
      .then(setLogs)
      .catch((error) => setMessage(error instanceof Error ? error.message : '日志加载失败'));
  }, [section]);

  const groupedPermissions = useMemo(
    () =>
      PERMISSION_GROUPS.map((group) => ({
        ...group,
        items: permissions.filter((item) => item.startsWith(group.prefix)),
      })).filter((group) => group.items.length),
    [permissions],
  );
  const { canAssignAll, visibleGrades, visibleClasses, delegableRoles } = computeUserManagementScopeAccess(
    current,
    roles,
    grades,
    classes,
  );
  /**
   * 当前账号能授出的权限集合（`*` → null 表示全部）。
   * 与服务端 `canDelegatePermissions` 同一口径：前端不该让人勾出服务端必然拒绝的组合。
   */
  const delegablePermissions = useMemo(() => computeDelegablePermissionSet(current), [current]);
  const canGrantLevel = useCallback(
    (module: (typeof ROLE_MODULES)[number], level: RoleLevel) =>
      canGrantModuleLevel(delegablePermissions, module, level),
    [delegablePermissions],
  );
  const classPickerOptions = useMemo<ClassPickerOption[]>(
    () =>
      visibleClasses.map((item) => ({
        id: item.id,
        gradeId: item.gradeId,
        gradeName: grades.find((grade) => grade.id === item.gradeId)?.name ?? '未知年级',
        className: item.name,
      })),
    [grades, visibleClasses],
  );
  const beginCreateUser = () => {
    setUserErrors({});
    setUserFormError('');
    setUserDraft({
      username: '',
      displayName: '',
      password: '',
      roleId: delegableRoles.find((role) => role.id === 'viewer')?.id ?? delegableRoles[0]?.id ?? '',
      status: 'active',
      allScope: false,
      gradeIds: [],
      classIds: [],
    });
  };
  const beginEditUser = (user: ManagedUser) => {
    setUserErrors({});
    setUserFormError('');
    setUserDraft({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      password: '',
      roleId: user.roleId,
      status: user.status,
      allScope: user.scopes.some((scope) => scope.type === 'all'),
      gradeIds: user.scopes.filter((scope) => scope.type === 'grade').map((scope) => scope.gradeId),
      classIds: user.scopes.filter((scope) => scope.type === 'class').map((scope) => scope.classId),
    });
  };

  const submitUser = async () => {
    if (!userDraft) return;
    const errors = validateUserDraftFields(userDraft);
    const scopeError = validateUserScopes(userDraft);
    if (scopeError) errors.scopes = scopeError;
    if (Object.keys(errors).length) {
      setUserErrors(errors);
      setUserFormError('');
      if (errors.scopes) setUserWizardStep(1);
      return;
    }
    setBusy(true);
    setMessage('');
    setUserFormError('');
    try {
      const next = await saveManagedUser({
        action: userDraft.id ? 'update' : 'create',
        id: userDraft.id,
        username: userDraft.username,
        displayName: userDraft.displayName,
        password: userDraft.password,
        roleId: userDraft.roleId,
        status: userDraft.status,
        scopes: draftScopes(userDraft, classes),
      });
      setUsers(next);
      setUserDraft(null);
      setMessage(userDraft.id ? '用户权限已更新，原登录会话已失效。' : '用户已创建，首次登录必须修改密码。');
    } catch (error) {
      const routed = routeAdminApiError(error, '保存失败');
      if (routed.formLevel) {
        // 没有具体字段的错误显示在弹窗顶部，并补一条 toast：横幅在弹窗后面看不见。
        setUserFormError(routed.message);
        announceFailure('保存管理员失败', routed.message);
      } else {
        setUserErrors({ [routed.field]: routed.message });
        if (routed.field === 'scopes') setUserWizardStep(1);
      }
    } finally {
      setBusy(false);
    }
  };
  const submitBatchUsers = async () => {
    if (!batchUserDraft?.classIds.length) {
      setMessage('请至少选择一个班级。');
      return;
    }
    if (!/^[A-Za-z0-9._-]{2,30}$/.test(batchUserDraft.prefix)) {
      setMessage('账号前缀需为 2-30 位字母、数字、点、横线或下划线。');
      return;
    }
    if (batchUserDraft.password.length < 8) {
      setMessage('批量账号初始密码至少需要 8 位。');
      return;
    }
    if (!delegableRoles.some((role) => role.id === 'class_admin')) {
      setMessage('当前账号不能下发班级管理员角色。');
      return;
    }
    setBusy(true);
    setMessage('');
    setBatchUserError('');
    let completed = 0;
    let latest = users;
    const created: BatchCredential[] = [];
    try {
      for (const classId of batchUserDraft.classIds) {
        const schoolClass = classes.find((item) => item.id === classId)!;
        const grade = grades.find((item) => item.id === schoolClass.gradeId);
        const suffix = String(
          classes.filter((item) => item.gradeId === schoolClass.gradeId).findIndex((item) => item.id === classId) + 1,
        ).padStart(2, '0');
        const gradeIndex = String(grades.findIndex((item) => item.id === schoolClass.gradeId) + 1);
        latest = await saveManagedUser({
          action: 'create',
          username: `${batchUserDraft.prefix}_g${gradeIndex}c${suffix}`,
          displayName: `${grade?.name ?? ''}${schoolClass.name}管理员`,
          password: batchUserDraft.password,
          roleId: 'class_admin',
          status: 'active',
          scopes: [{ type: 'class', gradeId: schoolClass.gradeId, classId }],
        });
        created.push({
          displayName: `${grade?.name ?? ''}${schoolClass.name}管理员`,
          username: `${batchUserDraft.prefix}_g${gradeIndex}c${suffix}`,
          password: batchUserDraft.password,
          gradeName: grade?.name ?? '',
          className: schoolClass.name,
        });
        completed += 1;
      }
      setUsers(latest);
      setBatchUserDraft(null);
      setBatchCredentials(created);
      setMessage(`已创建 ${completed} 个班级管理员账号，首次登录均需设置自己的用户名和新密码。`);
    } catch (error) {
      setUsers(latest);
      const message = `已创建 ${completed} 个账号，随后停止：${error instanceof Error ? error.message : '创建失败'}`;
      // 向导这时还开着，提示必须留在向导里（顺带补一条 toast）。
      setBatchUserError(message);
      announceFailure('批量创建未完成', message);
    } finally {
      setBusy(false);
    }
  };
  const exportBatchCredentials = () => {
    if (!batchCredentials?.length) return;
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = [
      ['管理员', '用户名', '初始密码', '年级', '班级', '首次登录要求'],
      ...batchCredentials.map((item) => [
        item.displayName,
        item.username,
        item.password,
        item.gradeName,
        item.className,
        '修改用户名和密码',
      ]),
    ];
    const file = new Blob([`\uFEFF${rows.map((row) => row.map(quote).join(',')).join('\r\n')}`], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Novora-班级管理员初始账号-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const submitRole = async () => {
    if (!roleDraft) return;
    setBusy(true);
    setMessage('');
    setRoleError('');
    try {
      const { roles: nextRoles, sessionsInvalidated } = await saveManagedRole(roleDraft);
      setRoles(nextRoles);
      setRoleDraft(null);
      setMessage(
        sessionsInvalidated > 0
          ? `角色权限已保存。该角色的 ${sessionsInvalidated} 个账号需要重新登录才能拿到新权限。`
          : '角色权限已保存。',
      );
      if (sessionsInvalidated > 0) {
        notify(
          'warning',
          `该角色下有 ${sessionsInvalidated} 个账号的登录已失效，重新登录后按新权限生效。`,
          '角色权限已更新',
        );
      }
    } catch (error) {
      // 写进弹窗自己的错误位：面板横幅被弹窗遮罩挡着，用户看不到任何提示。
      const message = routeAdminApiError(error, '角色保存失败').message;
      setRoleError(message);
      announceFailure('角色保存失败', message);
    } finally {
      setBusy(false);
    }
  };
  const toggleMenu = (event: React.MouseEvent<HTMLButtonElement>, user: ManagedUser) => {
    if (menuUser === String(user.id)) {
      setMenuUser(null);
      setMenuRect(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuRect({ left: rect.right, top: rect.bottom });
    setMenuUser(String(user.id));
  };
  useEffect(() => {
    if (!menuUser) return;
    const close = () => {
      setMenuUser(null);
      setMenuRect(null);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menuUser]);

  const selectRole = (role: ManagedRole) => {
    setSelectedRoleId(role.id);
    setMatrixDraft(
      role.builtIn
        ? null
        : {
            id: role.id,
            name: role.name,
            description: role.description,
            permissions: role.permissions,
          },
    );
  };
  const setMatrixModuleLevel = (module: (typeof ROLE_MODULES)[number], level: RoleLevel) =>
    setMatrixDraft((value) => {
      if (!value) return value;
      const modulePermissions = [...module.read, ...module.manage];
      const retained = value.permissions.filter((item) => !modulePermissions.includes(item));
      const added = level === 'none' ? [] : level === 'read' ? module.read : [...module.read, ...module.manage];
      return {
        ...value,
        permissions: [...new Set([...retained, ...added])],
      };
    });
  const saveMatrixRole = async () => {
    if (!matrixDraft) return;
    setBusy(true);
    setMessage('');
    try {
      const { roles: next, sessionsInvalidated } = await saveManagedRole(matrixDraft);
      setRoles(next);
      const saved = next.find((role) => role.id === matrixDraft.id);
      setMatrixDraft(
        saved
          ? {
              id: saved.id,
              name: saved.name,
              description: saved.description,
              permissions: saved.permissions,
            }
          : null,
      );
      setMessage(
        sessionsInvalidated > 0
          ? `角色权限已保存。该角色的 ${sessionsInvalidated} 个账号需要重新登录才能拿到新权限。`
          : '角色权限已保存。',
      );
      if (sessionsInvalidated > 0) {
        notify(
          'warning',
          `该角色下有 ${sessionsInvalidated} 个账号的登录已失效，重新登录后按新权限生效。`,
          '角色权限已更新',
        );
      }
    } catch (error) {
      // 矩阵在面板里，横幅可见；仍然补 toast 以免页面滚动到别处时漏看。
      announceFailure('角色保存失败', routeAdminApiError(error, '角色保存失败').message);
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async () => {
    if (!resetTarget || resetPassword.length < 8) {
      setResetError('新密码至少需要 8 位');
      return;
    }
    setBusy(true);
    try {
      const issued = {
        displayName: resetTarget.displayName,
        password: resetPassword,
      };
      await resetManagedUserPassword(resetTarget.id, resetPassword);
      setResetTarget(null);
      setResetPassword('');
      setResetError('');
      setIssuedPassword(issued);
      setCopyStatus('');
      setMessage('密码已重置，该用户需要重新登录并修改密码。');
    } catch (error) {
      setResetError(error instanceof Error ? error.message : '重置失败');
    } finally {
      setBusy(false);
    }
  };
  const submitOwnPassword = async () => {
    const errors: Record<string, string> = {};
    const requiresInitialUpdate = forcePasswordChange || current?.mustChangePassword;
    if (!passwordDraft.current) errors.current = '请输入当前密码';
    if (requiresInitialUpdate && !/^[A-Za-z0-9._-]{3,40}$/.test(passwordDraft.username.trim()))
      errors.username = '用户名需为 3-40 位字母、数字、点、横线或下划线';
    if (
      requiresInitialUpdate &&
      current?.roleId === 'class_admin' &&
      passwordDraft.username.trim().toLowerCase() === current.username.toLowerCase()
    )
      errors.username = '班级管理员首次登录必须设置新的用户名';
    if (passwordDraft.next.length < 8) errors.next = '新密码至少需要 8 位';
    if (passwordDraft.next !== passwordDraft.confirm) errors.confirm = '两次输入的新密码不一致';
    if (Object.keys(errors).length) {
      setPasswordErrors(errors);
      return;
    }
    setBusy(true);
    setPasswordErrors({});
    try {
      if (requiresInitialUpdate)
        await changeOwnCredentials(passwordDraft.current, passwordDraft.username.trim(), passwordDraft.next);
      else await changeOwnPassword(passwordDraft.current, passwordDraft.next);
      logoutAdmin();
      navigate('/login?next=/admin', { replace: true });
    } catch (error) {
      setPasswordErrors({
        current: error instanceof Error ? error.message : '密码修改失败',
      });
      setBusy(false);
    }
  };
  const submitOwnUsername = async () => {
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(usernameDraft.username.trim())) {
      setUsernameError('用户名需为 3-40 位字母、数字、点、横线或下划线');
      return;
    }
    if (!usernameDraft.currentPassword) {
      setUsernameError('请输入当前登录密码以验证身份');
      return;
    }
    setBusy(true);
    setUsernameError('');
    try {
      await changeOwnUsername(usernameDraft.currentPassword, usernameDraft.username.trim());
      logoutAdmin();
      navigate('/login?next=/admin', { replace: true });
    } catch (error) {
      setUsernameError(error instanceof Error ? error.message : '用户名修改失败');
      setBusy(false);
    }
  };

  const setRoleModuleLevel = (module: (typeof ROLE_MODULES)[number], level: RoleLevel) =>
    setRoleDraft((value) => {
      if (!value) return value;
      const modulePermissions = [...module.read, ...module.manage];
      const retained = value.permissions.filter((item) => !modulePermissions.includes(item));
      const added = level === 'none' ? [] : level === 'read' ? module.read : [...module.read, ...module.manage];
      return { ...value, permissions: [...new Set([...retained, ...added])] };
    });

  const removeUser = async (user: ManagedUser) => {
    if (
      !(await confirmDialog({
        title: `删除管理员“${user.displayName}”`,
        message: '该账号会立即退出所有设备，且无法恢复。',
        tone: 'danger',
        confirmLabel: '删除管理员',
      }))
    )
      return;
    try {
      setUsers(await deleteManagedUser(user.id));
      setMessage(`管理员“${user.displayName}”已删除。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除用户失败');
    }
  };
  const removableUsers = users.filter((user) => user.id !== current?.id);
  const batchDeleteUsers = useMemo(
    () =>
      batchDeleteGradeId
        ? removableUsers.filter((user) =>
            user.scopes.some((scope) => scope.type !== 'all' && scope.gradeId === batchDeleteGradeId),
          )
        : removableUsers,
    [batchDeleteGradeId, removableUsers],
  );
  const groupUsersByRole = useCallback((userList: ManagedUser[]) => {
    const groups = new Map<string, { key: string; name: string; builtIn: boolean; users: ManagedUser[] }>();
    for (const user of userList) {
      const builtIn = BUILTIN_GROUP_ORDER.includes(user.roleId);
      const existing = groups.get(user.roleId);
      if (existing) existing.users.push(user);
      else
        groups.set(user.roleId, {
          key: user.roleId,
          name: user.roleName || user.roleId,
          builtIn,
          users: [user],
        });
    }
    return [...groups.values()].sort((a, b) => {
      const aIndex = BUILTIN_GROUP_ORDER.indexOf(a.key);
      const bIndex = BUILTIN_GROUP_ORDER.indexOf(b.key);
      const aOrder = aIndex >= 0 ? aIndex : BUILTIN_GROUP_ORDER.length;
      const bOrder = bIndex >= 0 ? bIndex : BUILTIN_GROUP_ORDER.length;
      return aOrder - bOrder || a.name.localeCompare(b.name, 'zh-CN');
    });
  }, []);
  const groupsInitialized = useRef(false);
  useEffect(() => {
    if (groupsInitialized.current || !users.length) return;
    groupsInitialized.current = true;
    const currentRoleName = users.find((user) => user.id === current?.id)?.roleName ?? '';
    setCollapsedGroups((prev) => {
      const next = { ...prev };
      for (const group of groupUsersByRole(users)) {
        if (!(group.key in next)) next[group.key] = group.name !== currentRoleName;
      }
      return next;
    });
  }, [groupUsersByRole, users, current?.id]);
  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return users.filter((user) => {
      if (query && !user.displayName.toLowerCase().includes(query) && !user.username.toLowerCase().includes(query))
        return false;
      if (roleFilter && user.roleId !== roleFilter) return false;
      if (statusFilter && user.status !== statusFilter) return false;
      return true;
    });
  }, [users, searchQuery, roleFilter, statusFilter]);
  const userGroups = useMemo(
    () => groupUsersByRole(batchDeleteMode ? batchDeleteUsers : filteredUsers),
    [batchDeleteMode, batchDeleteUsers, filteredUsers, groupUsersByRole],
  );
  const selectedRole = useMemo(() => roles.find((role) => role.id === selectedRoleId) ?? null, [roles, selectedRoleId]);
  useEffect(() => {
    if (!roles.length) return;
    setSelectedRoleId((id) => (id && roles.some((role) => role.id === id) ? id : roles[0].id));
  }, [roles]);
  const rolePermissionGroups = (role: ManagedRole, draft: RoleDraft | null) => {
    const permissions = draft && draft.id === role.id ? draft.permissions : role.permissions;
    return groupedPermissions
      .map((group) => ({
        ...group,
        items: permissions.includes('*') ? group.items : group.items.filter((item) => permissions.includes(item)),
      }))
      .filter((group) => group.items.length);
  };

  const removeSelectedUsers = async () => {
    const targets = removableUsers.filter((user) => selectedUserIds.includes(user.id));
    if (!targets.length) return;
    if (
      !(await confirmDialog({
        title: `删除 ${targets.length} 个管理员账号`,
        message: '删除后将立即撤销这些账号的会话，且无法恢复。',
        tone: 'danger',
        confirmLabel: '删除所选账号',
      }))
    )
      return;
    setBusy(true);
    const failed: number[] = [];
    let nextUsers = users;
    for (const target of targets) {
      try {
        nextUsers = await deleteManagedUser(target.id);
      } catch {
        failed.push(target.id);
      }
    }
    setUsers(nextUsers);
    setSelectedUserIds(failed);
    setBusy(false);
    setMessage(
      failed.length
        ? `已删除 ${targets.length - failed.length} 个账号；${failed.length} 个账号删除失败，请重试。`
        : `已删除 ${targets.length} 个账号。`,
    );
    if (!failed.length) setBatchDeleteMode(false);
  };
  return (
    <main className="user-management">
      {batchUserDraft && (
        <BatchUserWizardModal
          batchUserDraft={batchUserDraft}
          setBatchUserDraft={setBatchUserDraft}
          batchUserWizardStep={batchUserWizardStep}
          setBatchUserWizardStep={setBatchUserWizardStep}
          batchUserError={batchUserError}
          setBatchUserError={setBatchUserError}
          busy={busy}
          classPickerOptions={classPickerOptions}
          submitBatchUsers={submitBatchUsers}
        />
      )}
      {batchCredentials && (
        <BatchCredentialsModal
          batchCredentials={batchCredentials}
          exportBatchCredentials={exportBatchCredentials}
          setBatchCredentials={setBatchCredentials}
        />
      )}
      <div className="device-status__heading user-management__heading">
        <div>
          <h2>{canReadUsers ? '用户与权限' : '我的账户'}</h2>
          <p>
            {canReadUsers
              ? '为不同管理员分配可编辑内容和年级、班级范围。所有限制均由服务端再次校验。'
              : '管理当前账号的登录用户名和密码。'}
          </p>
        </div>
        <div className="user-management__heading-actions">
          <button
            className="admin-btn"
            onClick={() => {
              setUsernameDraft({
                currentPassword: '',
                username: current?.username ?? '',
              });
              setUsernameOpen(true);
            }}
          >
            修改用户名
          </button>
          <button className="admin-btn" onClick={() => setPasswordOpen(true)}>
            修改密码
          </button>
          {section === 'users' && canCreateUser && (
            <>
              <button
                className="admin-btn"
                onClick={() => {
                  setBatchUserError('');
                  setBatchUserDraft({
                    prefix: 'class_admin',
                    password: '',
                    classIds: [],
                  });
                }}
              >
                批量添加班级管理员
              </button>
              <button className="admin-btn admin-btn--primary" onClick={beginCreateUser}>
                添加用户
              </button>
            </>
          )}
        </div>
      </div>
      <AccountEmailBinding />
      {current?.mustChangePassword && (
        <div className="admin-info-banner admin-info-banner--warn">
          当前使用的是初始账户信息。请先设置自己的用户名和新密码，完成后重新登录。
        </div>
      )}
      {canReadUsers && (
        <div className="user-management__tabs">
          <button className={section === 'users' ? 'is-active' : ''} onClick={() => setSection('users')}>
            管理员
          </button>
          {canManageRoles && (
            <button className={section === 'roles' ? 'is-active' : ''} onClick={() => setSection('roles')}>
              角色权限
            </button>
          )}
          {canReadAudit && (
            <button className={section === 'audit' ? 'is-active' : ''} onClick={() => setSection('audit')}>
              操作日志
            </button>
          )}
        </div>
      )}
      {message && (
        <div className="admin-info-banner" aria-live="polite">
          {message}
        </div>
      )}
      {/* 刷新时保留上一次的用户/角色数据，只有「首次加载、手里还没有任何数据」才用占位。 */}
      {loading && users.length === 0 && roles.length === 0 ? (
        <div className="admin-loading">正在读取用户权限…</div>
      ) : !canReadUsers ? (
        <section className="user-management__account-card">
          <span>当前账号</span>
          <strong>{current?.displayName}</strong>
          <code>@{current?.username}</code>
          <small>{current?.roleName}</small>
        </section>
      ) : section === 'users' ? (
        <UserListSection
          users={users}
          roles={roles}
          grades={grades}
          classes={classes}
          visibleGrades={visibleGrades}
          current={current}
          busy={busy}
          canEditUser={canEditUser}
          canDeleteUser={canDeleteUser}
          canResetPassword={canResetPassword}
          searchQuery={searchQuery}
          roleFilter={roleFilter}
          statusFilter={statusFilter}
          filteredUsers={filteredUsers}
          userGroups={userGroups}
          selectedUserIds={selectedUserIds}
          batchDeleteMode={batchDeleteMode}
          batchDeleteGradeId={batchDeleteGradeId}
          collapsedGroups={collapsedGroups}
          menuUser={menuUser}
          setSearchQuery={setSearchQuery}
          setRoleFilter={setRoleFilter}
          setStatusFilter={setStatusFilter}
          setSelectedUserIds={setSelectedUserIds}
          setBatchDeleteMode={setBatchDeleteMode}
          setBatchDeleteGradeId={setBatchDeleteGradeId}
          setCollapsedGroups={setCollapsedGroups}
          beginEditUser={beginEditUser}
          removeSelectedUsers={removeSelectedUsers}
          toggleMenu={toggleMenu}
        />
      ) : section === 'roles' ? (
        <RoleSection
          canManageRoles={canManageRoles}
          roles={roles}
          selectedRoleId={selectedRoleId}
          selectRole={selectRole}
          selectedRole={selectedRole}
          matrixDraft={matrixDraft}
          setMatrixDraft={setMatrixDraft}
          setMatrixModuleLevel={setMatrixModuleLevel}
          busy={busy}
          saveMatrixRole={saveMatrixRole}
          setRoleError={setRoleError}
          setRoleDraft={setRoleDraft}
          rolePermissionGroups={rolePermissionGroups}
          canGrantLevel={canGrantLevel}
        />
      ) : (
        <AuditSection logs={logs} />
      )}

      {menuUser &&
        menuRect &&
        (() => {
          const target = users.find((user) => String(user.id) === menuUser) ?? null;
          if (!target) return null;
          const itemCount =
            (canResetPassword && target.id !== current?.id ? 1 : 0) +
            (canDeleteUser && target.id !== current?.id ? 1 : 0) +
            (target.id === current?.id ? 1 : 0);
          const menuWidth = 148;
          const menuHeight = itemCount * 34 + 14;
          const left = Math.min(Math.max(menuRect.left - menuWidth, 8), window.innerWidth - menuWidth - 8);
          const openUp = menuRect.top + 8 + menuHeight > window.innerHeight;
          const top = openUp ? Math.max(menuRect.top - menuHeight - 6, 8) : menuRect.top + 6;
          return (
            <AdminModalPortal className="user-management__menu-layer">
              <button
                type="button"
                className="user-management__menu-backdrop"
                aria-label="关闭菜单"
                onClick={() => {
                  setMenuUser(null);
                  setMenuRect(null);
                }}
              />
              <div className="user-management__menu" role="menu" style={{ left, top }}>
                {canResetPassword && target.id !== current?.id && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuUser(null);
                      setMenuRect(null);
                      setResetTarget(target);
                      setResetMode('generated');
                      setResetPassword(generateTemporaryPassword());
                      setResetError('');
                    }}
                  >
                    重置密码
                  </button>
                )}
                {canDeleteUser && target.id !== current?.id && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuUser(null);
                      setMenuRect(null);
                      void removeUser(target);
                    }}
                  >
                    删除
                  </button>
                )}
                {target.id === current?.id && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuUser(null);
                      setMenuRect(null);
                      setPasswordOpen(true);
                    }}
                  >
                    修改密码
                  </button>
                )}
              </div>
            </AdminModalPortal>
          );
        })()}
      {userDraft && (
        <UserWizardModal
          userDraft={userDraft}
          setUserDraft={setUserDraft}
          userWizardStep={userWizardStep}
          setUserWizardStep={setUserWizardStep}
          userErrors={userErrors}
          setUserErrors={setUserErrors}
          formError={userFormError}
          setFormError={setUserFormError}
          busy={busy}
          classPickerOptions={classPickerOptions}
          visibleGrades={visibleGrades}
          classes={classes}
          canAssignAll={canAssignAll}
          delegableRoles={delegableRoles}
          submitUser={submitUser}
        />
      )}
      {roleDraft && (
        <RoleWizardModal
          roleDraft={roleDraft}
          setRoleDraft={setRoleDraft}
          roleWizardStep={roleWizardStep}
          setRoleWizardStep={setRoleWizardStep}
          roleError={roleError}
          setRoleError={setRoleError}
          setRoleModuleLevel={setRoleModuleLevel}
          submitRole={submitRole}
          busy={busy}
          canGrantLevel={canGrantLevel}
        />
      )}
      {resetTarget && (
        <ResetPasswordModal
          resetTarget={resetTarget}
          resetError={resetError}
          resetMode={resetMode}
          resetPassword={resetPassword}
          setResetError={setResetError}
          setResetMode={setResetMode}
          setResetPassword={setResetPassword}
          setResetTarget={setResetTarget}
          submitReset={submitReset}
          busy={busy}
        />
      )}
      {issuedPassword && (
        <IssuedPasswordModal
          issuedPassword={issuedPassword}
          copyStatus={copyStatus}
          setCopyStatus={setCopyStatus}
          setIssuedPassword={setIssuedPassword}
        />
      )}
      {passwordOpen && (
        <OwnPasswordModal
          passwordDraft={passwordDraft}
          setPasswordDraft={setPasswordDraft}
          passwordErrors={passwordErrors}
          setPasswordErrors={setPasswordErrors}
          setPasswordOpen={setPasswordOpen}
          submitOwnPassword={submitOwnPassword}
          busy={busy}
          forcePasswordChange={forcePasswordChange}
          mustChangePassword={current?.mustChangePassword === true}
        />
      )}
      {usernameOpen && (
        <OwnUsernameModal
          usernameDraft={usernameDraft}
          setUsernameDraft={setUsernameDraft}
          usernameError={usernameError}
          setUsernameError={setUsernameError}
          setUsernameOpen={setUsernameOpen}
          submitOwnUsername={submitOwnUsername}
          busy={busy}
        />
      )}
    </main>
  );
}
