export class AuthDataIntegrityError extends Error {
  constructor(table: string, detail: string) {
    super(`Unexpected row shape from "${table}": ${detail}`);
    this.name = "AuthDataIntegrityError";
  }
}

type FieldGuard<T> = (value: unknown) => value is T;

/**
 * PostgreSQL int8 values may be returned by the Neon driver as decimal strings.
 * We only accept values that can still be represented exactly by JavaScript.
 */
export type DatabaseInt8 = number | string;

export const isString: FieldGuard<string> = (value): value is string => typeof value === "string";
export const isNumberLike: FieldGuard<number> = (value): value is number =>
  typeof value === "number" && Number.isFinite(value);
export const isDatabaseInt8: FieldGuard<DatabaseInt8> = (value): value is DatabaseInt8 =>
  (typeof value === "number" && Number.isSafeInteger(value)) ||
  (typeof value === "string" && /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value)));
export const isBoolean: FieldGuard<boolean> = (value): value is boolean => typeof value === "boolean";
export const isNullableString: FieldGuard<string | null | undefined> = (
  value,
): value is string | null | undefined => value == null || typeof value === "string";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function rowShape<T extends Record<string, unknown>>(
  fields: { [K in keyof T]: FieldGuard<T[K]> },
): (value: unknown) => value is T {
  const keys = Object.keys(fields) as Array<keyof T>;
  return (value: unknown): value is T => {
    if (!isRecord(value)) return false;
    for (const key of keys) {
      if (!fields[key]((value as Record<string, unknown>)[key as string])) return false;
    }
    return true;
  };
}

export function assertRows<T>(
  rows: unknown,
  isRow: (value: unknown) => value is T,
  table: string,
): T[] {
  if (!Array.isArray(rows)) {
    throw new AuthDataIntegrityError(table, `expected an array of rows, got ${typeof rows}`);
  }
  for (let index = 0; index < rows.length; index += 1) {
    if (!isRow(rows[index])) {
      throw new AuthDataIntegrityError(table, `row at index ${index} does not match the expected shape`);
    }
  }
  return rows as T[];
}
