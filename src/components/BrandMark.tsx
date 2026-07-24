import React from 'react';
import { BRAND_ICON, BRAND_NAME, BRAND_PRODUCT } from '../constants/brand';

export default function BrandMark({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  return <span className={`brand-mark${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`}>
    <img src={BRAND_ICON} alt="" aria-hidden="true" />
    <span><strong>{BRAND_NAME}</strong>{!compact && <small>{BRAND_PRODUCT}</small>}</span>
  </span>;
}
