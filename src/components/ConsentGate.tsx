import React, { useEffect, useState } from 'react';
import { getConsent, setConsent, reportOnStart } from '../services/telemetry';
import '../styles/consent.css';

export default function ConsentGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(() => getConsent());

  useEffect(() => {
    if (state === 'granted') void reportOnStart();
  }, [state]);

  if (state === 'granted') return <>{children}</>;

  const agree = () => {
    setConsent('granted');
    setState('granted');
  };
  const decline = () => {
    setConsent('denied');
    setState('denied');
  };
  const reconsider = () => setState('unset');

  return (
    <div className="consent-mask">
      <div className="consent-card">
        <div className="consent-logo">📊</div>
        {state === 'unset' ? (
          <>
            <h1 className="consent-title">使用前须知</h1>
            <p className="consent-lead">
              本应用会收集<strong>匿名部署与运行遥测</strong>（实例标识、版本、主机名、时区、语言、大致地区、匿名化 IP 哈希），用于统计部署数量与版本分布。<u>不会收集任何考试内容或个人身份信息。</u>
            </p>
            <ul className="consent-list">
              <li>仅用于作者掌握各部署实例的运行情况</li>
              <li>IP 仅以单向哈希存储，无法还原真实地址</li>
              <li>同意后可随时在「系统设置」中暂停上报</li>
            </ul>
            <p className="consent-note">继续使用需同意上述数据收集；如不同意，将无法使用本应用。</p>
            <div className="consent-actions">
              <button className="consent-btn consent-btn--ghost" onClick={decline}>不同意</button>
              <button className="consent-btn consent-btn--primary" onClick={agree}>同意并继续</button>
            </div>
          </>
        ) : (
          <>
            <h1 className="consent-title">无法使用</h1>
            <p className="consent-lead">你已拒绝数据收集协议，因此无法使用本应用。若要继续使用，请同意遥测协议。</p>
            <div className="consent-actions">
              <button className="consent-btn consent-btn--primary" onClick={reconsider}>重新考虑</button>
            </div>
          </>
        )}
        <div className="consent-foot">Created By PikaNova 2026</div>
      </div>
    </div>
  );
}
