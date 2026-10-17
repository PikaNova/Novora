// 自定义角色创建/编辑向导（含模块级权限矩阵）。状态与提交逻辑由 UserManagementPanel 持有。
import AdminModalPortal from '../AdminModalPortal';
import InlineSelect from '../InlineSelect';
import AdminWizardSteps, { AdminWorkflowClose } from '../AdminWizardSteps';
import { ROLE_MODULES, moduleLevel, type RoleLevel } from '../../constants/permissions';
import type { RoleDraft } from './types';

export type RoleWizardModalProps = {
  roleDraft: RoleDraft;
  setRoleDraft: React.Dispatch<React.SetStateAction<RoleDraft | null>>;
  roleWizardStep: number;
  setRoleWizardStep: React.Dispatch<React.SetStateAction<number>>;
  roleError: string;
  setRoleError: (message: string) => void;
  setRoleModuleLevel: (module: (typeof ROLE_MODULES)[number], level: RoleLevel) => void;
  /** 当前账号不能授出的级别在选项里禁用掉，避免"勾得动、保存被拒、还看不到原因"。 */
  canGrantLevel: (module: (typeof ROLE_MODULES)[number], level: RoleLevel) => boolean;
  submitRole: () => Promise<void> | void;
  busy: boolean;
};

export function RoleWizardModal({
  roleDraft,
  setRoleDraft,
  roleWizardStep,
  setRoleWizardStep,
  roleError,
  setRoleError,
  setRoleModuleLevel,
  canGrantLevel,
  submitRole,
  busy,
}: RoleWizardModalProps) {
  return (
    <AdminModalPortal className="admin-modal-overlay">
      <div className="admin-modal admin-modal--wide admin-modal--workflow" onClick={(event) => event.stopPropagation()}>
        <h2 className="admin-modal__title admin-workflow-head">{roleDraft.id ? '编辑自定义角色' : '新建自定义角色'}</h2>
        <AdminWorkflowClose onClick={() => setRoleDraft(null)} />
        <div className="admin-workflow-layout">
          <AdminWizardSteps
            active={roleWizardStep}
            steps={[
              { label: '角色信息', hint: '名称和职责说明' },
              { label: '模块权限', hint: '按模块选择权限级别' },
              { label: '确认保存', hint: '检查角色能力' },
            ]}
            summary={
              <>
                <span>当前角色</span>
                <strong>{roleDraft.name || '尚未命名'}</strong>
                <span>
                  {ROLE_MODULES.filter((module) => moduleLevel(roleDraft.permissions, module) !== 'none').length}{' '}
                  个可访问模块
                </span>
              </>
            }
          />
          <div className="admin-workflow-content" key={roleWizardStep}>
            {roleWizardStep === 0 && (
              <div className="admin-workflow-pane">
                <label className="admin-label">
                  角色名称
                  <input
                    className="admin-input"
                    value={roleDraft.name}
                    onChange={(event) => setRoleDraft((value) => value && { ...value, name: event.target.value })}
                  />
                </label>
                <label className="admin-label">
                  角色职责说明
                  <textarea
                    className="admin-textarea"
                    rows={2}
                    value={roleDraft.description}
                    onChange={(event) =>
                      setRoleDraft((value) => value && { ...value, description: event.target.value })
                    }
                    placeholder="说明该角色负责什么、不能做什么，分配账号时会直接展示。"
                  />
                </label>
              </div>
            )}
            {roleWizardStep === 1 && (
              <div className="admin-workflow-pane">
                <div className="role-editor__modules">
                  {ROLE_MODULES.map((module) => (
                    <label key={module.id}>
                      <span>
                        <strong>{module.label}</strong>
                        <small>{module.manage.length ? '选择查看或管理整个模块' : '控制是否显示该模块'}</small>
                      </span>
                      <InlineSelect
                        className="admin-input"
                        value={moduleLevel(roleDraft.permissions, module)}
                        onChange={(value) => setRoleModuleLevel(module, value as RoleLevel)}
                        options={[
                          { value: 'none', label: '不可访问' },
                          { value: 'read', label: '仅查看', disabled: !canGrantLevel(module, 'read') },
                          ...(module.manage.length > 0
                            ? [
                                {
                                  value: 'manage',
                                  label: '可管理',
                                  disabled: !canGrantLevel(module, 'manage'),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </label>
                  ))}
                </div>
                <p className="admin-major-card__hint">
                  数据库重置、初始化、角色管理、部署和超级管理员操作仅保留给超级管理员。
                </p>
              </div>
            )}
            {roleWizardStep === 2 && (
              <div className="admin-workflow-pane">
                <div className="admin-workflow-review">
                  <span>
                    角色名称<strong>{roleDraft.name || '未填写'}</strong>
                  </span>
                  <span>
                    职责说明<strong>{roleDraft.description || '未填写'}</strong>
                  </span>
                  {ROLE_MODULES.map((module) => (
                    <span key={module.id}>
                      {module.label}
                      <strong>
                        {moduleLevel(roleDraft.permissions, module) === 'manage'
                          ? '可管理'
                          : moduleLevel(roleDraft.permissions, module) === 'read'
                            ? '仅查看'
                            : '不可访问'}
                      </strong>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        {roleError && <div className="admin-error">{roleError}</div>}
        <div className="admin-modal__actions">
          <button
            className="admin-btn"
            onClick={roleWizardStep === 0 ? () => setRoleDraft(null) : () => setRoleWizardStep((value) => value - 1)}
          >
            {roleWizardStep === 0 ? '取消' : '上一步'}
          </button>
          {roleWizardStep < 2 ? (
            <button
              className="admin-btn admin-btn--primary admin-workflow-actions-spacer"
              onClick={() => {
                if (roleWizardStep === 0 && !roleDraft.name.trim()) {
                  setRoleError('请填写角色名称。');
                  return;
                }
                if (roleWizardStep === 1 && !roleDraft.permissions.length) {
                  setRoleError('请至少选择一项权限。');
                  return;
                }
                setRoleError('');
                setRoleWizardStep((value) => value + 1);
              }}
            >
              下一步
            </button>
          ) : (
            <button
              className="admin-btn admin-btn--primary admin-workflow-actions-spacer"
              disabled={busy}
              onClick={() => void submitRole()}
            >
              {busy ? '保存中…' : '保存角色'}
            </button>
          )}
        </div>
      </div>
    </AdminModalPortal>
  );
}
