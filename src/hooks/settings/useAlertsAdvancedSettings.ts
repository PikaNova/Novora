import { useState } from "react";
import {
  getAppSettings,
  updateAppSettings,
  updateAlertsSettings,
  APP_SETTINGS_KEY,
} from "../../utils/appSettings";
import { confirmDialog } from "../../services/appDialog";

export type ErrMode = "off" | "memory" | "persist";

export function useAlertsAdvancedSettings() {
  const [errMode, setErrMode] = useState<ErrMode>(
    () => getAppSettings().study.alerts.errorCenterMode,
  );
  const [silentMode, setSilentMode] = useState<
    "all" | "keyOnly" | "pauseUntilExamEnd"
  >(() => getAppSettings().alerts.silentMode ?? "all");

  const patchSilentMode = (v: "all" | "keyOnly" | "pauseUntilExamEnd") => {
    setSilentMode(v);
    updateAlertsSettings({ silentMode: v });
  };

  const patchErr = (mode: ErrMode) => {
    updateAppSettings((c) => ({
      study: {
        ...c.study,
        alerts: { ...c.study.alerts, errorCenterMode: mode },
      },
    }));
    setErrMode(mode);
  };

  const resetLocal = async () => {
    if (
      !(await confirmDialog({
        title: "清除本地设置",
        message:
          "确定清除本机所有本地设置并恢复默认？\n仅影响当前浏览器，不影响云端考试数据。",
        tone: "danger",
        confirmLabel: "清除并重载",
      }))
    )
      return;
    try {
      localStorage.removeItem(APP_SETTINGS_KEY);
      localStorage.removeItem("exam_design_id");
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  return {
    errMode,
    silentMode,
    patchSilentMode,
    patchErr,
    resetLocal,
  };
}
