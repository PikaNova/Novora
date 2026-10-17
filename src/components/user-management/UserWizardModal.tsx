// 单个管理员创建/编辑向导弹窗。状态与提交逻辑由 UserManagementPanel 持有。
import AdminModalPortal from '../AdminModalPortal';
import AdminWizardSteps, { AdminWorkflowClose } from '../AdminWizardSteps';
import InlineSelect from '../InlineSelect';
import ClassMultiPicker, { type ClassPickerOption } from '../ClassMultiPicker';
import type { SchoolGrade, SchoolClass } from '../../types/school';
import type { ManagedRole } from '../../services/adminUsers';
import { validateUserDraftFields, validateUserScopes } from './helpers';
import type { UserDraft } from './types';

export type UserWizardModalProps = {
  userDraft: UserDraft;
  setUserDraft: React.Dispatch<React.SetStateAction<UserDraft | null>>;
  userWizardStep: number;
  setUserWizardStep: React.Dispatch<React.SetStateAction<number>>;
  userErrors: Record<string, string>;
  setUserErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /** 表单级错误（没有具体字段的接口错误）：显示在弹窗顶部，不能只写进被遮罩挡住的面板横幅。 */
  formError: string;
  setFormError: (message: string) => void;
  busy: boolean;
  classPickerOptions: ClassPickerOption[];
  visibleGrades: SchoolGrade[];
  classes: SchoolClass[];
  canAssignAll: boolean;
  delegableRoles: ManagedRole[];
  submitUser: () => Promise<void> | void;
};

export function UserWizardModal({
  userDraft,
  setUserDraft,
  userWizardStep,
  setUserWizardStep,
  userErrors,
  setUserErrors,
  formError,
  setFormError,
  busy,
  classPickerOptions,
  visibleGrades,
  classes,
  canAssignAll,
  delegableRoles,
  submitUser,
}: UserWizardModalProps) {
  return (
    <AdminModalPortal className="admin-modal-overlay">
      <div className="admin-modal admin-modal--wide admin-modal--workflow" onClick={(event) => event.stopPropagation()}>
        <h2 className="admin-modal__title admin-workflow-head">{userDraft.id ? '编辑管理员' : '添加管理员'}</h2>
        <AdminWorkflowClose
          onClick={() => {
            setUserDraft(null);
            setUserErrors({});
            setFormError('');
          }}
        />
        {formError && <div className="admin-error">{formError}</div>}
        <div className="admin-workflow-layout">
          <AdminWizardSteps
            active={userWizardStep}
            steps={[
              { label: '账户信息', hint: '用户名、名称和角色' },
              { label: '管理范围', hint: '年级与班级权限' },
              { label: '确认保存', hint: '检查账户配置' },
            ]}
            summary={
              <>
                <span>当前账户</span>
                <strong>{userDraft.displayName || userDraft.username || '尚未填写'}</strong>
                <span>{delegableRoles.find((role) => role.id === userDraft.roleId)?.name || '尚未选择角色'}</span>
              </>
            }
          />
          <div className="admin-workflow-content" key={userWizardStep}>
            {userWizardStep === 0 && (
              <div className="admin-workflow-pane">
                <div className="user-editor__grid">
                  <label className="admin-label">
                    用户名
                    <input
                      className="admin-input"
                      disabled={!!userDraft.id}
                      value={userDraft.username}
                      onChange={(event) => {
                        setUserErrors((value) => ({ ...value, username: '' }));
                        setUserDraft((value) => value && { ...value, username: event.target.value });
                      }}
                      placeholder="如：grade3_admin"
                    />
                    {userErrors.username && <small className="admin-field-error">{userErrors.username}</small>}
                  </label>
                  <label className="admin-label">
                    显示名称
                    <input
                      className="admin-input"
                      value={userDraft.displayName}
                      onChange={(event) => {
                        setUserErrors((value) => ({ ...value, displayName: '' }));
                        setUserDraft((value) => value && { ...value, displayName: event.target.value });
                      }}
                      placeholder="如：高三教务"
                    />
                    {userErrors.displayName && <small className="admin-field-error">{userErrors.displayName}</small>}
                  </label>
                  {!userDraft.id && (
                    <label className="admin-label">
                      初始密码
                      <input
                        className="admin-input"
                        type="password"
                        value={userDraft.password}
                        onChange={(event) => {
                          setUserErrors((value) => ({ ...value, password: '' }));
                          setUserDraft((value) => value && { ...value, password: event.target.value });
                        }}
                        placeholder="至少 8 位"
                      />
                      {userErrors.password && <small className="admin-field-error">{userErrors.password}</small>}
                    </label>
                  )}
                  <label className="admin-label">
                    角色
                    <InlineSelect
                      className="admin-input"
                      value={userDraft.roleId}
                      onChange={(roleId) => {
                        setUserErrors((value) => ({ ...value, roleId: '', scopes: '' }));
                        setUserDraft(
                          (value) =>
                            value && {
                              ...value,
                              roleId,
                              gradeIds: roleId === 'class_admin' ? [] : value.gradeIds,
                              classIds: roleId === 'grade_admin' ? [] : value.classIds,
                            },
                        );
                      }}
                      options={delegableRoles.map((role) => ({ value: role.id, label: role.name }))}
                    />
                    {userErrors.roleId && <small className="admin-field-error">{userErrors.roleId}</small>}
                  </label>
                  {userDraft.id && (
                    <label className="admin-label">
                      状态
                      <InlineSelect
                        className="admin-input"
                        value={userDraft.status}
                        onChange={(status) =>
                          setUserDraft(
                            (value) =>
                              value && {
                                ...value,
                                status: status as UserDraft['status'],
                              },
                          )
                        }
                        options={[
                          { value: 'active', label: '启用' },
                          { value: 'disabled', label: '停用' },
                        ]}
                      />
                    </label>
                  )}
                </div>
              </div>
            )}
            {userWizardStep === 1 && (
              <div className="admin-workflow-pane">
                <div className="user-editor__scope">
                  {canAssignAll && (
                    <label className="admin-toggle-label">
                      <input
                        type="checkbox"
                        checked={userDraft.allScope || userDraft.roleId === 'super_admin'}
                        disabled={userDraft.roleId === 'super_admin'}
                        onChange={(event) =>
                          setUserDraft((value) => value && { ...value, allScope: event.target.checked })
                        }
                      />
                      管理全校数据
                    </label>
                  )}
                  {!userDraft.allScope && userDraft.roleId !== 'super_admin' && (
                    <>
                      {userDraft.roleId !== 'class_admin' && (
                        <>
                          <h3>可管理年级</h3>
                          <div className="admin-major-targets">
                            {visibleGrades.map((grade) => (
                              <label key={grade.id}>
                                <input
                                  type="checkbox"
                                  checked={userDraft.gradeIds.includes(grade.id)}
                                  onChange={(event) => {
                                    setUserErrors((value) => ({
                                      ...value,
                                      scopes: '',
                                    }));
                                    setUserDraft(
                                      (value) =>
                                        value && {
                                          ...value,
                                          gradeIds: event.target.checked
                                            ? [...value.gradeIds, grade.id]
                                            : value.gradeIds.filter((id) => id !== grade.id),
                                        },
                                    );
                                  }}
                                />
                                {grade.name}
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                      <h3>{userDraft.roleId === 'class_admin' ? '指定管理班级' : '额外指定班级'}</h3>
                      <ClassMultiPicker
                        options={classPickerOptions}
                        selectedIds={userDraft.classIds}
                        onChange={(ids) => {
                          setUserErrors((value) => ({ ...value, scopes: '' }));
                          setUserDraft((value) => value && { ...value, classIds: ids });
                        }}
                      />
                      {userErrors.scopes && <small className="admin-field-error">{userErrors.scopes}</small>}
                    </>
                  )}
                </div>
              </div>
            )}
            {userWizardStep === 2 && (
              <div className="admin-workflow-pane">
                <div className="admin-workflow-review">
                  <span>
                    登录用户名<strong>{userDraft.username}</strong>
                  </span>
                  <span>
                    显示名称<strong>{userDraft.displayName}</strong>
                  </span>
                  <span>
                    账户角色
                    <strong>
                      {delegableRoles.find((role) => role.id === userDraft.roleId)?.name || userDraft.roleId}
                    </strong>
                  </span>
                  <span>
                    管理年级
                    <strong>
                      {userDraft.allScope || userDraft.roleId === 'super_admin'
                        ? '全校'
                        : userDraft.roleId === 'class_admin'
                          ? `${new Set(userDraft.classIds.map((classId) => classes.find((item) => item.id === classId)?.gradeId).filter(Boolean)).size} 个年级`
                          : `${userDraft.gradeIds.length} 个年级`}
                    </strong>
                  </span>
                  <span>
                    {userDraft.roleId === 'class_admin' ? '管理班级' : '额外班级'}
                    <strong>
                      {userDraft.allScope || userDraft.roleId === 'super_admin'
                        ? '无需单独指定'
                        : `${userDraft.classIds.length} 个班级`}
                    </strong>
                  </span>
                  {userDraft.id && (
                    <span>
                      账户状态<strong>{userDraft.status === 'active' ? '启用' : '停用'}</strong>
                    </span>
                  )}
                </div>
                {userErrors.scopes && <small className="admin-field-error">{userErrors.scopes}</small>}
              </div>
            )}
          </div>
        </div>
        <div className="admin-modal__actions">
          <button
            className="admin-btn"
            onClick={
              userWizardStep === 0
                ? () => {
                    setUserDraft(null);
                    setUserErrors({});
                  }
                : () => setUserWizardStep((value) => value - 1)
            }
          >
            {userWizardStep === 0 ? '取消' : '上一步'}
          </button>
          {userWizardStep < 2 ? (
            <button
              className="admin-btn admin-btn--primary admin-workflow-actions-spacer"
              onClick={() => {
                if (userWizardStep === 0) {
                  const stepErrors = validateUserDraftFields(userDraft);
                  if (Object.keys(stepErrors).length) {
                    setUserErrors((value) => ({ ...value, ...stepErrors }));
                    return;
                  }
                }
                if (userWizardStep === 1) {
                  const scopeError = validateUserScopes(userDraft);
                  if (scopeError) {
                    setUserErrors((value) => ({ ...value, scopes: scopeError }));
                    return;
                  }
                }
                setUserWizardStep((value) => value + 1);
              }}
            >
              下一步
            </button>
          ) : (
            <button
              className="admin-btn admin-btn--primary admin-workflow-actions-spacer"
              disabled={busy}
              onClick={() => void submitUser()}
            >
              {busy ? '保存中…' : '保存管理员'}
            </button>
          )}
        </div>
      </div>
    </AdminModalPortal>
  );
}
