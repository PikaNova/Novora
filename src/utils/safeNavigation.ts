const LOGIN_DESTINATIONS = new Set(['/', '/admin', '/settings']);
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
    if (destination.origin !== 'https://novora.invalid' || !LOGIN_DESTINATIONS.has(destination.pathname)) return '/admin';
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return '/admin';
  }
}
