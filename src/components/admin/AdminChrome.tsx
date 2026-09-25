// 后台管理布局外壳：顶栏、更多菜单、移动端底部导航。
// 与 AdminPage 解耦：只接收展示所需数据与回调，页面编排逻辑留在 AdminPage。
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { AdminTab } from '../../types/exam';
import type { SyncState } from '../../hooks/admin/adminPageUtils';
import { ADMIN_NAV } from '../../hooks/admin/adminRoutes';
import type { AdminUserContext } from '../../services/examService';
import { logoutAdmin } from '../../services/examService';
import type { DeviceBinding } from '../../services/classBinding';
import BrandMark from '../BrandMark';
import ModuleIcon from '../ModuleIcon';

export const SYNC_META: Record<SyncState, { label: string; cls: string }> = {
  loading: { label: '连接中', cls: 'is-loading' },
  saving: { label: '同步中', cls: 'is-saving' },
  saved: { label: '已同步', cls: 'is-saved' },
  offline: { label: '离线 · 待同步', cls: 'is-offline' },
  error: { label: '同步失败', cls: 'is-error' },
};

export type AdminHeaderProps = {
  adminUser: AdminUserContext;
  sync: SyncState;
  online: boolean;
  alertsEnabled: boolean;
  canQuickPublish: boolean;
  canCreateMajor: boolean;
  canBatchAdd: boolean;
  canReadAlerts: boolean;
  canShowSettings: boolean;
  canExportMajor: boolean;
  showInitialization: boolean;
  showMajorChip: boolean;
  currentDeviceBinding: DeviceBinding | null;
  adminTab: AdminTab;
  activeMajorName: string;
  activeMajorScopeLabel: string;
  itemsCount: number;
  moreOpen: boolean;
  moreTriggerRef: React.RefObject<HTMLButtonElement>;
  moreMenuStyle: React.CSSProperties;
  placeMoreMenu: () => void;
  setMoreOpen: (open: boolean) => void;
  can: (permission: string) => boolean;
  onSelectAdminTab: (item: (typeof ADMIN_NAV)[number]) => void;
  onOpenMyAccount: () => void;
  onOpenBatchAdd: () => void;
  onQuickMajorOpen: () => void;
  onAlertsOpen: () => void;
  onAnnounceOpen: () => void;
  onWizardOpen: () => void;
  onExportJson: () => void;
};

export function AdminHeader({
  adminUser,
  sync,
  online,
  alertsEnabled,
  canQuickPublish,
  canCreateMajor,
  canBatchAdd,
  canReadAlerts,
  canShowSettings,
  canExportMajor,
  showInitialization,
  showMajorChip,
  currentDeviceBinding,
  adminTab,
  activeMajorName,
  activeMajorScopeLabel,
  itemsCount,
  moreOpen,
  moreTriggerRef,
  moreMenuStyle,
  placeMoreMenu,
  setMoreOpen,
  can,
  onSelectAdminTab,
  onOpenMyAccount,
  onOpenBatchAdd,
  onQuickMajorOpen,
  onAlertsOpen,
  onAnnounceOpen,
  onWizardOpen,
  onExportJson,
}: AdminHeaderProps) {
  const navigate = useNavigate();
  return (
    <header className="admin-header">
      <div className="admin-header__left">
        <button
          className="admin-back-btn admin-back-btn--icon"
          onClick={() => navigate('/')}
          aria-label="返回首页"
          title="返回首页"
        >
          <ArrowLeft />
        </button>
        <BrandMark compact className="admin-header__brand" />
        <div className="admin-header__identity">
          <h1 className="admin-header__title">管理后台</h1>
          <span>{ADMIN_NAV.find((item) => item.id === adminTab)?.label}</span>
        </div>
        {showMajorChip && (
          <span className="admin-header__major" title={`适用范围：${activeMajorScopeLabel}`}>
            <span className="admin-header__major-dot" />
            {activeMajorScopeLabel} · {activeMajorName}
            <span className="admin-header__major-count">{itemsCount} 科</span>
          </span>
        )}
      </div>
      <div className="admin-header__right">
        {currentDeviceBinding &&
          !currentDeviceBinding.revoked &&
          !currentDeviceBinding.isManagement &&
          currentDeviceBinding.classId && (
            <button
              type="button"
              className="admin-device-role-chip"
              title="当前为班级设备；如需更改角色，请前往设备管理"
              onClick={() => onSelectAdminTab(ADMIN_NAV.find((item) => item.id === 'devices')!)}
            >
              <strong>当前为班级设备</strong>
              <small>更改角色请前往设备管理</small>
            </button>
          )}
        <span className="admin-user-chip" title={`登录账号：${adminUser.username}`}>
          <strong>{adminUser.displayName}</strong>
          <small>{adminUser.roleName}</small>
        </span>
        <span className={`admin-cloud ${SYNC_META[sync].cls}`} title={online ? '云服务在线' : '当前离线'}>
          <span className="admin-cloud__dot" />
          {SYNC_META[sync].label}
        </span>
        <div className="admin-header__quick-actions">
          {canQuickPublish && (
            <button className="admin-btn admin-btn--primary" onClick={onQuickMajorOpen}>
              {adminUser.roleId === 'class_admin' ? '添加班级单科考试' : '统一添加单科考试'}
            </button>
          )}
          {canReadAlerts && (
            <button className="admin-btn admin-btn--primary" onClick={onAlertsOpen}>
              提醒{alertsEnabled ? '' : '（停用）'}
            </button>
          )}
          {canShowSettings && (
            <button className="admin-btn" onClick={() => navigate('/settings')}>
              系统设置
            </button>
          )}
        </div>
        <div className="admin-more">
          <button
            ref={moreTriggerRef}
            className="admin-btn admin-more__trigger"
            onClick={() => {
              if (moreOpen) {
                setMoreOpen(false);
                return;
              }
              placeMoreMenu();
              setMoreOpen(true);
            }}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
          >
            更多
          </button>
          {moreOpen && (
            <div className="admin-more__menu" style={moreMenuStyle} role="menu">
              <button
                onClick={() => {
                  onOpenMyAccount();
                  setMoreOpen(false);
                }}
              >
                我的账户
              </button>
              {currentDeviceBinding &&
                !currentDeviceBinding.revoked &&
                !currentDeviceBinding.isManagement &&
                currentDeviceBinding.classId && (
                  <button
                    className="admin-more__mobile-only"
                    onClick={() => {
                      onSelectAdminTab(ADMIN_NAV.find((item) => item.id === 'devices')!);
                      setMoreOpen(false);
                    }}
                  >
                    当前为班级设备 · 前往设备管理
                  </button>
                )}
              {canCreateMajor && (
                <button
                  className="admin-more__mobile-only"
                  onClick={() => {
                    onQuickMajorOpen();
                    setMoreOpen(false);
                  }}
                >
                  统一添加单科考试
                </button>
              )}
              {canBatchAdd && (
                <button
                  onClick={() => {
                    onOpenBatchAdd();
                    setMoreOpen(false);
                  }}
                >
                  批量添加班级管理员
                </button>
              )}
              <button
                onClick={() => {
                  onAnnounceOpen();
                  setMoreOpen(false);
                }}
              >
                查看公告
              </button>
              {canReadAlerts && (
                <button
                  className="admin-more__mobile-only"
                  onClick={() => {
                    onAlertsOpen();
                    setMoreOpen(false);
                  }}
                >
                  提醒管理{alertsEnabled ? '' : '（已停用）'}
                </button>
              )}
              {can('settings.read') && (
                <button
                  className="admin-more__mobile-only"
                  onClick={() => {
                    navigate('/settings');
                    setMoreOpen(false);
                  }}
                >
                  系统设置
                </button>
              )}
              {showInitialization && (
                <button
                  onClick={() => {
                    onWizardOpen();
                    setMoreOpen(false);
                  }}
                >
                  首次初始化
                </button>
              )}
              {canExportMajor && (
                <button
                  onClick={() => {
                    onExportJson();
                    setMoreOpen(false);
                  }}
                >
                  导出大型考试 JSON
                </button>
              )}
              <button
                className="is-danger"
                onClick={() => {
                  logoutAdmin();
                  navigate('/login?next=/admin', { replace: true });
                }}
              >
                退出登录
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export type AdminMobileNavProps = {
  adminTab: AdminTab;
  can: (permission: string) => boolean;
  onSelectAdminTab: (item: (typeof ADMIN_NAV)[number]) => void;
  onOpenMyAccount: () => void;
};

export function AdminMobileNav({ adminTab, can, onSelectAdminTab, onOpenMyAccount }: AdminMobileNavProps) {
  return (
    <nav className="admin-mobile-nav" aria-label="管理功能">
      {ADMIN_NAV.filter((item) => item.id === 'users' || can(item.permission)).map((item) => (
        <button
          key={item.id}
          className={adminTab === item.id ? 'is-active' : ''}
          onClick={() => (item.id === 'users' ? onOpenMyAccount() : onSelectAdminTab(item))}
          aria-current={adminTab === item.id ? 'page' : undefined}
        >
          <span aria-hidden="true">
            <ModuleIcon module={item.id} size={18} />
          </span>
          <small>{item.id === 'users' ? '我的账户' : item.mobileLabel}</small>
        </button>
      ))}
    </nav>
  );
}
