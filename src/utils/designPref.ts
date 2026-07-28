import { DEFAULT_DESIGN_ID } from '../designs/registry';
import type { DesignPolicy } from '../types/exam';

const KEY = 'exam_design_id';

export function getDesignId(): string {
  try { return localStorage.getItem(KEY) || DEFAULT_DESIGN_ID; }
  catch { return DEFAULT_DESIGN_ID; }
}

export function setDesignId(id: string): void {
  try { localStorage.setItem(KEY, id); } catch {}
}

export function resolveManagedDesign(policy: DesignPolicy | undefined, gradeId: string, classId: string, instanceId: string): string | null {
  const rules = Array.isArray(policy?.rules) ? policy.rules : [];
  return rules.find(rule => rule.scope === 'school')?.designId
    ?? rules.find(rule => rule.scope === 'grade' && rule.scopeId === gradeId)?.designId
    ?? rules.find(rule => rule.scope === 'class' && rule.scopeId === classId)?.designId
    ?? rules.find(rule => rule.scope === 'device' && rule.scopeId === instanceId)?.designId
    ?? null;
}
