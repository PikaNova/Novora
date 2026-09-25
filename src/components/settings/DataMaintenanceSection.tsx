import { useDataMaintenanceSettings } from '../../hooks/settings/useDataMaintenanceSettings';

export default function DataMaintenanceSection({ canResetDatabase }: { canResetDatabase: boolean }) {
  const {
    resetCategories,
    resetPhrase,
    setResetPhrase,
    resettingCloud,
    demoBusy,
    toggleResetCategory,
    resetCloudData,
    updateDemoData,
  } = useDataMaintenanceSettings(canResetDatabase);

  return (
    <>
      <p className="set-card__lead">
        仅重置选择的业务数据，不删除超级管理员和其他登录账号。重置学校结构时会同时清除周测与设备绑定。
      </p>
      <div className="set-reset-grid">
        <label className="set-reset-grid__all">
          <input
            type="checkbox"
            checked={resetCategories.includes('all')}
            onChange={(event) => toggleResetCategory('all', event.target.checked)}
          />
          整体重置全部业务数据
        </label>
        {[
          ['major', '大型考试'],
          ['weekly', '周测计划'],
          ['school', '学校、年级与班级'],
          ['devices', '设备绑定、插件与状态'],
          ['settings', '提醒与调度设置'],
        ].map(([id, label]) => (
          <label key={id}>
            <input
              type="checkbox"
              disabled={resetCategories.includes('all')}
              checked={resetCategories.includes('all') || resetCategories.includes(id)}
              onChange={(event) => toggleResetCategory(id, event.target.checked)}
            />
            {label}
          </label>
        ))}
      </div>
      <label className="set-label">
        输入“重置数据库”确认
        <input className="set-input" value={resetPhrase} onChange={(event) => setResetPhrase(event.target.value)} />
      </label>
      <button
        className="set-btn set-btn--danger"
        disabled={resettingCloud || resetPhrase !== '重置数据库' || !resetCategories.length}
        onClick={() => void resetCloudData()}
      >
        {resettingCloud ? '正在重置…' : '重置所选云端数据'}
      </button>
      {canResetDatabase && (
        <details className="set-card set-dev-tools">
          <summary>开发与测试</summary>
          <p className="set-card__lead">测试数据入口只在设置页向超级管理员显示。导入内容带有独立标识，可以单独移除。</p>
          <div className="set-row">
            <label className="set-label">演示考试安排数据</label>
            <div className="set-inline-actions">
              <button className="set-btn" disabled={demoBusy} onClick={() => void updateDemoData(true)}>
                导入测试数据
              </button>
              <button
                className="set-btn set-btn--danger"
                disabled={demoBusy}
                onClick={() => void updateDemoData(false)}
              >
                移除测试数据
              </button>
            </div>
          </div>
        </details>
      )}
    </>
  );
}
