import React, { useCallback, useEffect, useMemo, useState } from 'react';
import HelpTip from './HelpTip';
import { fetchDeviceBindings, revokeDevice, type DeviceBindingInfo } from '../services/classBinding';
import { getAppSettings } from '../utils/appSettings';
import { classDisplayName } from '../utils/classSettings';

const ONLINE_MS = 90_000;
const formatTime = (value: number) => value > 0 ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '从未上线';
const statusLabel = (item: DeviceBindingInfo) => item.status === 'exam-running' ? '考试进行中' : item.status === 'waiting' ? '等待考试' : '空闲';

export default function DeviceStatusPanel() {
  const [bindings, setBindings] = useState<DeviceBindingInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState('*');
  const [classFilter, setClassFilter] = useState('*');
  const [now, setNow] = useState(Date.now());
  const { grades, classes } = getAppSettings().exam;

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try { const result = await fetchDeviceBindings(); setBindings(result.bindings); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '设备管理加载失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); const timer = window.setInterval(() => { setNow(Date.now()); void load(true); }, 10_000); return () => clearInterval(timer); }, [load]);
  const visibleClasses = classes.filter(item => gradeFilter === '*' || item.gradeId === gradeFilter);
  const filtered = useMemo(() => bindings.filter(item => {
    const name = classDisplayName(grades, classes, item.classId);
    const text = query.trim().toLowerCase();
    return (gradeFilter === '*' || item.gradeId === gradeFilter) && (classFilter === '*' || item.classId === classFilter) && (!text || `${item.instanceId} ${name} ${item.currentExam} ${item.currentSubject}`.toLowerCase().includes(text));
  }), [bindings, classes, classFilter, gradeFilter, grades, query]);
  const onlineCount = bindings.filter(item => !item.revoked && now - item.lastSeenAt <= ONLINE_MS).length;

  const remove = async (item: DeviceBindingInfo) => {
    if (!window.confirm(`删除设备 ${item.instanceId}？客户端将在下一次心跳时提示重新绑定。`)) return;
    try { await revokeDevice(item.instanceId); await load(true); } catch (cause) { setError(cause instanceof Error ? cause.message : '删除设备失败'); }
  };

  return <main className="device-status">
    <div className="device-status__heading"><div><h2>设备管理 <HelpTip title="设备状态与删除">在线状态由客户端心跳判断，短暂断网可能显示离线。删除设备会撤销它的绑定，客户端下次心跳时会被要求重新选择年级与班级。</HelpTip></h2><p>查看客户端在线状态、当前考试和班级绑定；删除后客户端会要求重新绑定。</p></div><button className="admin-btn" onClick={() => void load()} disabled={loading}>刷新</button></div>
    <div className="device-status__stats"><div><span>设备总数</span><strong>{bindings.length}</strong></div><div><span>当前在线</span><strong>{onlineCount}</strong></div><div><span>考试进行中</span><strong>{bindings.filter(item => item.status === 'exam-running').length}</strong></div><div><span>已撤销</span><strong>{bindings.filter(item => item.revoked).length}</strong></div></div>
    <div className="device-status__toolbar"><label><span>搜索</span><input className="admin-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="设备、班级或考试" /></label><label><span>年级</span><select className="admin-input" value={gradeFilter} onChange={event => { setGradeFilter(event.target.value); setClassFilter('*'); }}><option value="*">全部年级</option>{grades.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>班级</span><select className="admin-input" value={classFilter} onChange={event => setClassFilter(event.target.value)}><option value="*">全部班级</option>{visibleClasses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    {error && <div className="admin-error">{error}</div>}
    {loading && <div className="device-status__loading">正在读取设备状态…</div>}
    {!loading && filtered.length === 0 && <div className="admin-empty"><p>暂无符合条件的设备</p></div>}
    {filtered.length > 0 && <div className="device-status__table"><div className="device-status__table-head"><span>设备与班级</span><span>实时状态</span><span>最近在线</span><span>操作</span></div><div className="device-status__list">{filtered.map(item => {
      const online = !item.revoked && now - item.lastSeenAt <= ONLINE_MS;
      return <div className={`device-status__row${item.revoked ? ' is-revoked' : ''}`} key={item.instanceId}><div className="device-status__instance"><span>{classDisplayName(grades, classes, item.classId)}</span><code title={item.instanceId}>{item.instanceId}</code></div><div className="device-status__class"><strong>{item.revoked ? '已删除，等待重新绑定' : `${online ? '在线' : '离线'} · ${statusLabel(item)}`}</strong><span>{item.currentSubject ? `${item.currentExam} · ${item.currentSubject}` : `页面 ${item.page || '未知'} · v${item.clientVersion || '未知'}`}</span></div><div className="device-status__updated"><time>{formatTime(item.lastSeenAt)}</time></div><button className="admin-btn admin-btn--danger" onClick={() => void remove(item)} disabled={item.revoked}>{item.revoked ? '已删除' : '删除'}</button></div>;
    })}</div></div>}
  </main>;
}
