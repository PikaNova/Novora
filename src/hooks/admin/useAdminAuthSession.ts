import { useEffect, useState } from "react";
import {
  getAdminUser,
  shouldPromptGradeAdminSetup,
  type AdminUserContext,
} from "../../services/examService";
import { getCachedDeviceBinding } from "../../services/classBinding";

// Owns admin authentication/session-local state: readiness gate, the current
// admin user context, the locally cached device-binding info shown in the
// devices tab, and the one-shot "first grade admin should finish setup" nudge.
export function useAdminAuthSession() {
  // The local user cache is only a bootstrap hint. Wait for the sync engine to
  // validate it with the server before rendering permission-gated controls.
  const [ready, setReady] = useState(false);
  const [adminUser, setAdminUser] = useState<AdminUserContext | null>(() =>
    getAdminUser(),
  );
  const [currentDeviceBinding, setCurrentDeviceBinding] = useState(
    () => getCachedDeviceBinding() ?? null,
  );
  const [gradeAdminSetupPromptOpen, setGradeAdminSetupPromptOpen] =
    useState(false);

  useEffect(() => {
    if (shouldPromptGradeAdminSetup(adminUser))
      setGradeAdminSetupPromptOpen(true);
  }, [adminUser]);

  useEffect(() => {
    const refreshBinding = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      setCurrentDeviceBinding(detail ?? getCachedDeviceBinding() ?? null);
    };
    window.addEventListener("exam-board:binding-updated", refreshBinding);
    window.addEventListener("exam-board:device-revoked", refreshBinding);
    return () => {
      window.removeEventListener("exam-board:binding-updated", refreshBinding);
      window.removeEventListener("exam-board:device-revoked", refreshBinding);
    };
  }, []);

  return {
    ready,
    setReady,
    adminUser,
    setAdminUser,
    currentDeviceBinding,
    setCurrentDeviceBinding,
    gradeAdminSetupPromptOpen,
    setGradeAdminSetupPromptOpen,
  };
}
