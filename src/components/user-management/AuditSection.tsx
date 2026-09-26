import React from 'react';
import Mascot from '../Mascot';
import { auditActionLabel, auditResourceText } from '../../constants/auditActions';
import type { AuditLog } from '../../services/adminUsers';
import { fmt } from './helpers';

export default function AuditSection({ logs }: { logs: AuditLog[] }) {
  return (
    <div className="user-management__audit">
      {logs.length ? (
        logs.map((log) => (
          <div className="user-management__audit-row" key={log.id}>
            <time>{fmt(log.createdAt)}</time>
            <strong>{log.username || '系统'}</strong>
            {/* 界面上只出现中文，原始动作码与资源 ID 放进悬停提示给排查用。 */}
            <span title={log.action}>{auditActionLabel(log.action)}</span>
            <code title={log.resourceId || log.resourceType}>
              {auditResourceText(log.resourceType, log.resourceId)}
            </code>
          </div>
        ))
      ) : (
        <div className="admin-empty">
          <Mascot className="mascot-empty" size={64} alt="" />
          <p>暂无操作记录</p>
        </div>
      )}
    </div>
  );
}
