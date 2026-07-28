import { useEffect, useState } from "react";
import { CheckCircle2, Link2 } from "lucide-react";
import BrandMark from "../components/BrandMark";
import { useSearchParams } from "react-router-dom";
import {
  confirmPluginPairing,
  fetchPluginPairInfo,
  type PluginPairInfo,
} from "../services/pluginPairing";
import "../styles/plugin-connect.css";

export default function PluginConnectPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [info, setInfo] = useState<PluginPairInfo | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("配对链接无效，请返回 ClassIsland 重新连接。");
      return;
    }
    fetchPluginPairInfo(token)
      .then(setInfo)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "无法读取配对请求"),
      );
  }, [token]);

  const binding = info?.binding;
  const bindingValid = !!binding && !binding.revoked && !binding.isManagement && !!binding.gradeId && !!binding.classId;

  const confirm = async () => {
    if (!bindingValid) {
      setError(binding?.isManagement ? "管理设备不能绑定 ClassIsland，请先改为班级考试端。" : "请先返回看板首页绑定年级和班级。");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await confirmPluginPairing(token);
      setComplete(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "班级绑定失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="plugin-connect">
      <BrandMark className="plugin-connect__brand" />
      <section className="plugin-connect__panel" aria-live="polite">
        {complete ? (
          <>
            <CheckCircle2
              className="plugin-connect__success"
              aria-hidden="true"
            />
            <h1>ClassIsland 已连接</h1>
            <p>
              {binding?.classTag}
            </p>
            <button type="button" onClick={() => window.close()}>
              完成
            </button>
          </>
        ) : (
          <>
            <div className="plugin-connect__icon">
              <Link2 aria-hidden="true" />
            </div>
            <h1>连接 ClassIsland</h1>
            <p>ClassIsland 将直接继承本看板的班级，不能在插件连接页单独更改。</p>
            {bindingValid ? <div className="plugin-connect__binding"><span>跟随看板班级</span><strong>{binding.classTag}</strong></div> : <div className="plugin-connect__error" role="alert">{binding?.isManagement ? "本机是管理设备，不能连接班级插件。" : binding?.revoked ? "本看板绑定已被删除，请先重新绑定班级。" : "本看板尚未绑定班级，请先回首页完成绑定。"}</div>}
            {error && (
              <div className="plugin-connect__error" role="alert">
                {error}
              </div>
            )}
            <button
              type="button"
              disabled={!info || !bindingValid || submitting}
              onClick={() => void confirm()}
            >
              {submitting ? "正在连接…" : "确认连接"}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
