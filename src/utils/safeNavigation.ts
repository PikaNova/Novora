const LOGIN_DESTINATIONS = new Set(['/', '/admin', '/settings']);
// 后台/设置的子页也允许作为登录回跳目标（`/admin/devices`、`/settings/exam`）。
// 仍然是同源 + 固定前缀，嵌套路径无法跳出这两个命名空间。
const LOGIN_DESTINATION_PREFIXES = ['/admin/', '/settings/'];
// 登录跳转目标拦截控制字符，防止伪造空白字符绕过校验（no-control-regex 有意保留）
// eslint-disable-next-line no-control-regex -- security boundary: reject C0 controls and DEL in redirect targets
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function safeLoginDestination(value: string | null | undefined): string {
  if (!value || value !== value.trim() || CONTROL_CHARACTERS.test(value) || value.includes('\\')) return '/admin';

  let decoded = value;
  for (let depth = 0; depth < 3; depth += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (CONTROL_CHARACTERS.test(next) || next.includes('\\') || next.startsWith('//')) return '/admin';
      if (next === decoded) break;
      decoded = next;
    } catch {
      return '/admin';
    }
  }

  if (!value.startsWith('/') || value.startsWith('//')) return '/admin';

  try {
    const destination = new URL(value, 'https://novora.invalid');
    const allowed =
      destination.origin === 'https://novora.invalid' &&
      (LOGIN_DESTINATIONS.has(destination.pathname) ||
        LOGIN_DESTINATION_PREFIXES.some((prefix) => destination.pathname.startsWith(prefix)));
    if (!allowed) return '/admin';
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return '/admin';
  }
}
