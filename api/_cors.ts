import type { VercelRequest, VercelResponse } from '@vercel/node';

type CorsOptions = {
  methods: string[];
  public?: boolean;
};

function first(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] ?? '' : value ?? '').split(',')[0].trim();
}

function appendVary(res: VercelResponse, value: string): void {
  const current = String(res.getHeader('Vary') ?? '').split(',').map(item => item.trim()).filter(Boolean);
  if (!current.includes(value)) res.setHeader('Vary', [...current, value].join(', '));
}

function allowedOrigins(req: VercelRequest): Set<string> {
  const host = first(req.headers['x-forwarded-host']) || first(req.headers.host);
  const protocol = first(req.headers['x-forwarded-proto']) || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  const configured = String(process.env.CORS_ALLOWED_ORIGINS ?? '').split(',').map(item => item.trim()).filter(Boolean);
  const origins = new Set(configured);
  if (host) origins.add(`${protocol}://${host}`);
  if (process.env.VERCEL_URL) origins.add(`https://${process.env.VERCEL_URL}`);
  return origins;
}

export function applyCors(req: VercelRequest, res: VercelResponse, options: CorsOptions): boolean {
  const origin = first(req.headers.origin);
  res.setHeader('Access-Control-Allow-Methods', [...new Set([...options.methods, 'OPTIONS'])].join(', '));
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');

  if (options.public) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin) {
    if (!allowedOrigins(req).has(origin)) {
      res.status(403).json({ ok: false, code: 'ORIGIN_NOT_ALLOWED', error: 'Request origin is not allowed' });
      return false;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    appendVary(res, 'Origin');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }
  return true;
}
