import React, { useCallback, useEffect, useMemo, useState } from 'react';
import HelpTip from './HelpTip';
import { fetchDeviceBindings, revokeDevice, sendDeviceCommand, type DeviceBindingInfo, type DeviceCommand, type PluginBindingInfo } from '../services/classBinding';
import { getAppSettings } from '../utils/appSettings';
import { classDisplayName } from '../utils/classSettings';
import { notify } from '../services/notify';

const ONLINE_MS = 90_000;
const formatTime = (value: number) => value > 0 ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '从未上线';
const statusLabel = (item?: DeviceBindingInfo) => !item ? '仅连接 ClassIsland' : item.status === 'exam-running' ? '考试进行中' : item.status === 'waiting' ? '等待考试' : item.status === 'temporary-paused' ? '临时考试已暂停' : '空闲';

type DeviceGroup = {
  key: string;
  instanceId: string;
  gradeId: string;
  classId: string;
  dashboard?: DeviceBindingInfo;
  plugins: PluginBindingInfo[];
};

export default function DeviceStatusPanel({ canRevoke = true }: { canRevoke?: boolean }) {
  const [bindings, setBindings] = useState<DeviceBindingInfo[]>([]);
  const [plugins, setPlugins] = useState<PluginBindingInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState('*');
  const [classFilter, setClassFilter] = useState('*');
  const [now, setNow] = useState(Date.now());
  const { grades, classes } = getAppSettings().exam;

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try { const result = await fetchDeviceBindings(); setBindings(result.bindings); setPlugins(result.plugins); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '设备管理加载失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); const timer = window.setInterval(() => { setNow(Date.now()); void load(true); }, 10_000); return () => clearInterval(timer); }, [load]);

  const groups = useMemo(() => {
    const attached = new Set<string>();
    const result: DeviceGroup[] = bindings.map(dashboard => {
      const linked = plugins.filter(plugin => plugin.viewerInstanceId === dashboard.instanceId);
      linked.forEach(plugin => attached.add(plugin.pluginInstanceId));
      return { key: `viewer:${dashboard.instanceId}`, instanceId: dashboard.instanceId, gradeId: dashboard.gradeId || linked[0]?.gradeId || '', classId: dashboard.classId || linked[0]?.classId || '', dashboard, plugins: linked };
    });
    plugins.filter(plugin => !attached.has(plugin.pluginInstanceId)).forEach(plugin => result.push({
      key: `plugin:${plugin.pluginInstanceId}`,
      instanceId: plugin.viewerInstanceId,
      gradeId: plugin.gradeId,
      classId: plugin.classId,
      plugins: [plugin],
    }));
    return result;
  }, [bindings, plugins]);

  const visibleClasses = classes.filter(item => gradeFilter === '*' || item.gradeId === gradeFilter);
  const filtered = useMemo(() => groups.filter(item => {
    const name = classDisplayName(grades, classes, item.classId);
    const text = query.trim().toLowerCase();
    const pluginIds = item.plugins.map(plugin => plugin.pluginInstanceId).join(' ');
    const dashboard = item.dashboard;
    return (gradeFilter === '*' || item.gradeId === gradeFilter) && (classFilter === '*' || item.classId === classFilter) && (!text || `${item.instanceId} ${pluginIds} ${name} ${dashboard?.currentExam || ''} ${dashboard?.currentSubject || ''}`.toLowerCase().includes(text));
  }), [classFilter, classes, gradeFilter, grades, groups, query]);

  const dashboardOnline = (item: DeviceGroup) => !!item.dashboard && !item.dashboard.revoked && now - item.dashboard.lastSeenAt <= ONLINE_MS;
  const pluginOnline = (plugin: PluginBindingInfo) => plugin.paired && now - plugin.pluginLastSeenAt <= ONLINE_MS;
  const viewerOnline = (plugin: PluginBindingInfo) => plugin.paired && now - plugin.viewerLastSeenAt <= ONLINE_MS;
  const groupOnline = (item: DeviceGroup) => dashboardOnline(item) || item.plugins.some(plugin => pluginOnline(plugin) || viewerOnline(plugin));
  const onlineCount = groups.filter(groupOnline).length;

  const remove = async (item: DeviceGroup) => {
    const label = item.instanceId || item.plugins[0]?.pluginInstanceId || item.key;
    if (!window.confirm(`删除设备 ${label}？考试看板与关联 ClassIsland 插件都会解除绑定。`)) return;
    try { await revokeDevice(item.dashboard?.instanceId || '', item.plugins.map(plugin => plugin.pluginInstanceId)); await load(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '删除设备失败'); }
  };

  const command = async (item: DeviceBindingInfo, action: DeviceCommand['action']) => {
    try {
      await sendDeviceCommand(item.instanceId, action, action === 'extend' ? 5 : undefined);
      notify('success', `已发送${action === 'pause' ? '暂停' : action === 'resume' ? '继续' : action === 'extend' ? '延长 5 分钟' : '结束'}指令。`);
    } catch (cause) { notify('error', cause instanceof Error ? cause.message : '临时考试指令发送失败'); }
  };

  return <main className="device-status">
    <div className="device-status__heading"><div><h2>设备管理 <HelpTip title="看板与 ClassIsland">同一台设备上的考试看板和 ClassIsland 插件按实例关联后合并展示。在线状态分别由各自心跳判断；删除会让两端重新绑定。</HelpTip></h2><p>一个设备视图同时显示考试看板、ClassIsland 插件、当前考试和班级绑定。</p></div><button className="admin-btn" onClick={() => void load()} disabled={loading}>刷新</button></div>
    <div className="device-status__stats"><div><span>设备总数</span><strong>{groups.length}</strong></div><div><span>任一端在线</span><strong>{onlineCount}</strong></div><div><span>考试进行中</span><strong>{groups.filter(item => item.dashboard?.status === 'exam-running').length}</strong></div><div><span>ClassIsland 已配对</span><strong>{plugins.filter(item => item.paired).length}</strong></div></div>
    <div className="device-status__toolbar"><label><span>搜索</span><input className="admin-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="看板实例、插件实例、班级或考试" /></label><label><span>年级</span><select className="admin-input" value={gradeFilter} onChange={event => { setGradeFilter(event.target.value); setClassFilter('*'); }}><option value="*">全部年级</option>{grades.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>班级</span><select className="admin-input" value={classFilter} onChange={event => setClassFilter(event.target.value)}><option value="*">全部班级</option>{visibleClasses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    {error && <div className="admin-error">{error}</div>}
    {loading && <div className="device-status__loading">正在读取设备状态…</div>}
    {!loading && filtered.length === 0 && <div className="admin-empty"><p>暂无符合条件的设备</p></div>}
    {filtered.length > 0 && <div className="device-status__table"><div className="device-status__table-head"><span>设备与班级</span><span>实时状态</span><span>最近在线</span><span>操作</span></div><div className="device-status__list">{filtered.map(item => {
      const dashboard = item.dashboard;
      const temporary = !!dashboard && (dashboard.currentExam.includes('临时考试') || dashboard.status === 'temporary-paused');
      const lastSeenAt = Math.max(dashboard?.lastSeenAt || 0, ...item.plugins.flatMap(plugin => [plugin.pluginLastSeenAt, plugin.viewerLastSeenAt]));
      const removed = dashboard?.revoked === true && item.plugins.every(plugin => !plugin.paired);
      return <div className={`device-status__row${removed ? ' is-revoked' : ''}`} key={item.key}><div className="device-status__instance"><span>{classDisplayName(grades, classes, item.classId)}</span>{dashboard ? <code title={dashboard.instanceId}>看板 {dashboard.instanceId}</code> : <code>尚无独立看板心跳</code>}{item.plugins.map(plugin => <code title={plugin.pluginInstanceId} key={plugin.pluginInstanceId}>ClassIsland {plugin.pluginInstanceId}</code>)}</div><div className="device-status__class"><strong>{removed ? '已删除，等待重新绑定' : statusLabel(dashboard)}</strong><div className="device-status__channels"><span className={dashboardOnline(item) ? 'is-online' : 'is-offline'}>考试看板 {dashboardOnline(item) ? '在线' : '离线'}</span>{item.plugins.map(plugin => <span key={plugin.pluginInstanceId} className={pluginOnline(plugin) ? 'is-online' : plugin.paired ? 'is-offline' : 'is-removed'}>ClassIsland {pluginOnline(plugin) ? '在线' : plugin.paired ? '离线' : '未绑定'}</span>)}</div><span>{dashboard?.currentSubject ? `${dashboard.currentExam} · ${dashboard.currentSubject}` : dashboard ? `页面 ${dashboard.page || '未知'} · v${dashboard.clientVersion || '未知'}` : '插件已接入，等待考试看板客户端心跳'}</span>{temporary && canRevoke && <div className="device-status__commands"><button onClick={() => void command(dashboard, dashboard.status === 'temporary-paused' ? 'resume' : 'pause')}>{dashboard.status === 'temporary-paused' ? '继续' : '暂停'}</button><button onClick={() => void command(dashboard, 'extend')}>+5 分钟</button><button className="is-danger" onClick={() => void command(dashboard, 'end')}>结束</button></div>}</div><div className="device-status__updated"><time>{formatTime(lastSeenAt)}</time></div>{canRevoke ? <button className="admin-btn admin-btn--danger" onClick={() => void remove(item)} disabled={removed}>{removed ? '已删除' : '删除'}</button> : <span className="device-status__readonly">只读</span>}</div>;
    })}</div></div>}
  </main>;
}
