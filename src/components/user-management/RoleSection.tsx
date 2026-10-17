import React from 'react';
import Mascot from '../Mascot';
import { ROLE_MODULES, moduleLevel, permissionMeta, type RoleLevel } from '../../constants/permissions';
import type { ManagedRole } from '../../services/adminUsers';
import type { RoleDraft } from './types';

export interface RoleSectionProps {
  canManageRoles: boolean;
  roles: ManagedRole[];
  selectedRoleId: string | null;
  selectRole: (role: ManagedRole) => void;
  selectedRole: ManagedRole | null;
  matrixDraft: RoleDraft | null;
  setMatrixDraft: React.Dispatch<React.SetStateAction<RoleDraft | null>>;
  setMatrixModuleLevel: (module: (typeof ROLE_MODULES)[number], level: RoleLevel) => void;
  busy: boolean;
  saveMatrixRole: () => void | Promise<void>;
  setRoleError: (message: string) => void;
  setRoleDraft: React.Dispatch<React.SetStateAction<RoleDraft | null>>;
  /** 当前账号能不能把这个模块设到这个级别；不能就禁用格子（服务端一定会拒）。 */
  canGrantLevel: (module: (typeof ROLE_MODULES)[number], level: RoleLevel) => boolean;
  rolePermissionGroups: (
    role: ManagedRole,
    draft: RoleDraft | null,
  ) => Array<{ prefix: string; label: string; items: string[] }>;
}

export default function RoleSection(props: RoleSectionProps) {
  const {
    canManageRoles,
    roles,
    selectedRoleId,
    selectRole,
    selectedRole,
    matrixDraft,
    setMatrixDraft,
    setMatrixModuleLevel,
    busy,
    saveMatrixRole,
    setRoleError,
    setRoleDraft,
    canGrantLevel,
    rolePermissionGroups,
  } = props;
  return (
    <div className="user-management__role-layout">
      <aside className="user-management__role-list">
        {canManageRoles && (
          <button
            className="admin-btn admin-btn--primary user-management__new-role"
            onClick={() => {
              setRoleError('');
              setRoleDraft({ name: '', description: '', permissions: [] });
            }}
          >
            新建角色
          </button>
        )}
        {roles.map((role) => (
          <button
            type="button"
            key={role.id}
            className={'user-management__role-item' + (selectedRoleId === role.id ? ' is-active' : '')}
            aria-pressed={selectedRoleId === role.id}
            onClick={() => selectRole(role)}
          >
            <span className="user-management__role-item-main">
              <strong>{role.name}</strong>
              {role.builtIn && <em>内置</em>}
            </span>
            <small>{role.permissions.includes('*') ? '全部权限' : role.permissions.length + ' 项权限'}</small>
          </button>
        ))}
      </aside>
      <section className="user-management__role-panel" key={selectedRole ? selectedRole.id : 'none'}>
        {selectedRole ? (
          (() => {
            const permissionGroups = rolePermissionGroups(selectedRole, matrixDraft);
            const draft = matrixDraft && matrixDraft.id === selectedRole.id ? matrixDraft : null;
            const shownPermissions = draft ? draft.permissions : selectedRole.permissions;
            return (
              <>
                <div className="user-management__role-panel-head">
                  <div>
                    <strong>{selectedRole.name}</strong>
                    {selectedRole.builtIn && <span>内置</span>}
                  </div>
                  <small>{shownPermissions.includes('*') ? '全部权限' : shownPermissions.length + ' 项权限'}</small>
                </div>
                <p className="user-management__role-panel-desc">
                  {selectedRole.description || '尚未填写角色职责说明。'}
                </p>
                <div className="user-management__matrix">
                  <div className="user-management__matrix-row user-management__matrix-head">
                    <span>模块</span>
                    <span>不可访问</span>
                    <span>仅查看</span>
                    <span>可管理</span>
                  </div>
                  {ROLE_MODULES.map((module) => {
                    const level = moduleLevel(shownPermissions, module);
                    const canManage = module.manage.length > 0;
                    const readonly = selectedRole.builtIn || !draft;
                    return (
                      <div className="user-management__matrix-row" key={module.id}>
                        <span className="user-management__matrix-module">
                          <strong>{module.label}</strong>
                          <small>{canManage ? '查看或管理整个模块' : '仅控制显示'}</small>
                        </span>
                        {(['none', 'read', 'manage'] as const).map((levelKey) => {
                          const disabled = readonly || (!canManage && levelKey === 'manage');
                          const notDelegable = !readonly && !canGrantLevel(module, levelKey);
                          return (
                            <button
                              type="button"
                              key={levelKey}
                              className={
                                'user-management__matrix-cell' +
                                (level === levelKey ? ' is-active' : '') +
                                (disabled || notDelegable ? ' is-disabled' : '')
                              }
                              disabled={disabled || notDelegable}
                              title={
                                notDelegable ? '当前账号没有这些权限，无法授出（服务端会拒绝这种授权）' : undefined
                              }
                              onClick={() => {
                                if (draft) {
                                  setMatrixModuleLevel(module, levelKey);
                                }
                              }}
                            >
                              {levelKey === 'none' ? '—' : levelKey === 'read' ? '查看' : '管理'}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                {!selectedRole.builtIn && (
                  <div className="user-management__matrix-actions">
                    <button
                      className="admin-btn admin-btn--primary"
                      disabled={busy || !draft}
                      onClick={() => void saveMatrixRole()}
                    >
                      {busy ? '保存中…' : '保存角色'}
                    </button>
                    <button className="admin-btn" disabled={busy} onClick={() => setMatrixDraft(null)}>
                      放弃修改
                    </button>
                  </div>
                )}
                {permissionGroups.length > 0 && (
                  <details className="user-management__role-detail">
                    <summary>
                      {shownPermissions.includes('*')
                        ? '查看全部系统权限说明'
                        : '查看 ' + shownPermissions.length + ' 项权限明细'}
                    </summary>
                    <div className="user-management__role-groups">
                      {permissionGroups.map((group) => (
                        <section key={group.prefix}>
                          <b>{group.label}</b>
                          <ul>
                            {group.items.map((permission) => (
                              <li key={permission}>
                                <strong>{permissionMeta(permission).label}</strong>
                                <span>{permissionMeta(permission).description}</span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                  </details>
                )}
              </>
            );
          })()
        ) : (
          <div className="admin-empty">
            <Mascot className="mascot-empty" size={64} alt="" />
            <p>请选择一个角色查看权限</p>
          </div>
        )}
      </section>
    </div>
  );
}
