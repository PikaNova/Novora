import { Rocket } from "lucide-react";
import { APP_VERSION } from "../../services/telemetry";
import { adminCan, type AdminUserContext } from "../../services/examService";
import { useDeploymentSettings } from "../../hooks/settings/useDeploymentSettings";

export default function DeploymentSection({
  adminUser,
}: {
  adminUser: AdminUserContext | null;
}) {
  const {
    upd,
    redeployOk,
    redeploy,
    notesOpen,
    setNotesOpen,
    updateGuideOpen,
    setUpdateGuideOpen,
    doCheck,
    doRedeploy,
  } = useDeploymentSettings();

  return (
        <section className="set-card">
          <div className="set-card__head">
            <h2 className="set-card__title">
              <Rocket size={20} />
              版本与更新
            </h2>
          </div>
          <p className="set-card__lead">
            检查 Novora 官方仓库的最新发布版本；Deploy Hook
            会重新拉取当前项目已连接的 main 分支并部署。
          </p>
          <ul className="set-status__list">
            <li>
              <span>当前版本</span>
              <b>v{APP_VERSION}</b>
            </li>
            <li>
              <span>最新版本</span>
              <b>
                {upd.status === "done"
                  ? upd.info?.latest
                    ? `v${upd.info.latest}`
                    : "尚无发布"
                  : upd.status === "checking"
                    ? "检查中…"
                    : "—"}
              </b>
            </li>
          </ul>
          {upd.status === "done" &&
            upd.info &&
            (upd.info.hasUpdate ? (
              <div className="set-note set-note--warn">
                发现新版本 v{upd.info.latest}
                {upd.info.releaseUrl ? (
                  <>
                    {" "}
                    ·{" "}
                    <a
                      href={upd.info.releaseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      查看发布说明
                    </a>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="set-note">✓ 已是最新版本</p>
            ))}
          {upd.status === "done" && upd.info?.notes ? (
            <>
              <button
                className="set-btn"
                style={{ marginTop: 8 }}
                onClick={() => setNotesOpen((o) => !o)}
              >
                {notesOpen ? "收起更新说明" : "查看更新说明"}
              </button>
              {notesOpen && (
                <pre
                  className="set-readme"
                  style={{
                    whiteSpace: "pre-wrap",
                    maxHeight: 260,
                    overflow: "auto",
                  }}
                >
                  {upd.info.notes}
                </pre>
              )}
            </>
          ) : null}
          {upd.status === "error" && (
            <p className="set-note set-note--warn">检查失败：{upd.error}</p>
          )}
          <div className="set-about__actions" style={{ marginTop: 12 }}>
            <button
              className="set-btn set-btn--primary"
              disabled={upd.status === "checking"}
              onClick={doCheck}
            >
              {upd.status === "checking" ? "检查中…" : "检查更新"}
            </button>
            {redeployOk && adminCan("deployment.trigger", adminUser) ? (
              <button
                className="set-btn"
                disabled={redeploy.status === "running"}
                onClick={doRedeploy}
              >
                {redeploy.status === "running" ? "部署中…" : "一键部署更新"}
              </button>
            ) : null}
            <button
              className="set-btn set-btn--ghost"
              onClick={() => setUpdateGuideOpen((value) => !value)}
            >
              {updateGuideOpen ? "收起更新流程" : "查看后续更新完整流程"}
            </button>
          </div>
          {!redeployOk && (
            <p className="set-note set-note--warn">
              当前部署缺少必填的 <code>VERCEL_DEPLOY_HOOK_URL</code>。请在
              Project Settings → Git → Deploy Hooks 为 main
              分支生成钩子，加入环境变量后重新部署。
            </p>
          )}
          {redeploy.status !== "idle" && redeploy.msg ? (
            <p
              className={`set-note${redeploy.status === "error" ? " set-note--warn" : ""}`}
            >
              {redeploy.msg}
            </p>
          ) : null}
          {updateGuideOpen && (
            <div className="set-update-guide">
              <strong>后续版本更新完整流程</strong>
              <ol>
                <li>
                  <b>确认仓库</b>
                  <span>
                    Deploy Hook 只部署当前 Vercel 项目连接的 main
                    分支。使用一键部署生成的 Fork 时，先在 GitHub 点击 Sync
                    fork；有自定义代码时先合并上游并解决冲突。
                  </span>
                </li>
                <li>
                  <b>备份与安排窗口</b>
                  <span>
                    阅读目标版本发布说明，备份 Neon，并记录当前可用的 Vercel
                    Deployment，避开考试和上课时段。
                  </span>
                </li>
                <li>
                  <b>检查版本</b>
                  <span>
                    点击“检查更新”。确认目标版本和发布说明，且 GitHub
                    生产分支已经包含该版本代码。
                  </span>
                </li>
                <li>
                  <b>触发部署</b>
                  <span>
                    点击“一键部署更新”，再到 Vercel Deployments
                    查看构建。按钮只触发 Deploy Hook，不会替未同步的 Fork
                    合并官方代码。
                  </span>
                </li>
                <li>
                  <b>验收与回滚</b>
                  <span>
                    部署完成后检查首页、登录、数据保存、大屏、PDF 和
                    ClassIsland；失败时在 Vercel 将上一个成功 Deployment
                    重新设为生产版本。
                  </span>
                </li>
              </ol>
              <a
                href="https://github.com/PikaNova/novora-vitepress-docs/blob/main/guide/12-maintenance.md"
                target="_blank"
                rel="noopener noreferrer"
              >
                打开详细维护文档
              </a>
            </div>
          )}
        </section>
  );
}
