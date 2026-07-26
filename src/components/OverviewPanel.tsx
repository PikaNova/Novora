import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Database, MonitorCheck, X } from 'lucide-react';
import type { MajorExam } from '../types';
import type { WeeklyPlan } from '../types/exam';
import type { SchoolClass, SchoolGrade } from '../types/school';
import type { AdminUserContext } from '../services/examService';
import { fetchDeviceBindings, type DeviceBindingInfo } from '../services/classBinding';

const ONLINE_MS = 90_000;

interface Props {
  user: AdminUserContext;
  grades: SchoolGrade[];
  classes: SchoolClass[];
  majors: MajorExam[];
  weeklyPlans: WeeklyPlan[];
  syncLabel: string;
  online: boolean;
  onQuickPublish?: () => void;
}

export default function OverviewPanel({ user, grades, classes, majors, weeklyPlans, syncLabel, online, onQuickPublish }: Props) {
  const [devices, setDevices] = useState<DeviceBindingInfo[]>([]);
  const [deviceError, setDeviceError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [onlineOpen, setOnlineOpen] = useState(false);
  const scope = useMemo(() => {
    if (user.permissions.includes('*') || user.scopes.some(item => item.type === 'all')) return { gradeIds: new Set(grades.map(item => item.id)), classIds: new Set(classes.map(item => item.id)) };
    const gradeIds = new Set(user.scopes.filter(item => item.type === 'grade').map(item => item.gradeId));
    const classIds = new Set(user.scopes.filter(item => item.type === 'class').map(item => item.classId));
    classes.forEach(item => { if (gradeIds.has(item.gradeId)) classIds.add(item.id); });
    return { gradeIds, classIds };
  }, [classes, grades, user.permissions, user.scopes]);

  const loadDevices = useCallback(async () => {
    try {
      const result = await fetchDeviceBindings();
      setDevices(result.bindings.filter(item => scope.classIds.has(item.classId)));
      setDeviceError('');
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : '设备状态读取失败');
    }
  }, [scope]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => { if (alive) { setNow(Date.now()); await loadDevices(); } };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [loadDevices]);

  const activeMajors = majors.filter(major => major.items.some(item => item.enabled && new Date(item.endTime).getTime() >= now) && (!major.targetGradeIds?.length || major.targetGradeIds.some(id => scope.gradeIds.has(id))));
  const scopedPlans = weeklyPlans.filter(plan => scope.classIds.has(plan.classId));
  const onlineDevices = devices.filter(item => !item.revoked && now - item.lastSeenAt <= ONLINE_MS);
  const runningDevices = onlineDevices.filter(item => item.status === 'exam-running');
  const majorItems = activeMajors.flatMap(major => major.items.filter(item => item.enabled).map(item => ({ major, item })));
  const majorConflicts = majorItems.flatMap((left, index) => majorItems.slice(index + 1).filter(right => {
    const timeOverlap = new Date(left.item.startTime).getTime() < new Date(right.item.endTime).getTime() && new Date(left.item.endTime).getTime() > new Date(right.item.startTime).getTime();
    const gradeOverlap = !left.major.targetGradeIds?.length || !right.major.targetGradeIds?.length || left.major.targetGradeIds.some(id => right.major.targetGradeIds?.includes(id));
    const classOverlap = !left.major.targetClassIds?.length || !right.major.targetClassIds?.length || left.major.targetClassIds.some(id => right.major.targetClassIds?.includes(id));
    return left.major.id !== right.major.id && timeOverlap && gradeOverlap && classOverlap;
  }).map(right => `${left.major.name} / ${right.major.name}`));
  const attentionCount = devices.filter(item => item.revoked).length + (deviceError ? 1 : 0) + majorConflicts.length;

  return <main className="overview-panel">
    <div className="overview-panel__head"><div><span>项目运行情况</span><h2>{user.roleId === 'super_admin' ? '全校运行总览' : '管理年级运行总览'}</h2></div><div className="overview-panel__actions">{onQuickPublish && <button className="admin-btn admin-btn--primary" onClick={onQuickPublish}>快速发布统一考试</button>}<strong className={online ? 'is-ok' : 'is-warn'}>{syncLabel}</strong></div></div>
    <div className="overview-grid">
      <button type="button" className="overview-grid__action" onClick={() => setOnlineOpen(true)}><MonitorCheck /><span>在线设备</span><strong>{onlineDevices.length}</strong><small>共 {devices.length} 台 · {runningDevices.length} 台考试中</small></button>
      <article><CalendarClock /><span>待执行大型考试</span><strong>{activeMajors.length}</strong><small>{scopedPlans.filter(item => item.enabled).length} 个启用周测计划</small></article>
      <article><Database /><span>数据库状态</span><strong>{deviceError ? '连接异常' : '连接正常'}</strong><small>{scope.gradeIds.size} 个年级 · {scope.classIds.size} 个班级</small></article>
      <article><AlertTriangle /><span>需要关注</span><strong>{attentionCount}</strong><small>{deviceError || (majorConflicts.length ? `${majorConflicts.length} 组大型考试时间冲突` : '同步与设备状态正常')}</small></article>
    </div>
    <section className="overview-section"><h3>正在进行</h3>{runningDevices.length ? <div className="overview-running">{runningDevices.map(item => <div key={item.instanceId}><strong>{item.currentSubject || '考试'}</strong><span>{item.currentExam || '当前考试'} · {classes.find(value => value.id === item.classId)?.name || '未识别班级'}</span><code>{item.instanceId}</code></div>)}</div> : <p>当前管理范围内没有正在考试的设备。</p>}</section>
    {majorConflicts.length > 0 && <section className="overview-section"><h3>大型考试冲突</h3><div className="overview-running">{[...new Set(majorConflicts)].map(label => <div key={label}><strong>{label}</strong><span>适用范围和考试时间存在重叠，请在大型考试模块核对。</span></div>)}</div></section>}
    {onlineOpen && <div className="overview-device-drawer" role="dialog" aria-modal="true" aria-label="在线设备"><button className="overview-device-drawer__backdrop" aria-label="关闭" onClick={() => setOnlineOpen(false)} /><aside><header><div><span>当前授权范围</span><h3>在线设备</h3></div><button className="admin-btn" onClick={() => setOnlineOpen(false)} aria-label="关闭"><X size={17} /></button></header><div className="overview-device-drawer__list">{onlineDevices.length ? onlineDevices.map(device => <article key={device.instanceId}><strong>{classes.find(item => item.id === device.classId)?.name || '未绑定班级'}</strong><span>{device.status === 'exam-running' ? `${device.currentExam} · ${device.currentSubject}` : '在线待命'}</span><code title={device.instanceId}>{device.instanceId}</code><small>最近心跳：{new Date(device.lastSeenAt).toLocaleString('zh-CN', { hour12: false })}</small></article>) : <p>暂无在线设备。</p>}</div><footer><a className="admin-btn" href="/admin?tab=devices">进入设备管理</a></footer></aside></div>}
  </main>;
}
