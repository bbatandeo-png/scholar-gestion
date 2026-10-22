// Recherche tolerante : « eleonore » trouve « Éléonore » (rapport A09), et
// les caracteres speciaux saisis sont cherches tels quels, jamais
// interpretes comme une expression reguliere.

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Minuscules et majuscules accentuees dans chaque groupe : la recherche ne
// depend pas de la gestion des majuscules accentuees par la base.
const ACCENT_GROUPS: Record<string, string> = {
  a: 'aàáâãäåAÀÁÂÃÄÅ',
  c: 'cçCÇ',
  e: 'eèéêëEÈÉÊË',
  i: 'iìíîïIÌÍÎÏ',
  n: 'nñNÑ',
  o: 'oòóôõöOÒÓÔÕÖ',
  u: 'uùúûüUÙÚÛÜ',
  y: 'yýÿYÝŸ',
};

export function accentInsensitivePattern(value: string) {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return Array.from(normalized)
    .map((character) => {
      const group = ACCENT_GROUPS[character.toLowerCase()];
      return group ? `[${group}]` : escapeRegExp(character);
    })
    .join('');
}

export function accentInsensitiveRegExp(value: string) {
  return new RegExp(accentInsensitivePattern(value.trim()), 'i');
}
