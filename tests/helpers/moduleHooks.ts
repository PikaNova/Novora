import { registerHooks } from 'node:module';

let installed = false;

/**
 * 组件级测试在 Node 里跑源码的两个必需品：
 * 1. `.css` 解析成空模块（Node 不认样式导入）；
 * 2. 源码里有不少相对导入没写扩展名（Vite 能解析、Node ESM 不能），统一补 `.js`。
 *    只在测试进程里生效，不动产品代码。
 */
export function installTestModuleHooks(): void {
  if (installed) return;
  installed = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.endsWith('.css')) {
        return { url: 'data:text/javascript,export default {}', shortCircuit: true };
      }
      if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
        return nextResolve(`${specifier}.js`, context);
      }
      return nextResolve(specifier, context);
    },
  });
}

/**
 * `notify()` 通过 `window.dispatchEvent` 发通知；Node 里没有 window，它会直接返回。
 * 测试需要观察 toast 时用这个最小事件目标顶上（Node 自带 EventTarget / CustomEvent）。
 */
export function installMinimalWindow(): EventTarget {
  const globals = globalThis as unknown as Record<string, unknown>;
  if (typeof globals.window === 'undefined') globals.window = new EventTarget();
  return globals.window as EventTarget;
}
