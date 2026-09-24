/**
 * Node 里跑「组件级」测试的最小浏览器环境。
 *
 * 必须在 import 任何组件/服务之前先 import 本模块：ESM 的求值顺序就是 import 顺序，
 * 而这些模块在求值期就会读 Vite 注入的编译期常量（`__APP_VERSION__` 等）和 localStorage。
 */
const globals = globalThis as unknown as Record<string, unknown>;

globals.__APP_VERSION__ = globals.__APP_VERSION__ ?? '0.0.0-test';
globals.__COMMIT_SHA__ = globals.__COMMIT_SHA__ ?? 'test';
globals.__BUILD_TIME__ = globals.__BUILD_TIME__ ?? new Date(0).toISOString();

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  clear(): void {
    this.values.clear();
  }
}

if (typeof globals.localStorage === 'undefined') {
  globals.localStorage = new MemoryStorage();
}

export {};
