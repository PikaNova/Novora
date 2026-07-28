import { useEffect, useMemo, useState } from 'react';
import { Palette, Trash2 } from 'lucide-react';
import { DESIGNS } from '../designs/registry';
import { fetchExamsFromServer, saveDesignPolicy } from '../services/examService';
import type { DeviceBindingInfo } from '../services/classBinding';
import type { DesignAssignmentRule, DesignPolicy, DesignRuleScope } from '../types/exam';
import type { SchoolClass, SchoolGrade } from '../types/school';
import { getAppSettings, updateExamSettings } from '../utils/appSettings';
import { notify } from '../services/notify';
import InlineSelect from './InlineSelect';

const SCOPE_LABEL: Record<DesignRuleScope, string> = { school: '学校默认', grade: '年级', class: '班级', device: '设备实例' };

export default function DesignPolicyManager({ grades, classes, devices, canEdit }: { grades: SchoolGrade[]; classes: SchoolClass[]; devices: DeviceBindingInfo[]; canEdit: boolean }) {
  const [policy, setPolicy] = useState<DesignPolicy>(() => getAppSettings().exam.designPolicy);
  const [scope, setScope] = useState<DesignRuleScope>('school');
  const [scopeId, setScopeId] = useState('*');
  const [designId, setDesignId] = useState(DESIGNS[0].id);
  const [saving, setSaving] = useState(false);

  useEffect(() => { void fetchExamsFromServer().then(payload => { if (payload?.designPolicy) setPolicy(payload.designPolicy); }); }, []);
  useEffect(() => {
    if (scope === 'school') setScopeId('*');
    else if (scope === 'grade') setScopeId(grades[0]?.id || '');
    else if (scope === 'class') setScopeId(classes[0]?.id || '');
    else setScopeId(devices[0]?.instanceId || '');
  }, [scope, grades, classes, devices]);

  const targets = useMemo(() => scope === 'grade'
    ? grades.map(item => ({ value: item.id, label: item.name }))
    : scope === 'class'
      ? classes.map(item => ({ value: item.id, label: `${grades.find(grade => grade.id === item.gradeId)?.name || '未分年级'} · ${item.name}` }))
      : scope === 'device'
        ? devices.map(item => ({ value: item.instanceId, label: `${classes.find(entry => entry.id === item.classId)?.name || '未绑定'} · ${item.instanceId.slice(0, 12)}` }))
        : [{ value: '*', label: '全校考试端' }], [scope, grades, classes, devices]);

  const persist = async (rules: DesignAssignmentRule[]) => {
    setSaving(true);
    try {
      const saved = await saveDesignPolicy({ rules, updatedAt: Date.now() });
      setPolicy(saved);
      updateExamSettings({ designPolicy: saved, updatedAt: saved.updatedAt });
      notify('success', '考试端设计规则已下发');
    } catch (error) { notify('error', error instanceof Error ? error.message : '设计规则保存失败'); }
    finally { setSaving(false); }
  };

  const addRule = () => {
    if (!scopeId) { notify('warning', '请先选择应用对象'); return; }
    const next: DesignAssignmentRule = { id: `${scope}-${scopeId}`, scope, scopeId, designId };
    void persist([...policy.rules.filter(rule => !(rule.scope === scope && rule.scopeId === scopeId)), next]);
  };
  const targetLabel = (rule: DesignAssignmentRule) => rule.scope === 'school' ? '全校考试端'
    : rule.scope === 'grade' ? grades.find(item => item.id === rule.scopeId)?.name || rule.scopeId
    : rule.scope === 'class' ? classes.find(item => item.id === rule.scopeId)?.name || rule.scopeId
    : devices.find(item => item.instanceId === rule.scopeId)?.instanceId || rule.scopeId;

  return <section className="design-policy-manager">
    <header><span><Palette aria-hidden="true" /><strong>考试端设计下发</strong></span><small>设备 &gt; 班级 &gt; 年级 &gt; 学校默认 &gt; 本地设置</small></header>
    <div className="design-policy-manager__form">
      <InlineSelect value={scope} onChange={value => setScope(value as DesignRuleScope)} options={(Object.keys(SCOPE_LABEL) as DesignRuleScope[]).map(value => ({ value, label: SCOPE_LABEL[value] }))} disabled={!canEdit || saving} />
      <InlineSelect value={scopeId} onChange={setScopeId} options={targets} disabled={!canEdit || saving || !targets.length} placeholder="选择应用对象" />
      <InlineSelect value={designId} onChange={setDesignId} options={DESIGNS.map(item => ({ value: item.id, label: item.name }))} disabled={!canEdit || saving} />
      <button type="button" className="admin-btn admin-btn--primary" disabled={!canEdit || saving || !scopeId} onClick={addRule}>{saving ? '保存中…' : '下发设计'}</button>
    </div>
    {policy.rules.length > 0 && <div className="design-policy-manager__rules">{policy.rules.map(rule => <div key={`${rule.scope}:${rule.scopeId}`}><span><strong>{SCOPE_LABEL[rule.scope]} · {targetLabel(rule)}</strong><small>{DESIGNS.find(item => item.id === rule.designId)?.name || rule.designId}</small></span>{canEdit && <button type="button" title="删除规则" disabled={saving} onClick={() => void persist(policy.rules.filter(item => item !== rule))}><Trash2 aria-hidden="true" /></button>}</div>)}</div>}
  </section>;
}
