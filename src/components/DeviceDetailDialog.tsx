import { useEffect, useMemo, useState } from 'react';
import { Link2, MonitorCog, RefreshCw, Wifi, X } from 'lucide-react';
import type { SchoolClass, SchoolGrade } from '../types/school';
import { classDisplayName } from '../utils/classSettings';
import { updateExamSettings } from '../utils/appSettings';
import { confirmDialog } from '../services/appDialog';
import { fetchOccupiedClassIds, updateDeviceRole, type DeviceBinding, type DeviceBindingInfo, type PluginBindingInfo } from '../services/classBinding';
import { notify } from '../services/notify';
import ClassMultiPicker from './ClassMultiPicker';

const ONLINE_MS = 90_000;

export type DeviceDetailTarget = {
  key: string;
  instanceId: string;
  gradeId: string;
  classId: string;
  dashboard?: DeviceBindingInfo;
  plugins: PluginBindingInfo[];
};

export default function DeviceDetailDialog({ device, grades, classes, selectableGrades, selectableClasses, currentInstanceId, canBind, onClose, onUpdated }: {
  device: DeviceDetailTarget;
  grades: SchoolGrade[];
  classes: SchoolClass[];
  selectableGrades: SchoolGrade[];
  selectableClasses: SchoolClass[];
  currentInstanceId: string;
  canBind: boolean;
  onClose: () => void;
  onUpdated: (binding: DeviceBinding) => void;
}) {
  const [classFlowOpen, setClassFlowOpen] = useState(false);
  const [gradeId, setGradeId] = useState(device.gradeId && selectableGrades.some(grade => grade.id === device.gradeId) ? device.gradeId : selectableGrades[0]?.id || '');
  const [occupiedClassIds, setOccupiedClassIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const dashboard = device.dashboard;
  const isCurrent = device.instanceId === currentInstanceId;
  const isManagement = dashboard?.isManagement === true;
  const roleTitle = isManagement ? '管理设备' : dashboard ? '班级考试端' : 'ClassIsland 插件';
  const assignment = isManagement
    ? [dashboard?.managementRoleName || '管理身份未记录', dashboard?.managementScopeLabel || '管理范围未记录'].join(' · ')
    : device.classId ? classDisplayName(grades, classes, device.classId) : '未绑定班级';
  const dashboardOnline = !!dashboard && !dashboard.revoked && Date.now() - dashboard.lastSeenAt <= ONLINE_MS;
  const classOptions = useMemo(() => selectableClasses.map(item => ({
    id: item.id,
    gradeId: item.gradeId,
    gradeName: grades.find(grade => grade.id === item.gradeId)?.name || '未知年级',
    className: item.name,
    statusLabel: occupiedClassIds.includes(item.id) ? '已绑定' : undefined,
  })), [selectableClasses, grades, occupiedClassIds]);

  useEffect(() => {
    if (!classFlowOpen) return;
    let active = true;
    void fetchOccupiedClassIds().then(ids => { if (active) setOccupiedClassIds(ids); }).catch(() => { if (active) setOccupiedClassIds([]); });
    return () => { active = false; };
  }, [classFlowOpen]);

  const finish = (binding: DeviceBinding, message: string) => {
    if (isCurrent) updateExamSettings({ selectedGradeId: binding.gradeId, selectedClassId: binding.classId });
    notify('success', message);
    onUpdated(binding);
  };

  const convertToManagement = async () => {
    if (!dashboard || !(await confirmDialog({ title: '转为管理设备', message: '转换后将释放当前班级名额，并解除本设备上的 ClassIsland 配对。', tone: 'warning', confirmLabel: '确认转换' }))) return;
    setSaving(true);
    const result = await updateDeviceRole({ instanceId: dashboard.instanceId, targetRole: 'management' });
    setSaving(false);
    if (!result.ok) { notify('error', result.error); return; }
    finish(result.binding, '设备已转换为管理设备。');
  };

  const convertToClass = async (classId: string) => {
    if (!dashboard || !gradeId || !classId) return;
    setSaving(true);
    try {
      let replaceExisting = occupiedClassIds.includes(classId);
      if (replaceExisting && !(await confirmDialog({ title: '该班级已有考试端', message: '继续后将解除原考试端及其 ClassIsland 配对，并由当前设备接替。', tone: 'warning', confirmLabel: '替换原考试端' }))) return;
      let result = await updateDeviceRole({ instanceId: dashboard.instanceId, targetRole: 'class-terminal', gradeId, classId, replaceExisting });
      if (!result.ok && result.conflict && !replaceExisting) {
        replaceExisting = await confirmDialog({ title: '该班级已有考试端', message: '继续后将解除原考试端及其 ClassIsland 配对，并由当前设备接替。', tone: 'warning', confirmLabel: '替换原考试端' });
        if (!replaceExisting) return;
        result = await updateDeviceRole({ instanceId: dashboard.instanceId, targetRole: 'class-terminal', gradeId, classId, replaceExisting: true });
      }
      if (!result.ok) { notify('error', result.error); return; }
      finish(result.binding, result.replaced ? '已替换原考试端并完成角色转换。' : '设备已转换为班级考试端。');
    } finally { setSaving(false); }
  };

  return <div className="device-detail-overlay" role="dialog" aria-modal="true" aria-labelledby="device-detail-title" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="device-detail">
      <header className="device-detail__head">
        <div><span>设备详情</span><h3 id="device-detail-title">{roleTitle}{isCurrent && <em>当前设备</em>}</h3><p>{assignment}</p></div>
        <button type="button" onClick={onClose} aria-label="关闭设备详情"><X /></button>
      </header>
      <div className="device-detail__facts">
        <div><MonitorCog /><span>设备角色</span><strong>{roleTitle}</strong></div>
        <div><Wifi /><span>在线状态</span><strong>{dashboardOnline ? 'Novora 在线' : 'Novora 离线'}</strong></div>
        <div><RefreshCw /><span>最后同步</span><strong>{dashboard?.lastSeenAt ? new Date(dashboard.lastSeenAt).toLocaleString('zh-CN', { hour12: false }) : '从未同步'}</strong></div>
        <div><Link2 /><span>ClassIsland</span><strong>{device.plugins.some(plugin => plugin.paired) ? `${device.plugins.filter(plugin => plugin.paired).length} 个已配对` : '未配对'}</strong></div>
      </div>
      <section className="device-detail__section">
        <h4>设备信息</h4>
        <dl><div><dt>当前绑定</dt><dd>{assignment}</dd></div><div><dt>当前页面</dt><dd>{dashboard?.page || '未知'}</dd></div><div><dt>{dashboard?.status === 'waiting' ? '下一场考试' : '当前考试'}</dt><dd>{dashboard?.currentSubject ? `${dashboard.currentExam} · ${dashboard.currentSubject}` : '暂无进行中的考试'}</dd></div><div><dt>看板实例</dt><dd><code>{dashboard?.instanceId || '尚无看板心跳'}</code></dd></div>{device.plugins.map(plugin => <div key={plugin.pluginInstanceId}><dt>ClassIsland 实例</dt><dd><code>{plugin.pluginInstanceId}</code></dd></div>)}</dl>
      </section>
      {canBind && dashboard && !dashboard.revoked && <section className="device-detail__section device-detail__role">
        <div><h4>设备角色</h4><p>转换会立即影响该设备的班级占用和 ClassIsland 配对。</p></div>
        {!classFlowOpen && <button type="button" className="admin-btn" disabled={saving} onClick={() => isManagement ? setClassFlowOpen(true) : void convertToManagement()}>转换设备角色</button>}
        {classFlowOpen && <div className="device-role-flow">
          <div className="device-role-flow__head"><strong>转为班级考试端</strong><button type="button" onClick={() => setClassFlowOpen(false)} disabled={saving}>取消转换</button></div>
          <span>1. 选择年级</span>
          <div className="device-role-flow__grades">{selectableGrades.map(grade => <button type="button" className={gradeId === grade.id ? 'is-selected' : ''} key={grade.id} onClick={() => setGradeId(grade.id)} disabled={saving}>{grade.name}</button>)}</div>
          <span>2. 选择班级</span>
          <ClassMultiPicker options={classOptions} gradeId={gradeId} selectedIds={[]} onChange={ids => void convertToClass(ids[0] || '')} disabled={saving || !gradeId} single />
        </div>}
      </section>}
    </section>
  </div>;
}
