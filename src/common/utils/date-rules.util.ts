import { BadRequestException } from '@nestjs/common';

// Regles de coherence des dates saisies (rapport A03, A07). Les dates des
// formulaires arrivent en "AAAA-MM-JJ" : on compare au jour pres, sans
// heure, pour qu'une saisie du jour meme soit toujours acceptee.

function toDay(value: string | Date | undefined | null) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function today() {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

// Naissance, incident disciplinaire... : jamais dans le futur.
export function assertNotInFuture(
  value: string | Date | undefined | null,
  label: string,
) {
  const day = toDay(value);
  if (day !== null && day > today()) {
    throw new BadRequestException(`${label} ne peut pas être dans le futur.`);
  }
}

export function assertEndAfterStart(
  start: string | Date | undefined | null,
  end: string | Date | undefined | null,
  message = 'La date de fin doit être postérieure à la date de début.',
) {
  const startDay = toDay(start);
  const endDay = toDay(end);
  if (startDay !== null && endDay !== null && endDay <= startDay) {
    throw new BadRequestException(message);
  }
}

// Une embauche suppose un age minimum (16 ans) a la date d'embauche.
export const MIN_HIRING_AGE = 16;

export function assertHiredAfterMinimumAge(
  birthDate: string | Date | undefined | null,
  hireDate: string | Date | undefined | null,
) {
  const birth = toDay(birthDate);
  const hire = toDay(hireDate);
  if (birth === null || hire === null) {
    return;
  }
  const birthAsDate = new Date(birth);
  const minimum = Date.UTC(
    birthAsDate.getUTCFullYear() + MIN_HIRING_AGE,
    birthAsDate.getUTCMonth(),
    birthAsDate.getUTCDate(),
  );
  if (hire < minimum) {
    throw new BadRequestException(
      `La date d'embauche doit être postérieure aux ${MIN_HIRING_AGE} ans de l'enseignant.`,
    );
  }
}

// Une annee scolaire « 2025 - 2026 » commence en 2025 et finit en 2026
// (rapport A25) : le libelle et les dates ne doivent pas se contredire.
export function assertSchoolYearCoherent(
  label: string | undefined,
  startDate: string | Date | undefined,
  endDate: string | Date | undefined,
) {
  assertEndAfterStart(
    startDate,
    endDate,
    "La date de fin de l'année scolaire doit être postérieure à sa date de début.",
  );
  const years = /(\d{4})\D+(\d{4})/.exec(label ?? '');
  const start = toDay(startDate);
  const end = toDay(endDate);
  if (!years || start === null || end === null) {
    return;
  }
  const startYear = new Date(start).getUTCFullYear();
  const endYear = new Date(end).getUTCFullYear();
  if (startYear !== Number(years[1]) || endYear !== Number(years[2])) {
    throw new BadRequestException(
      `Le libellé « ${label} » ne correspond pas aux dates : l'année doit commencer en ${years[1]} et finir en ${years[2]}.`,
    );
  }
}
