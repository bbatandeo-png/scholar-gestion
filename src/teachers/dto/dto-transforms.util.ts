// Shared across this module's DTOs - a blank <input>/<select> submits '',
// which must become undefined for @IsOptional() to skip it (see
// stock/dto/create-stock-item.dto.ts's own comment on why the empty-check
// has to run before any numeric coercion).
export const emptyToUndefined = ({ value }: { value: unknown }): unknown =>
  value === '' ? undefined : value;

export function toOptionalInt({ value }: { value: unknown }) {
  if (value === '' || value === undefined || value === null) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? value : parsed;
}
