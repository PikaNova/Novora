import { useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { logoutAdmin } from '../../services/examService';
import type { InitializationState } from '../../utils/settings/school';
import { adminSectionPath } from './adminRoutes';

// Owns the first-run school-initialization wizard's open state and the
// persisted initialization record (mirrored into a ref for synchronous reads
// from other domains' commit/build-payload logic).
export function useInitializationWizard(params: { initialValue: InitializationState; navigate: NavigateFunction }) {
  const { initialValue, navigate } = params;
  const [initialization, setInitialization] = useState<InitializationState>(initialValue);
  const initializationRef = useRef<InitializationState>(initialValue);
  initializationRef.current = initialization;
  const [wizardOpen, setWizardOpen] = useState(false);

  const finalizeInitialization = () => {
    setWizardOpen(false);
    logoutAdmin();
    // 初始化完成后要重新登录；把「回后台先看班级」写进回跳目标，别再额外推一条历史记录。
    navigate(`/login?next=${encodeURIComponent(adminSectionPath('classes'))}&passwordChanged=1`, { replace: true });
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
