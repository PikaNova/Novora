import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAppSettings, updateExamSettings } from "../../utils/appSettings";
import { saveExamsToServer } from "../../services/examService";
import { buildExamSaveInput } from "../../utils/settings/buildExamSaveInput";
import { formatApiError } from "../../services/apiError";
import { notify } from "../../services/notify";
import { schoolFullName } from "../../data/provinces";
import { reportNow } from "../../services/telemetry";

export function useSchoolInfoSettings(canEditSchool: boolean) {
  const navigate = useNavigate();
  const [schoolName, setSchoolName] = useState(
    () => getAppSettings().exam.initialization.schoolName,
  );
  const [province, setProvince] = useState(
    () => getAppSettings().exam.initialization.province,
  );
  const [schoolSave, setSchoolSave] = useState("");

  const saveSchoolName = async () => {
    const nextName = schoolName.trim();
    if (!nextName || !canEditSchool) {
      setSchoolSave(nextName ? "当前账号无权修改学校信息" : "请填写学校名称");
      return;
    }
    const exam = getAppSettings().exam;
    if (!province) {
      setSchoolSave("请选择省份或地区");
      return;
    }
    const initialization = {
      ...exam.initialization,
      province,
      schoolName: nextName,
      schoolFullName: schoolFullName(province, nextName),
      wizardVersion: Math.max(2, exam.initialization.wizardVersion),
    };
    updateExamSettings({ initialization });
    setSchoolSave("正在保存到云端…");
    const result = await saveExamsToServer(
      buildExamSaveInput({ initialization })
    );
    if (result === "unauthorized") {
      navigate("/login?next=/settings", { replace: true });
      return;
    }
    const failure =
      result && typeof result === "object" && result.kind === "error"
        ? formatApiError(result.error, "学校信息保存失败")
        : "学校信息保存失败，请刷新后重试。";
    setSchoolSave(typeof result === "number" ? "学校信息已保存" : failure);
    notify(
      typeof result === "number" ? "success" : "error",
      typeof result === "number" ? "省份与完整校名已保存。" : failure,
      typeof result === "number" ? undefined : "保存失败",
    );
    if (typeof result === "number") void reportNow("school_name_updated");
  };

  return {
    schoolName,
    setSchoolName,
    province,
    setProvince,
    schoolSave,
    saveSchoolName,
  };
}
