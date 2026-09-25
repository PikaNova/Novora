import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * 提醒层（toast 之外的浮动提醒：草稿提示条、未完成提示、更新提示）统一挂到 `document.body` 下渲染。
 *
 * 为什么必须 portal：提醒挂在页面树里时，会被页面自己的层叠上下文锁在弹窗下面——
 * z-index 设多高都不管用。实测：草稿提示条 z-index 20000、弹窗遮罩 15000，
 * 提示条仍然被遮罩压住、点不到；把同一个节点 append 到 body 后立刻正常。
 */
export default function NoticePortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return <>{children}</>;
  return createPortal(children, document.body);
}
