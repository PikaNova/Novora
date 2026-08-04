export function canonicalizeForCompare(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeForCompare);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce((result: Record<string, unknown>, key) => {
        result[key] = canonicalizeForCompare(
          (value as Record<string, unknown>)[key],
        );
        return result;
      }, {});
  }
  return value;
}

export const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canonicalizeForCompare(left ?? null)) ===
  JSON.stringify(canonicalizeForCompare(right ?? null));
