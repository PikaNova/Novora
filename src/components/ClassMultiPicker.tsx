import React, { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import '../styles/class-picker.css';

export type ClassPickerOption = { id: string; gradeId: string; gradeName: string; className: string };

type Props = {
  options: ClassPickerOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  gradeId?: string;
  disabled?: boolean;
  single?: boolean;
  showSearch?: boolean;
  emptyText?: string;
  noun?: string;
};

const naturalSort = (left: ClassPickerOption, right: ClassPickerOption) =>
  left.gradeName.localeCompare(right.gradeName, 'zh-CN', { numeric: true })
  || left.className.localeCompare(right.className, 'zh-CN', { numeric: true });

export default function ClassMultiPicker({ options, selectedIds, onChange, gradeId, disabled = false, single = false, showSearch = true, emptyText = '暂无可选择的班级', noun = '班级' }: Props) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => options
    .filter(item => !gradeId || item.gradeId === gradeId)
    .filter(item => !query.trim() || `${item.gradeName} ${item.className}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort(naturalSort), [gradeId, options, query]);
  const groups = useMemo(() => [...new Map(visible.map(item => [item.gradeId, { id: item.gradeId, name: item.gradeName }])).values()], [visible]);
  const visibleIds = visible.map(item => item.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id));
  const toggle = (id: string) => onChange(single ? [id] : selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id]);

  return <div className={`class-picker${disabled ? ' is-disabled' : ''}`}>
    {(showSearch || !single) && <div className={`class-picker__toolbar${showSearch ? '' : ' is-actions-only'}`}>
      {showSearch && <label><Search aria-hidden="true" /><input value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} placeholder={`搜索年级或${noun}`} /></label>}
      {!single && <><button type="button" disabled={disabled || !visibleIds.length} onClick={() => onChange(allVisibleSelected ? selectedIds.filter(id => !visibleIds.includes(id)) : [...new Set([...selectedIds, ...visibleIds])])}>{allVisibleSelected ? '取消当前结果' : '全选当前结果'}</button><button type="button" disabled={disabled || !selectedIds.length} onClick={() => onChange([])}>清空</button></>}
    </div>}
    {!single && <div className="class-picker__count">已选择 {selectedIds.length} 个{noun}</div>}
    <div className="class-picker__groups">
      {!visible.length && <p>{emptyText}</p>}
      {groups.map(group => {
        const rows = visible.filter(item => item.gradeId === group.id);
        const rowIds = rows.map(item => item.id);
        const groupSelected = rowIds.length > 0 && rowIds.every(id => selectedIds.includes(id));
        return <section key={group.id}><header><strong>{group.name}</strong>{!single && <button type="button" disabled={disabled} onClick={() => onChange(groupSelected ? selectedIds.filter(id => !rowIds.includes(id)) : [...new Set([...selectedIds, ...rowIds])])}>{groupSelected ? '取消全选' : `全选 ${rows.length} 个${noun}`}</button>}</header><div>{rows.map(item => { const checked = selectedIds.includes(item.id); return <button type="button" key={item.id} title={item.className} disabled={disabled} className={checked ? 'is-selected' : ''} aria-pressed={checked} onClick={() => toggle(item.id)}><span>{item.className}</span>{checked && <Check aria-hidden="true" />}</button>; })}</div></section>;
      })}
    </div>
  </div>;
}
