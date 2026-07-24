import type { SchoolClass, SchoolGrade } from '../types/school';
import { getClassBindingInstanceId } from './classBinding';

const API_URL = '/api/exams';

export interface PluginPairInfo {
  pluginInstanceId: string;
  expiresAt: number;
  grades: SchoolGrade[];
  classes: SchoolClass[];
}

async function readError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => null);
  return typeof data?.error === 'string' ? data.error : fallback;
}

export async function fetchPluginPairInfo(token: string): Promise<PluginPairInfo> {
  const response = await fetch(`${API_URL}?action=plugin-pair-info&token=${encodeURIComponent(token)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(await readError(response, '无法读取配对请求'));
  const data = await response.json();
  return {
    pluginInstanceId: String(data.pluginInstanceId ?? ''),
    expiresAt: Number(data.expiresAt ?? 0),
    grades: Array.isArray(data.grades) ? data.grades : [],
    classes: Array.isArray(data.classes) ? data.classes : [],
  };
}

export async function confirmPluginPairing(token: string, gradeId: string, classId: string): Promise<void> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'plugin-pair-confirm', pairToken: token, gradeId, classId, viewerInstanceId: getClassBindingInstanceId() }),
  });
  if (!response.ok) throw new Error(await readError(response, '班级绑定失败'));
}

export function pluginInstanceFromSearch(search: string): string {
  const params = new URLSearchParams(search);
  return params.get('source') === 'classisland' ? (params.get('instanceId') ?? '') : '';
}

export async function sendPluginViewerHeartbeat(pluginInstanceId: string, viewerInstanceId: string): Promise<void> {
  if (!pluginInstanceId) return;
  await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'plugin-viewer-heartbeat', pluginInstanceId, viewerInstanceId }),
  }).catch(() => undefined);
}
