import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { NavigateFunction } from "react-router-dom";
import { adminCan, type AdminUserContext } from "../../services/examService";
import type { AdminTab } from "../../types/exam";

export const ADMIN_NAV: Array<{
  id: AdminTab;
  label: string;
  mobileLabel: string;
  permission: string;
}> = [
  { id: "overview", label: "仪表盘", mobileLabel: "仪表盘", permission: "overview.read" },
  { id: "major", label: "大型考试", mobileLabel: "考试", permission: "major.read" },
  { id: "weekly", label: "周测计划", mobileLabel: "周测", permission: "weekly.read" },
  { id: "classes", label: "年级与班级", mobileLabel: "班级", permission: "school.read" },
  { id: "devices", label: "设备管理", mobileLabel: "设备", permission: "device.read" },
  { id: "users", label: "用户与权限", mobileLabel: "用户", permission: "user.read" },
];

// Owns admin-shell navigation concerns: which tab is active, the "more" menu
// (mobile nav overflow) placement/visibility, the permission-denied banner,
// and tab-permission enforcement/redirect.
export function useAdminModals(params: {
  adminUser: AdminUserContext | null;
  defaultTab: AdminTab;
  navigate: NavigateFunction;
  locationSearch: string;
}) {
  const { adminUser, defaultTab, navigate, locationSearch } = params;
  const [adminTab, setAdminTab] = useState<AdminTab>(defaultTab);
  const [deniedModule, setDeniedModule] = useState("");
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
      position: "fixed",
      width,
      left: Math.max(
        edge,
        Math.min(rect.right - width, window.innerWidth - width - edge),
      ),
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + 8 }
        : { top: rect.bottom + 8 }),
      maxHeight: `${Math.max(160, (openUp ? above : below) - 8)}px`,
    });
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    placeMoreMenu();
    window.addEventListener("resize", placeMoreMenu);
    window.addEventListener("scroll", placeMoreMenu, true);
    return () => {
      window.removeEventListener("resize", placeMoreMenu);
      window.removeEventListener("scroll", placeMoreMenu, true);
    };
  }, [moreOpen, placeMoreMenu]);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".admin-more")
      )
        setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!adminUser) return;
    if (adminUser.mustChangePassword) {
      if (adminTab !== "users") setAdminTab("users");
      return;
    }
    const accountView =
      new URLSearchParams(locationSearch).get("account") === "1";
    if (adminTab === "users" && accountView) return;
    const permissionByTab: Record<AdminTab, string> = {
      overview: "overview.read",
      major: "major.read",
      weekly: "weekly.read",
      classes: "school.read",
      devices: "device.read",
      users: "user.read",
    };
    if (adminCan(permissionByTab[adminTab], adminUser)) return;
    const next = (Object.keys(permissionByTab) as AdminTab[]).find((tab) =>
      adminCan(permissionByTab[tab], adminUser),
    );
    if (next) setAdminTab(next);
  }, [adminTab, adminUser, locationSearch]);

  const can = useCallback(
    (permission: string) => adminCan(permission, adminUser),
    [adminUser],
  );

  const openMyAccount = useCallback(() => {
    setDeniedModule("");
    navigate("/admin?tab=users&account=1");
    setAdminTab("users");
    setMoreOpen(false);
  }, [navigate]);

  const selectAdminTab = useCallback(
    (item: (typeof ADMIN_NAV)[number]) => {
      if (item.id === "users" && !can(item.permission)) {
        openMyAccount();
        return;
      }
      if (!can(item.permission)) {
        setDeniedModule(item.label);
        return;
      }
      setDeniedModule("");
      setAdminTab(item.id);
    },
    [can, openMyAccount],
  );

  return {
    adminTab,
    setAdminTab,
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
