// Date courte "jj/mm/aaaa" pour les dates sans heure (date d'une depense,
// d'une echeance...). Lue en UTC : ces dates sont stockees a minuit UTC, et
// un fuseau a l'ouest de Greenwich les afficherait sinon la veille. Sans
// Intl (voir format-money.ts : executable Windows a ICU reduit).
export function formatDay(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const date =
    value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}
