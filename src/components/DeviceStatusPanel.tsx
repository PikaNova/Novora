import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchClassBindings } from '../services/classBinding';
import type { ClassBindingInfo } from '../services/classBinding';

function formatInstanceId(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function formatUpdatedAt(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '未知';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export default function DeviceStatusPanel() {
  const [bindings, setBindings] = useState<ClassBindingInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState('*');
  const [copiedId, setCopiedId] = useState('');
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchClassBindings();
      setBindings(result.bindings);
      setTruncated(result.truncated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '设备情况加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const classTags = useMemo(() => Array.from(new Set(bindings.map(item => item.classTag).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN')), [bindings]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return bindings.filter(item => {
      const matchesClass = classFilter === '*' || (classFilter === '' ? item.classTag === '' : item.classTag === classFilter);
      const matchesQuery = !keyword || item.instanceId.toLocaleLowerCase().includes(keyword) || item.classTag.toLocaleLowerCase().includes(keyword);
      return matchesClass && matchesQuery;
    });
  }, [bindings, classFilter, query]);
  const generalCount = bindings.filter(item => item.classTag === '').length;

  const copyInstanceId = async (instanceId: string) => {
    try {
      await navigator.clipboard.writeText(instanceId);
      setCopiedId(instanceId);
      window.setTimeout(() => setCopiedId(current => current === instanceId ? '' : current), 1600);
    } catch {
      setError('无法复制实例 ID，请检查浏览器剪贴板权限');
    }
  };

  return <main className="device-status">
    <div className="device-status__heading">
      <div><h2>设备情况</h2><p>查看已连接设备实例及其班级绑定，数据按最近更新时间排序。</p></div>
      <button className="admin-btn" onClick={() => void load()} disabled={loading} title="刷新设备情况">↻ {loading ? '刷新中' : '刷新'}</button>
    </div>
    <div className="device-status__stats" aria-label="设备绑定统计">
      <div><span>已绑定实例</span><strong>{bindings.length}</strong></div>
      <div><span>班级数</span><strong>{classTags.length}</strong></div>
      <div><span>通用 / 未分组</span><strong>{generalCount}</strong></div>
    </div>
    <div className="device-status__toolbar">
      <label><span>搜索</span><input className="admin-input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="实例 ID 或班级" /></label>
      <label><span>班级</span><select className="admin-input" value={classFilter} onChange={event => setClassFilter(event.target.value)}><option value="*">全部班级</option><option value="">通用 / 未分组</option>{classTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}</select></label>
      <span className="device-status__result">显示 {filtered.length} / {bindings.length}</span>
    </div>
    {error && <div className="admin-error device-status__error">{error}<button className="admin-btn admin-btn--ghost" onClick={() => void load()}>重试</button></div>}
    {truncated && <p className="device-status__notice">当前仅显示最近更新的 500 个实例。</p>}
    {!loading && !error && filtered.length === 0 && <div className="admin-empty"><p>{bindings.length ? '没有符合筛选条件的设备' : '暂无设备绑定记录'}</p></div>}
    {filtered.length > 0 && <div className="device-status__list" role="list">
      {filtered.map(item => <div className="device-status__row" role="listitem" key={item.instanceId}>
        <div className="device-status__instance"><span>实例 ID</span><code title={item.instanceId}>{formatInstanceId(item.instanceId)}</code></div>
        <div className="device-status__class"><span>班级</span><strong>{item.classTag || '通用 / 未分组'}</strong></div>
        <div className="device-status__updated"><span>绑定更新时间</span><time dateTime={new Date(item.updatedAt).toISOString()}>{formatUpdatedAt(item.updatedAt)}</time></div>
        <button className="admin-btn admin-btn--ghost" onClick={() => void copyInstanceId(item.instanceId)} title="复制完整实例 ID">{copiedId === item.instanceId ? '已复制' : '复制'}</button>
      </div>)}
    </div>}
  </main>;
}
