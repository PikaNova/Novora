import { useNavigate } from "react-router-dom";
import { Bell, ArrowRight } from "lucide-react";
import InlineSelect from "../InlineSelect";
import {
  useAlertsAdvancedSettings,
  type ErrMode,
} from "../../hooks/settings/useAlertsAdvancedSettings";

export default function AlertsAdvancedSection({
  canReadAlerts,
  canEditAlerts,
  canEditSettings,
}: {
  canReadAlerts: boolean;
  canEditAlerts: boolean;
  canEditSettings: boolean;
}) {
  const navigate = useNavigate();
  const { errMode, silentMode, patchSilentMode, patchErr, resetLocal } =
    useAlertsAdvancedSettings();

  return (
        <section className="set-card">
          <div className="set-card__head">
            <h2 className="set-card__title">
              <Bell size={20} />
              提醒与高级
            </h2>
          </div>
          <div className="set-row">
            <label className="set-label">全屏提醒管理</label>
            {canReadAlerts ? (
              <button
                className="set-btn"
                onClick={() => navigate("/admin?alerts=1")}
              >
                前往提醒管理
                <ArrowRight aria-hidden="true" />
              </button>
            ) : (
              <span className="set-note">无查看权限</span>
            )}
          </div>
          <div className="set-row">
            <label className="set-label">静默模式</label>
            <InlineSelect
              className="set-input"
              disabled={!canEditAlerts}
              value={silentMode}
              onChange={(value) =>
                patchSilentMode(value as "all" | "keyOnly" | "pauseUntilExamEnd")
              }
              options={[
                { value: "all", label: "全部提醒" },
                {
                  value: "keyOnly",
                  label: "仅关键提醒（5分钟 / 开考 / 结束 / 下一科）",
                },
                { value: "pauseUntilExamEnd", label: "本场进行中暂停提醒" },
              ]}
            />
          </div>
          <div className="set-row">
            <label className="set-label">错误中心模式</label>
            <InlineSelect
              className="set-input"
              disabled={!canEditSettings}
              value={errMode}
              onChange={(value) => patchErr(value as ErrMode)}
              options={[
                { value: "off", label: "关闭" },
                { value: "memory", label: "仅内存（本会话）" },
                { value: "persist", label: "持久化（本地保存）" },
              ]}
            />
          </div>
          <div className="set-row">
            <label className="set-label">重置本地设置</label>
            <button
              className="set-btn set-btn--danger"
              disabled={!canEditSettings}
              onClick={() => void resetLocal()}
            >
              清除本地缓存并恢复默认
            </button>
          </div>
        </section>
  );
}
