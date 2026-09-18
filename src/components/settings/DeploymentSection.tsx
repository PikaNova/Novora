import { APP_VERSION } from '../../services/telemetry';
import { adminCan, type AdminUserContext } from '../../services/examService';
import { useDeploymentSettings } from '../../hooks/settings/useDeploymentSettings';
import { notify } from '../../services/notify';

export default function DeploymentSection({ adminUser }: { adminUser: AdminUserContext | null }) {
  const {
    upd,
    deployTarget,
    redeployOk,
    redeploy,
    notesOpen,
    setNotesOpen,
    updateGuideOpen,
    setUpdateGuideOpen,
    doCheck,
    doRedeploy,
  } = useDeploymentSettings();
  const isLocal = deployTarget === 'local';
  const copyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      notify('success', '命令已复制，可在部署机粘贴执行。');
    } catch {
      notify('error', '复制失败，请手动选择复制。');
    }
  };

  return (
    <>
      <p className="set-card__lead">
        {isLocal
          ? '本地/内网部署：检查官方最新发布版本后，在部署机上执行 npm run update:local 完成更新（自动拉取代码、重建并健康检查）。'
          : '检查 Novora 官方仓库的最新发布版本；Deploy Hook 会重新拉取当前项目已连接的 main 分支并部署。'}
      </p>
      <ul className="set-status__list">
        <li>
          <span>当前版本</span>
          <b>v{APP_VERSION}</b>
        </li>
        <li>
          <span>部署平台</span>
          <b>{isLocal ? '本地 / 内网' : 'Vercel'}</b>
        </li>
        <li>
          <span>最新版本</span>
          <b>
            {upd.status === 'done'
              ? upd.info?.latest
                ? `v${upd.info.latest}`
                : '尚无发布'
              : upd.status === 'checking'
                ? '检查中…'
                : '—'}
          </b>
        </li>
      </ul>
      {upd.status === 'done' &&
        upd.info &&
        (upd.info.hasUpdate ? (
          <>
            <div className="set-note set-note--warn">
              发现新版本 v{upd.info.latest}
              {upd.info.releaseUrl ? (
                <>
                  {' '}
                  ·{' '}
                  <a href={upd.info.releaseUrl} target="_blank" rel="noopener noreferrer">
                    查看发布说明
                  </a>
                </>
              ) : null}
            </div>
            <ul className="set-status__list">
              <li>
                <span>目标镜像</span>
                <b style={{ fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', wordBreak: 'break-all' }}>
                  {upd.info.image || '未声明'}
                </b>
              </li>
              <li>
                <span>镜像摘要</span>
                <b style={{ fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' }}>
                  {upd.info.digest ? upd.info.digest.slice(0, 19) + '…' : '未声明摘要校验'}
                </b>
              </li>
              <li>
                <span>最低 schema</span>
                <b>
                  {upd.info.minSchema
                    ? `${upd.info.minSchema}（本机 ${upd.info.schemaVersion ?? '—'}）`
                    : '未声明'}
                </b>
              </li>
            </ul>
            {upd.info.schemaReady === false ? (
              <p className="set-note set-note--warn">
                目标版本要求更高的数据库 schema，升级前请先完成备份，升级失败按既有回滚流程处理（版本可回滚、数据不回滚）。
              </p>
            ) : null}
            {(upd.info.warnings || []).map((warning) => (
              <p className="set-note set-note--warn" key={warning}>
                {warning}
              </p>
            ))}
          </>
        ) : (
          <p className="set-note">✓ 已是最新版本</p>
        ))}
      {upd.status === 'done' && upd.info?.notes ? (
        <>
          <button className="set-btn" style={{ marginTop: 8 }} onClick={() => setNotesOpen((o) => !o)}>
            {notesOpen ? '收起更新说明' : '查看更新说明'}
          </button>
          {notesOpen && (
            <pre
              className="set-readme"
              style={{
                whiteSpace: 'pre-wrap',
                maxHeight: 260,
                overflow: 'auto',
              }}
            >
              {upd.info.notes}
            </pre>
          )}
        </>
      ) : null}
      {upd.status === 'error' && <p className="set-note set-note--warn">检查失败：{upd.error}</p>}
      <div className="set-about__actions" style={{ marginTop: 12 }}>
        <button className="set-btn set-btn--primary" disabled={upd.status === 'checking'} onClick={doCheck}>
          {upd.status === 'checking' ? '检查中…' : '检查更新'}
        </button>
        {!isLocal && redeployOk && adminCan('deployment.trigger', adminUser) ? (
          <button className="set-btn" disabled={redeploy.status === 'running'} onClick={doRedeploy}>
            {redeploy.status === 'running' ? '部署中…' : '一键部署更新'}
          </button>
        ) : null}
        <button className="set-btn set-btn--ghost" onClick={() => setUpdateGuideOpen((value) => !value)}>
          {updateGuideOpen ? '收起更新流程' : '查看后续更新完整流程'}
        </button>
      </div>
      {isLocal ? (
        <div className="set-deploy-command">
          <div className="set-deploy-command__row">
            <code>npm run update:local</code>
            <button className="set-btn" type="button" onClick={() => void copyCommand('npm run update:local')}>
              复制
            </button>
          </div>
          <div className="set-deploy-command__row">
            <code>git pull --ff-only && docker compose up -d --build</code>
            <button
              className="set-btn"
              type="button"
              onClick={() => void copyCommand('git pull --ff-only && docker compose up -d --build')}
            >
              复制
            </button>
          </div>
          <p className="set-note">在部署机仓库目录执行任一条即可完成升级（自动拉取代码、重建并健康检查）。</p>
        </div>
      ) : !redeployOk ? (
        <p className="set-note set-note--warn">
          当前部署缺少必填的 <code>VERCEL_DEPLOY_HOOK_URL</code>。请在 Project Settings → Git → Deploy Hooks 为 main
          分支生成钩子，加入环境变量后重新部署。
        </p>
      ) : null}
      {redeploy.status !== 'idle' && redeploy.msg ? (
        <p className={`set-note${redeploy.status === 'error' ? ' set-note--warn' : ''}`}>{redeploy.msg}</p>
      ) : null}
      {updateGuideOpen && (
        <div className="set-update-guide">
          <strong>后续版本更新完整流程</strong>
          {isLocal ? (
            <ol>
              <li>
                <b>确认版本</b>
                <span>阅读目标版本发布说明，确认要更新的版本；部署机进入仓库目录。</span>
              </li>
              <li>
                <b>备份与安排窗口</b>
                <span>执行 DEPLOY_LOCAL.md 中的 pg_dump 备份命令，避开考试和上课时段。</span>
              </li>
              <li>
                <b>一键更新</b>
                <span>
                  执行 npm run update:local（自动 git pull + 重建 + 健康检查）；或手动 git pull 后 docker compose up -d
                  --build。
                </span>
              </li>
              <li>
                <b>验收</b>
                <span>
                  检查首页、登录、数据保存、大屏、PDF 和 ClassIsland，并确认 http://主机:3000/api/health 返回 ok。
                </span>
              </li>
              <li>
                <b>回滚</b>
                <span>需要回退时 git checkout {'<旧版本>'} 后重建；数据库结构不回滚，必要时用备份恢复。</span>
              </li>
            </ol>
          ) : (
            <ol>
              <li>
                <b>确认仓库</b>
                <span>
                  Deploy Hook 只部署当前 Vercel 项目连接的 main 分支。使用一键部署生成的 Fork 时，先在 GitHub 点击 Sync
                  fork；有自定义代码时先合并上游并解决冲突。
                </span>
              </li>
              <li>
                <b>备份与安排窗口</b>
                <span>阅读目标版本发布说明，备份 Neon，并记录当前可用的 Vercel Deployment，避开考试和上课时段。</span>
              </li>
              <li>
                <b>检查版本</b>
                <span>点击“检查更新”。确认目标版本和发布说明，且 GitHub 生产分支已经包含该版本代码。</span>
              </li>
              <li>
                <b>触发部署</b>
                <span>
                  点击“一键部署更新”，再到 Vercel Deployments 查看构建。按钮只触发 Deploy Hook，不会替未同步的 Fork
                  合并官方代码。
                </span>
              </li>
              <li>
                <b>验收与回滚</b>
                <span>
                  部署完成后检查首页、登录、数据保存、大屏、PDF 和 ClassIsland；失败时在 Vercel 将上一个成功 Deployment
                  重新设为生产版本。
                </span>
              </li>
            </ol>
          )}
          <a href="https://docs.pikachu2026.space/guide/12-maintenance" target="_blank" rel="noopener noreferrer">
            打开详细维护文档
          </a>
        </div>
      )}
    </>
  );
}
