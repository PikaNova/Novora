import React, { useEffect, useState } from 'react';
import { Check, LockKeyhole, Smartphone, Star, X } from 'lucide-react';
import { DESIGNS } from '../designs/registry';
import type { DesignTheme } from '../designs/types';
import { useIsMobile } from '../hooks/useIsMobile';
import { confirmDialog } from '../services/appDialog';
import '../styles/design-switcher.css';

interface Props {
  open: boolean;
  onClose: () => void;
  currentId: string;
  onSelect: (id: string) => void;
}

const tags: Record<string, string> = {
  'command-deck': '远距离', blackboard: '教室', emergency: '高对比', 'clean-focus': '日常', editorial: '投影',
  'sunrise-schedule': '明亮', 'palette-dashboard': '数据', 'orbit-focus': '聚焦', 'peach-task-board': '轻松',
  'poster-grid': '海报', 'ice-columns': '分栏', 'neon-quartz': '暗场', 'cinema-redline': '暗场',
};
const groups: Array<{ theme: DesignTheme; title: string; hint: string }> = [
  { theme: 'light', title: '亮色设计', hint: '明亮教室、投影与日常考场' },
  { theme: 'dark', title: '暗色设计', hint: '暗场环境、远距离与高对比显示' },
];

export default function DesignSwitcher({ open, onClose, currentId, onSelect }: Props) {
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('exam_design_favorites') || '[]'); } catch { return []; }
  });
  const mobile = useIsMobile();
  const toggleFavorite = (id: string) => {
    const next = favorites.includes(id) ? favorites.filter(value => value !== id) : [...favorites, id];
    setFavorites(next);
    localStorage.setItem('exam_design_favorites', JSON.stringify(next));
  };

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        const index = DESIGNS.findIndex(design => design.id === currentId);
        onSelect(DESIGNS[(index + 1) % DESIGNS.length].id);
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        const index = DESIGNS.findIndex(design => design.id === currentId);
        onSelect(DESIGNS[(index + DESIGNS.length - 1) % DESIGNS.length].id);
      }
      if (event.key === 'Enter') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentId, onClose, onSelect, open]);

  if (!open) return null;
  return <div className="dsw-overlay" role="dialog" aria-modal="true" aria-label="展示设计切换" onClick={onClose}>
    <div className="dsw-window" onClick={event => event.stopPropagation()}>
      <header className="dsw-window__bar"><div><b>选择展示设计</b><span>{DESIGNS.length} 套方案</span></div><button onClick={onClose} aria-label="关闭"><X /></button></header>
      <main className="dsw-window__body">
        {mobile && <div className="dsw-mobile-note"><Smartphone aria-hidden="true" />手机端仅已适配的设计可直接使用；其余设计标记为“电脑端最佳”，切换前会提示。</div>}
        {groups.map(group => {
          const list = DESIGNS.filter(design => design.theme === group.theme);
          return <section className={`dsw-group dsw-group--${group.theme}`} key={group.theme}>
            <header><div><h2>{group.title}</h2><p>{group.hint}</p></div><b>{list.length}</b></header>
            <div className="dsw-group__grid">{list.map(design => {
              const active = design.id === currentId;
              const locked = mobile && !design.mobileReady;
              const selectDesign = async () => {
                if (locked) {
                  if (await confirmDialog({ title: '设计尚未适配手机', message: `“${design.name}”在手机上可能显示不全。\n建议在电脑端查看完整效果。`, tone: 'warning', confirmLabel: '仍然切换' })) onSelect(design.id);
                } else onSelect(design.id);
              };
              return <div className={`dsw-card ${active ? 'is-active' : ''} ${locked ? 'is-locked' : ''}`} key={design.id} onClick={() => void selectDesign()} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') void selectDesign(); }} role="button" tabIndex={0} aria-pressed={active} title={locked ? '该设计未适配手机端，电脑端效果最佳' : undefined}>
                <span className="dsw-card__thumb"><img src={design.thumb} alt={`${design.name} 样例`} loading="lazy" decoding="async" />{active && <i><Check aria-hidden="true" /></i>}{locked && <b className="dsw-card__lock"><LockKeyhole aria-hidden="true" />电脑端最佳</b>}</span>
                <span><strong>{design.name}{active && <em>当前</em>}{mobile && design.mobileReady && !active && <em className="dsw-card__ok">手机适配</em>}<button type="button" className="dsw-fav" aria-label={favorites.includes(design.id) ? '取消收藏设计' : '收藏设计'} onClick={event => { event.stopPropagation(); toggleFavorite(design.id); }}><Star fill={favorites.includes(design.id) ? 'currentColor' : 'none'} /></button></strong><small>{design.description} · {tags[design.id] || '展示'}</small></span>
              </div>;
            })}</div>
          </section>;
        })}
      </main>
      <footer className="dsw-window__foot"><span>选中后即时生效，不改变考试数据</span><button onClick={onClose}>完成</button></footer>
    </div>
  </div>;
}
