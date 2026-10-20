// Formatage des montants (FCFA) commun a toute l'application : pages
// (filtres nunjucks "money" / "amount"), PDF et textes generes cote client
// (meme algorithme dans layout.njk, window.formatMoney).
//
// Volontairement sans Intl.NumberFormat : l'executable Windows (pkg, Node
// avec ICU reduit) formaterait "fr-FR" a l'anglaise ("125,000").

// Espace insecable fine, separateur de milliers typographique francais.
const NARROW_NBSP = ' ';
const NBSP = ' ';

export type FormatMoneyOptions = {
  // Espaces ordinaires (PDF : les polices standard de pdfkit n'ont pas les
  // espaces insecables et afficheraient un caractere de remplacement).
  plainSpaces?: boolean;
};

/** "125000" -> "125 000" ; "12500.5" -> "12 500,50" ; vide/invalide -> "". */
export function formatAmount(
  value: unknown,
  options: FormatMoneyOptions = {},
): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) {
    return '';
  }
  const separator = options.plainSpaces ? ' ' : NARROW_NBSP;
  const rounded = Math.round(number * 100) / 100;
  const [integerPart, decimals] = Math.abs(rounded).toFixed(2).split('.');
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  const sign = rounded < 0 ? '-' : '';
  return decimals === '00'
    ? `${sign}${grouped}`
    : `${sign}${grouped},${decimals}`;
}

/** "125000" -> "125 000 FCFA" (vide si la valeur est vide ou invalide). */
export function formatMoney(
  value: unknown,
  options: FormatMoneyOptions = {},
): string {
  const amount = formatAmount(value, options);
  if (amount === '') {
    return '';
  }
  return `${amount}${options.plainSpaces ? ' ' : NBSP}FCFA`;
}
