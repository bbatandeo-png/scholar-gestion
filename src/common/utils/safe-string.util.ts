// Stringifies a value of unknown shape (a Mongoose id, ref, or populated
// sub-document) without risking the default Object.prototype rendering
// ("[object Object]") that a bare String(x)/`${x}` can produce when x turns
// out not to be a primitive after all.
export function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (typeof value === 'object' && 'toString' in value) {
    const rendered = (value as { toString(): string }).toString();
    if (rendered !== '[object Object]') {
      return rendered;
    }
  }
  return JSON.stringify(value);
}
