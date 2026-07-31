import { useRef, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { logoutAdmin } from "../../services/examService";
import type { InitializationState } from "../../utils/settings/school";
import type { AdminTab } from "../../types/exam";

// Owns the first-run school-initialization wizard's open state and the
// persisted initialization record (mirrored into a ref for synchronous reads
// from other domains' commit/build-payload logic).
export function useInitializationWizard(params: {
  initialValue: InitializationState;
  setAdminTab: (tab: AdminTab) => void;
  navigate: NavigateFunction;
}) {
  const { initialValue, setAdminTab, navigate } = params;
  const [initialization, setInitialization] =
    useState<InitializationState>(initialValue);
  const initializationRef = useRef<InitializationState>(initialValue);
  initializationRef.current = initialization;
  const [wizardOpen, setWizardOpen] = useState(false);

  const finalizeInitialization = () => {
    setWizardOpen(false);
    setAdminTab("classes");
    logoutAdmin();
    navigate("/login?next=/admin&passwordChanged=1", { replace: true });
  };

  return {
    initialization,
    setInitialization,
    initializationRef,
    wizardOpen,
    setWizardOpen,
    finalizeInitialization,
  };
}
