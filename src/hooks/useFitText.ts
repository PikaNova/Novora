import { useLayoutEffect, useRef } from 'react';

/** Shrinks a single-line label only when its rendered width exceeds its container. */
export function useFitText(value: unknown, minScale = 0.36) {
  const ref = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const node = ref.current; if (!node) return;
    const fit = () => {
      node.style.setProperty('--fit-scale', '1');
      const parent = node.parentElement;
      let available = node.clientWidth;
      if (parent) {
        const cs = getComputedStyle(parent);
        available = parent.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
      }
      const width = node.scrollWidth;
      const scale = width > 0 ? Math.max(minScale, Math.min(1, (available - 1) / width)) : 1;
      node.style.setProperty('--fit-scale', String(scale));
    };
    fit(); if (typeof document !== 'undefined' && (document as any).fonts && (document as any).fonts.ready) { (document as any).fonts.ready.then(() => fit()).catch(() => {}); } const observer = new ResizeObserver(fit); observer.observe(node); if (node.parentElement) observer.observe(node.parentElement); window.addEventListener('resize', fit); return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  }, [value, minScale]);
  return ref;
}
