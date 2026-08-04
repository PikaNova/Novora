/** Design-assignment policy normalization. */

import type { DesignAssignmentRule, DesignPolicy } from '../../types/exam.js';

export const DEFAULT_DESIGN_POLICY: DesignPolicy = { rules: [], updatedAt: 0 };

/**
 * Removes malformed rules and preserves the existing all-school override behavior.
 * An all-school rule overrides every narrower rule, so only the newest one remains.
 */
export function normalizeDesignPolicy(raw: unknown): DesignPolicy {
  const src = (raw ?? {}) as Partial<DesignPolicy>;
  const rules: DesignAssignmentRule[] = Array.isArray(src.rules)
    ? src.rules.filter((rule): rule is DesignAssignmentRule => !!rule && typeof rule.designId === 'string')
    : [];
  const schoolRule = [...rules].reverse().find(rule => rule.scope === 'school');
  return {
    rules: schoolRule ? [schoolRule] : rules,
    updatedAt: Number(src.updatedAt ?? 0),
  };
}
