import { DEFAULT_DESIGN_ID } from '../designs/registry';

const KEY = 'exam_design_id';

export function getDesignId(): string {
  try { return localStorage.getItem(KEY) || DEFAULT_DESIGN_ID; }
  catch { return DEFAULT_DESIGN_ID; }
}

export function setDesignId(id: string): void {
  try { localStorage.setItem(KEY, id); } catch {}
}
