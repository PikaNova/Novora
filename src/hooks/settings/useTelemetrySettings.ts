import { useMemo, useState } from "react";
import {
  getConsent,
  getInstanceId,
  isEnabled,
  reportNow,
  setEnabled,
} from "../../services/telemetry";
import { notify } from "../../services/notify";

export function useTelemetrySettings() {
  const [teleOn, setTeleOn] = useState(() => isEnabled());
  const [teleMsg, setTeleMsg] = useState("");
  const instId = useMemo(() => getInstanceId(), []);
  const consent = getConsent();

  const toggleTele = (v: boolean) => {
    setEnabled(v);
    setTeleOn(v);
  };
  const reportTele = async () => {
    setTeleMsg("上报中…");
    const ok = await reportNow("manual");
    setTeleMsg(ok ? "已上报 ✓" : "上报失败或未启用");
    notify(
      ok ? "success" : "error",
      ok ? "运行信息已上报作者端。" : "上报失败或遥测尚未启用。",
      "遥测上报",
    );
  };

  return { teleOn, teleMsg, instId, consent, toggleTele, reportTele };
}
