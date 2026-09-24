import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { adminCan, type AdminUserContext } from '../../services/examService';
import { ADMIN_NAV, adminSectionUrl } from './adminRoutes';

// Owns the admin-shell navigation concerns that are NOT part of the route: the
// "more" menu (mobile nav overflow) placement/visibility and the
// permission-denied banner.
//
// Which tab is active now comes from the URL (`/admin/<板块>`), so switching tabs
// is a navigation rather than a local state write — that is what keeps a refresh
// on the same section. Deep-link parsing and the post-auth fallback live in
// adminRoutes.ts / AdminPage, since they need the URL and the permissions.
export function useAdminModals(params: {
  adminUser: AdminUserContext | null;
  navigate: NavigateFunction;
  locationSearch: string;
}) {
  const { adminUser, navigate, locationSearch } = params;
  const [deniedModule, setDeniedModule] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreMenuStyle, setMoreMenuStyle] = useState<CSSProperties>({});
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);

  const placeMoreMenu = useCallback(() => {
    const rect = moreTriggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const edge = 14;
    const width = Math.min(280, window.innerWidth - edge * 2);
    const estimatedHeight = 280;
    const below = window.innerHeight - rect.bottom - edge;
    const above = rect.top - edge;
    const openUp = below < Math.min(estimatedHeight, 180) && above > below;
    setMoreMenuStyle({
      position: 'fixed',
      width,
      left: Math.max(edge, Math.min(rect.right - width, window.innerWidth - width - edge)),
      ...(openUp ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
      maxHeight: `${Math.max(160, (openUp ? above : below) - 8)}px`,
    });
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    placeMoreMenu();
    window.addEventListener('resize', placeMoreMenu);
    window.addEventListener('scroll', placeMoreMenu, true);
    return () => {
      window.removeEventListener('resize', placeMoreMenu);
      window.removeEventListener('scroll', placeMoreMenu, true);
    };
  }, [moreOpen, placeMoreMenu]);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.admin-more')) setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [moreOpen]);

  const can = useCallback((permission: string) => adminCan(permission, adminUser), [adminUser]);

  const openMyAccount = useCallback(() => {
    setDeniedModule('');
    navigate(adminSectionUrl({ tab: 'users', search: locationSearch, extra: { account: '1' } }));
    setMoreOpen(false);
  }, [navigate, locationSearch]);

  const selectAdminTab = useCallback(
    (item: (typeof ADMIN_NAV)[number]) => {
      if (item.id === 'users' && !can(item.permission)) {
        openMyAccount();
        return;
      }
      if (!can(item.permission)) {
        setDeniedModule(item.label);
        return;
      }
      setDeniedModule('');
      navigate(adminSectionUrl({ tab: item.id, search: locationSearch }));
    },
    [can, openMyAccount, navigate, locationSearch],
  );

  return {
    deniedModule,
    setDeniedModule,
    moreOpen,
    setMoreOpen,
    moreMenuStyle,
    moreTriggerRef,
    placeMoreMenu,
    can,
    openMyAccount,
    selectAdminTab,
  };
}
