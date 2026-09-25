import { APP_VERSION } from '../../services/telemetry';
import { Switch } from './Switch';
import { useTelemetrySettings } from '../../hooks/settings/useTelemetrySettings';

export default function TelemetrySection({ canEditSettings }: { canEditSettings: boolean }) {
  const { teleOn, teleMsg, instId, consent, toggleTele, reportTele } = useTelemetrySettings();

  return (
    <>
      <div className="set-row">
        <span className="set-label">启用遥测上报</span>
        <Switch checked={teleOn} disabled={!canEditSettings} onChange={toggleTele} />
      </div>
      <p className="set-card__lead">
        作者端上报匿名部署/运行数据（版本、主机、时区、地区、匿名 IP 哈希）；不含考试内容与个人信息。
      </p>
      <ul className="set-status__list">
        <li>
          <span>同意状态</span>
          <b>{consent === 'granted' ? '已同意' : consent === 'denied' ? '已拒绝' : '未决定'}</b>
        </li>
        <li>
          <span>实例 ID</span>
          <b>{instId.slice(0, 8)}…</b>
        </li>
        <li>
          <span>当前版本</span>
          <b>v{APP_VERSION}</b>
        </li>
      </ul>
      <div>
        <button className="set-btn set-btn--primary" disabled={!teleOn || !canEditSettings} onClick={reportTele}>
          立即上报一次
        </button>
      </div>
      {teleMsg ? <p className="set-note">{teleMsg}</p> : null}
    </>
  );
}
