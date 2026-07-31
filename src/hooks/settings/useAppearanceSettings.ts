import { useMemo, useState } from "react";
import {
  getAppSettings,
  updateAppSettings,
  DEFAULT_TYPOGRAPHY,
  updateMotionMode,
} from "../../utils/appSettings";
import type {
  TypographyFontId,
  TypographySettings,
  MotionMode,
} from "../../utils/appSettings";
import { applyTypographySettings } from "../../utils/typographySettings";
import { applyMotionSettings } from "../../utils/motionSettings";
import { getDesignId, setDesignId } from "../../utils/designPref";
import { notify } from "../../services/notify";

export function useAppearanceSettings() {
  const [designId, setDesign] = useState<string>(() => getDesignId());
  const [typography, setTypography] = useState<TypographySettings>(
    () => getAppSettings().general.typography,
  );
  const [motionMode, setMotionMode] = useState<MotionMode>(
    () => getAppSettings().general.motionMode,
  );
  const initialExam = useMemo(() => getAppSettings().exam, []);
  const schoolDesignRule = initialExam.designPolicy.rules.find(
    (rule) => rule.scope === "school",
  );

  const patchDesign = (id: string) => {
    if (schoolDesignRule) {
      notify(
        "warning",
        "全校设计正在生效，请先由管理员在设备管理中删除全校设计。",
      );
      return;
    }
    setDesignId(id);
    setDesign(id);
  };

  const patchMotion = (m: MotionMode) => {
    updateMotionMode(m);
    setMotionMode(m);
    applyMotionSettings(m);
  };
  const patchTypography = (
    role: keyof TypographySettings,
    font: TypographyFontId,
  ) => {
    const next = { ...typography, [role]: font };
    updateAppSettings((c) => ({ general: { ...c.general, typography: next } }));
    setTypography(next);
    applyTypographySettings(next);
  };

  const resetTypography = () => {
    const next = { ...DEFAULT_TYPOGRAPHY };
    updateAppSettings((c) => ({ general: { ...c.general, typography: next } }));
    setTypography(next);
    applyTypographySettings(next);
    notify("success", "字体分区已恢复为设计默认值。");
  };

  return {
    designId,
    typography,
    motionMode,
    schoolDesignRule,
    patchDesign,
    patchMotion,
    patchTypography,
    resetTypography,
  };
}
