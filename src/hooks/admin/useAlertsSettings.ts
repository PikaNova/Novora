import { useCallback, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { AlertsSettings, AlertState, CustomReminder, MajorExam } from "../../types";
import {
  getAppSettings,
  genReminderId,
  DEFAULT_ALERTS,
  normalizeAlerts,
} from "../../utils/appSettings";

// Owns exam-alert settings (built-in state alerts + custom reminders) and the
// alerts settings modal. Writes go through the major-exam domain's `commit`
// (accessed indirectly via `commitRef`, since useMajorScheduleActions is
// initialized after this hook but alerts changes must still push/persist
// through the shared major-exam sync pipeline).
export function useAlertsSettings(params: {
  stateRef: MutableRefObject<{ majors: MajorExam[]; activeMajorId: string }>;
  commitRef: MutableRefObject<
    (ms: MajorExam[], activeId: string, immediate?: boolean, syncLabel?: string) => void
  >;
}) {
  const { stateRef, commitRef } = params;
  const [alerts, setAlerts] = useState<AlertsSettings>(
    () => getAppSettings().alerts,
  );
  const alertsRef = useRef<AlertsSettings>(alerts);
  alertsRef.current = alerts;
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alertsSection, setAlertsSection] = useState<"builtin" | "custom">(
    "builtin",
  );

  const commitAlerts = useCallback(
    (next: AlertsSettings) => {
      alertsRef.current = next;
      setAlerts(next);
      commitRef.current(
        stateRef.current.majors,
        stateRef.current.activeMajorId,
      );
    },
    [commitRef, stateRef],
  );

  const setAlertsEnabled = (enabled: boolean) =>
    commitAlerts({ ...alertsRef.current, enabled });
  const setAlertsDuration = (durationSec: number) =>
    commitAlerts({ ...alertsRef.current, durationSec });
  const updateStateCfg = (
    state: AlertState,
    patch: Partial<AlertsSettings["states"][AlertState]>,
  ) =>
    commitAlerts({
      ...alertsRef.current,
      states: {
        ...alertsRef.current.states,
        [state]: { ...alertsRef.current.states[state], ...patch },
      },
    });
  const addCustomReminder = () => {
    const rmd: CustomReminder = {
      id: genReminderId(),
      name: "新提醒",
      enabled: true,
      anchor: "beforeStart",
      offsetMin: 30,
      tone: "15min",
      label: "提醒",
      title: "距开考还有一段时间",
      subtext: "请提前做好准备",
    };
    commitAlerts({
      ...alertsRef.current,
      custom: [...alertsRef.current.custom, rmd],
    });
  };
  const updateCustomReminder = (id: string, patch: Partial<CustomReminder>) =>
    commitAlerts({
      ...alertsRef.current,
      custom: alertsRef.current.custom.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    });
  const removeCustomReminder = (id: string) =>
    commitAlerts({
      ...alertsRef.current,
      custom: alertsRef.current.custom.filter((item) => item.id !== id),
    });
  const resetAlerts = () => commitAlerts(normalizeAlerts(DEFAULT_ALERTS));

  return {
    alerts,
    setAlerts,
    alertsRef,
    alertsOpen,
    setAlertsOpen,
    alertsSection,
    setAlertsSection,
    commitAlerts,
    setAlertsEnabled,
    setAlertsDuration,
    updateStateCfg,
    addCustomReminder,
    updateCustomReminder,
    removeCustomReminder,
    resetAlerts,
  };
}
