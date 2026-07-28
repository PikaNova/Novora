import { useMemo, useState } from 'react';
import { MonitorCheck, X } from 'lucide-react';
import type { SchoolClass, SchoolGrade } from '../types/school';
import type { AdminUserContext } from '../services/examService';
import { getClassBindingInstanceId, setupManagedDevice, type DeviceSetupConflict } from '../services/classBinding';
import { notify } from '../services/notify';
import InlineSelect from './InlineSelect';

const keyFor = (userId: number) => `novora_admin_device_setup:${userId}:${getClassBindingInstanceId()}`;

export default function AdminDeviceSetupPrompt({ user, grades, classes, canBind }: { user: AdminUserContext; grades: SchoolGrade[]; classes: SchoolClass[]; canBind: boolean }) {
  const [open, setOpen] = useState(() => canBind && localStorage.getItem(keyFor(user.id)) !== 'done');
  const [step, setStep] = useState(0);
  const [bindManagement, setBindManagement] = useState(false);
  const [gradeId, setGradeId] = useState(grades[0]?.id || '');
  const availableClasses = useMemo(() => classes.filter(item => item.gradeId === gradeId), [classes, gradeId]);
  const [classId, setClassId] = useState('');
  const [conflict, setConflict] = useState<DeviceSetupConflict | null>(null);
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const finish = () => { localStorage.setItem(keyFor(user.id), 'done'); setOpen(false); };
  const registerManagement = async (enabled: boolean) => {
    setBindManagement(enabled);
    if (!enabled) { setStep(1); return; }
    setSaving(true);
    try { await setupManagedDevice({ bindManagement: true }); setStep(1); }
    catch (error) { notify('error', error instanceof Error ? error.message : '管理设备登记失败'); }
    finally { setSaving(false); }
  };
  const bindClass = async (replaceExisting = false) => {
    if (!gradeId || !classId) { notify('warning', '请先选择年级和班级'); return; }
    setSaving(true);
    try {
      const result = await setupManagedDevice({ bindManagement, gradeId, classId, replaceExisting });
      if (result.conflict) { setConflict(result.conflict); return; }
      notify('success', '本设备已绑定为班级考试端'); finish();
    } catch (error) { notify('error', error instanceof Error ? error.message : '班级设备绑定失败'); }
    finally { setSaving(false); }
  };

  return <div className="admin-device-setup" role="dialog" aria-modal="true" aria-label="新设备登记">
    <section>
      <button type="button" className="admin-device-setup__close" aria-label="稍后设置" onClick={finish}><X aria-hidden="true" /></button>
      <header><MonitorCheck aria-hidden="true" /><span><strong>发现新的管理设备</strong><small>步骤 {step + 1} / 2 · 设备 {getClassBindingInstanceId().slice(0, 12)}</small></span></header>
      {step === 0 ? <div className="admin-device-setup__body"><h3>是否登记为管理设备？</h3><p>登记用于设备清单识别，不会获得免密权限；每次进入后台仍需登录。</p><div className="admin-device-setup__choices"><button type="button" disabled={saving} onClick={() => void registerManagement(true)}><strong>登记管理设备</strong><span>便于在设备管理中识别本机</span></button><button type="button" disabled={saving} onClick={() => void registerManagement(false)}><strong>不登记</strong><span>继续选择是否绑定班级考试端</span></button></div></div>
      : <div className="admin-device-setup__body"><h3>是否绑定为班级考试端？</h3><p>一个班级只保留一台有效考试端。已有设备时必须明确确认替换。</p><div className="admin-device-setup__selectors"><InlineSelect value={gradeId} onChange={value => { setGradeId(value); setClassId(''); setConflict(null); }} options={grades.map(item => ({ value: item.id, label: item.name }))} placeholder="选择年级" /><InlineSelect value={classId} onChange={value => { setClassId(value); setConflict(null); }} options={availableClasses.map(item => ({ value: item.id, label: item.name }))} placeholder="选择班级" /></div>{conflict && <div className="admin-device-setup__conflict"><strong>该班级已有考试端</strong><span>实例 {conflict.instanceId}</span><small>{conflict.online ? '当前在线' : `最后同步：${new Date(conflict.lastSeenAt).toLocaleString('zh-CN', { hour12: false })}`}</small><button type="button" disabled={saving} onClick={() => void bindClass(true)}>解绑旧设备并绑定本设备</button></div>}<footer><button type="button" className="admin-btn" onClick={finish}>暂不绑定</button><button type="button" className="admin-btn admin-btn--primary" disabled={saving || !classId} onClick={() => void bindClass(false)}>{saving ? '正在绑定…' : '绑定班级考试端'}</button></footer></div>}
    </section>
  </div>;
}
