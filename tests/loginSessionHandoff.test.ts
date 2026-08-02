import assert from 'node:assert/strict';
import test from 'node:test';

Object.assign(globalThis as typeof globalThis & { __APP_VERSION__: string; __COMMIT_SHA__: string }, {
  __APP_VERSION__: 'test',
  __COMMIT_SHA__: 'test',
});

const { changeOwnCredentials } = await import('../src/services/adminUsers.js');
const { loginAdmin } = await import('../src/services/examService.js');

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

test('first-login credential change uses the newly issued session token', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const storage = new MemoryStorage();
  const issuedToken = 'new-login-session-token';
  let credentialChangeAuthorization = '';
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === '/api/login') {
      return new Response(JSON.stringify({
        ok: true,
        token: issuedToken,
        expiresAt: Date.now() + 60_000,
        user: { id: 7, username: 'custom-role-user', displayName: 'Custom role user', roleId: 'custom', roleName: 'Custom', permissions: [], scopes: [], mustChangePassword: true },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    assert.equal(url, '/api/users');
    credentialChangeAuthorization = new Headers(init?.headers).get('Authorization') ?? '';
    return new Response(JSON.stringify({ ok: true, username: 'custom-role-user' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const session = await loginAdmin('custom-role-user', 'initial-password');
    assert.equal(session?.token, issuedToken);
    assert.equal(session?.user?.mustChangePassword, true);
    storage.removeItem('admin_auth_token');
    await changeOwnCredentials('initial-password', 'custom-role-user', 'new-password', session!.token!);
    assert.equal(credentialChangeAuthorization, `Bearer ${issuedToken}`);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage });
  }
});
