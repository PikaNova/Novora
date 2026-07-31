import { useEffect, useState } from "react";
import { APP_VERSION } from "../../services/telemetry";
import {
  checkForUpdate,
  getRedeployConfigured,
  triggerRedeploy,
} from "../../services/update";
import type { UpdateInfo } from "../../services/update";
import { confirmDialog } from "../../services/appDialog";
import { notify } from "../../services/notify";

export function useDeploymentSettings() {
  const [upd, setUpd] = useState<{
    status: "idle" | "checking" | "done" | "error";
    info?: UpdateInfo;
    error?: string;
  }>({ status: "idle" });
  const [redeployOk, setRedeployOk] = useState(false);
  const [redeploy, setRedeploy] = useState<{
    status: "idle" | "running" | "done" | "error";
    msg?: string;
  }>({ status: "idle" });
  const [notesOpen, setNotesOpen] = useState(false);
  const [updateGuideOpen, setUpdateGuideOpen] = useState(false);

  useEffect(() => {
    getRedeployConfigured()
      .then(setRedeployOk)
      .catch(() => {});
  }, []);

  const doCheck = async () => {
    setUpd({ status: "checking" });
    const info = await checkForUpdate(APP_VERSION);
    setUpd(
      info.ok
        ? { status: "done", info }
        : { status: "error", error: info.error },
    );
    notify(
      info.ok ? "success" : "error",
      info.ok
        ? info.hasUpdate
          ? `发现新版本 v${info.latest}。`
          : "当前已经是最新版本。"
        : info.error || "版本检查失败",
    );
  };

  const doRedeploy = async () => {
    if (
      !(await confirmDialog({
        title: "重新部署 Novora",
        message:
          "将从 GitHub 拉取最新代码并重新构建，约需 1-3 分钟。完成后刷新页面即可使用新版本。",
        tone: "warning",
        confirmLabel: "开始部署",
      }))
    )
      return;
    setRedeploy({ status: "running", msg: "已触发，正在部署…" });
    const r = await triggerRedeploy();
    if (r.ok) {
      setRedeploy({
        status: "done",
        msg: "已触发部署，请稍后在 Vercel 查看进度。",
      });
      notify("success", "Vercel 更新部署已触发。");
    } else {
      const message =
        r.code === "NO_HOOK"
          ? "未配置部署钩子（VERCEL_DEPLOY_HOOK_URL）"
          : r.error || "触发失败";
      setRedeploy({ status: "error", msg: message });
      notify("error", message, "部署触发失败");
    }
  };

  return {
    upd,
    redeployOk,
    redeploy,
    notesOpen,
    setNotesOpen,
    updateGuideOpen,
    setUpdateGuideOpen,
    doCheck,
    doRedeploy,
  };
}
