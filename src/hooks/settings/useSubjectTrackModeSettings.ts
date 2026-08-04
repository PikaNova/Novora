import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAppSettings, updateExamSettings } from "../../utils/appSettings";
import { saveExamsToServer } from "../../services/examService";
import { buildExamSaveInput } from "../../utils/settings/buildExamSaveInput";
import { formatApiError } from "../../services/apiError";
import { notify } from "../../services/notify";

export function useSubjectTrackModeSettings(canEditSettings: boolean) {
  const [subjectTrackModeEnabled, setSubjectTrackModeEnabled] = useState(
    () =>
      getAppSettings().exam.initialization.subjectTrackModeEnabled !== false,
  );
  const [subjectTrackModeSave, setSubjectTrackModeSave] = useState("");
  const [subjectTrackModeSaving, setSubjectTrackModeSaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const syncSubjectTrackMode = () => {
      setSubjectTrackModeEnabled(
        getAppSettings().exam.initialization.subjectTrackModeEnabled !== false,
      );
    };
    window.addEventListener("storage", syncSubjectTrackMode);
    window.addEventListener("exam-board:settings-changed", syncSubjectTrackMode);
    return () => {
      window.removeEventListener("storage", syncSubjectTrackMode);
      window.removeEventListener("exam-board:settings-changed", syncSubjectTrackMode);
    };
  }, []);

  const saveSubjectTrackMode = async (enabled: boolean) => {
    if (!canEditSettings || subjectTrackModeSaving) return;
    const exam = getAppSettings().exam;
    const initialization = {
      ...exam.initialization,
      subjectTrackModeEnabled: enabled,
    };
    setSubjectTrackModeEnabled(enabled);
    setSubjectTrackModeSaving(true);
    setSubjectTrackModeSave("正在保存到云端…");
    updateExamSettings({ initialization, updatedAt: Date.now() });
    const result = await saveExamsToServer(
      buildExamSaveInput({
        initialization,
        clientSyncLabel: enabled ? "开启分科模式" : "关闭分科模式",
        clientQueueKey: "settings:subject-track-mode",
      })
    );
    if (result === "unauthorized") {
      setSubjectTrackModeSaving(false);
      navigate("/login?next=/settings", { replace: true });
      return;
    }
    if (typeof result === "number") {
      updateExamSettings({ initialization, updatedAt: result });
      setSubjectTrackModeSave("已保存到云端");
      notify("success", enabled ? "分科模式已开启。" : "分科模式已关闭。");
    } else {
      const message =
        result && typeof result === "object" && result.kind === "error"
          ? formatApiError(result.error, "分科模式保存失败")
          : "分科模式保存失败，请刷新后重试。";
      setSubjectTrackModeEnabled(exam.initialization.subjectTrackModeEnabled !== false);
      updateExamSettings({ initialization: exam.initialization });
      setSubjectTrackModeSave(message);
      notify("error", message, "保存失败");
    }
    setSubjectTrackModeSaving(false);
  };

  return {
    subjectTrackModeEnabled,
    subjectTrackModeSave,
    subjectTrackModeSaving,
    saveSubjectTrackMode,
  };
}
