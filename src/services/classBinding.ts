import { getInstanceId } from './telemetry';

const API_URL = '/api/exams';
const CLASS_CHOICE_KEY = 'exam_board_class_choice_confirmed';

export function hasConfirmedClassChoice(): boolean {
  try { return localStorage.getItem(CLASS_CHOICE_KEY) === 'true'; } catch { return false; }
}

export function markClassChoiceConfirmed(): void {
  try { localStorage.setItem(CLASS_CHOICE_KEY, 'true'); } catch { /* local settings remain usable in memory */ }
}

export async function fetchBoundClassTag(): Promise<string | null> {
  try {
    const instanceId = encodeURIComponent(getInstanceId());
    const response = await fetch(`${API_URL}?action=class-binding&instanceId=${instanceId}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.ok && typeof data.classTag === 'string' ? data.classTag : null;
  } catch { return null; }
}

export async function saveBoundClassTag(classTag: string): Promise<boolean> {
  markClassChoiceConfirmed();
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'class-binding', instanceId: getInstanceId(), classTag: classTag.trim() }),
    });
    return response.ok;
  } catch { return false; }
}
