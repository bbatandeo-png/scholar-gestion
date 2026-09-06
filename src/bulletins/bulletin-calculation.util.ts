import { SubjectCategory } from '../common/enums/domain.enums';

/**
 * Pure calculation functions for the bulletin PDF (see
 * BulletinsService.validateSession() for where these are invoked, and
 * "Cahier charge bulletin.docx" at the project root for the source
 * specification these formulas implement exactly).
 *
 * Shared rule, already established on Note: a missing (null) grade is
 * excluded from any average it would feed into; a grade of 0 counts
 * normally. Every average is rounded to 2 decimals.
 */

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Average of the non-null values in the list, or null if none are present. */
export function averageOfPresent(
  values: Array<number | null | undefined>,
): number | null {
  const present = values.filter(
    (v): v is number => v !== null && v !== undefined,
  );
  if (present.length === 0) {
    return null;
  }
  return round2(present.reduce((sum, v) => sum + v, 0) / present.length);
}

export type SubjectNoteInput = {
  i1: number | null;
  i2: number | null;
  devoir: number | null;
  compo: number | null;
  coefficient: number;
};

export type SubjectAverages = {
  moyenneClasse: number | null;
  moyennePeriode: number | null;
  moyenneDefinitive: number | null;
};

/**
 * Moy. Classe = average of {i1, i2, devoir} (never compo).
 * Moy. Période = average of {Moy. Classe, Compo}.
 * Moy. Définitive = Moy. Période x coefficient.
 * A subject with literally no grade at all (all four fields null) yields
 * moyenneDefinitive: null - it is then excluded entirely from every
 * downstream sum (group averages, total points/coef) rather than counted
 * as a zero, since it was never assessed this period.
 */
export function computeSubjectAverages(
  input: SubjectNoteInput,
): SubjectAverages {
  const moyenneClasse = averageOfPresent([input.i1, input.i2, input.devoir]);
  const moyennePeriode = averageOfPresent([moyenneClasse, input.compo]);
  const moyenneDefinitive =
    moyennePeriode === null ? null : round2(moyennePeriode * input.coefficient);
  return { moyenneClasse, moyennePeriode, moyenneDefinitive };
}

const APPRECIATION_THRESHOLDS = [6, 7, 8, 10, 12, 14, 16, 18];

const APPRECIATION_LABELS_MATIERE = [
  'Très faible',
  'Faible',
  'Très insuffisant',
  'Insuffisant',
  'Passable',
  'Assez Bien',
  'Bien',
  'Très Bien',
  'Excellent(e)',
];

const APPRECIATION_LABELS_GENERALE = [
  'Travail très faible',
  'Faible travail',
  'Travail très insuffisant',
  'Travail insuffisant',
  'Travail passable',
  'Assez bon travail',
  'Bon travail',
  'Très bon travail',
  'Travail excellent',
];

/** Grid lookup: <6/<7/<8/<10/<12/<14/<16/<18/>=18, two label sets per the spec. */
export function appreciationFor(
  value: number,
  variant: 'matiere' | 'generale',
): string {
  const labels =
    variant === 'matiere'
      ? APPRECIATION_LABELS_MATIERE
      : APPRECIATION_LABELS_GENERALE;
  const index = APPRECIATION_THRESHOLDS.findIndex(
    (threshold) => value < threshold,
  );
  return index === -1 ? labels[labels.length - 1] : labels[index];
}

/**
 * Standard "1-2-2-4" competition ranking, descending by value. Items with a
 * null value get a null rank (excluded from the competition - e.g. a
 * subject nobody in the class was graded on yet). Rank 1 is rendered
 * "1ère"/"1er" per that item's own gender (each student's own bulletin
 * reflects their own gender when they land in first place); every other
 * rank is "Nème" regardless of gender, per the spec.
 */
export function rankBy<T>(
  items: T[],
  getId: (item: T) => string,
  getValue: (item: T) => number | null,
  getGender?: (item: T) => string | undefined,
): Map<string, string | null> {
  const ranked = items
    .map((item) => ({ id: getId(item), value: getValue(item), item }))
    .filter(
      (entry): entry is { id: string; value: number; item: T } =>
        entry.value !== null,
    )
    .sort((a, b) => b.value - a.value);

  const result = new Map<string, string | null>();
  for (const item of items) {
    result.set(getId(item), null);
  }

  let position = 0;
  let previousValue: number | null = null;
  let sameValueCount = 0;
  for (const entry of ranked) {
    if (entry.value === previousValue) {
      sameValueCount += 1;
    } else {
      position += sameValueCount + 1;
      sameValueCount = 0;
      previousValue = entry.value;
    }
    const label =
      position === 1
        ? getGender?.(entry.item) === 'F'
          ? '1ère'
          : '1er'
        : `${position}ème`;
    result.set(entry.id, label);
  }
  return result;
}

export type CategorySubjectResult = {
  category: SubjectCategory;
  moyenneDefinitive: number | null;
  coefficient: number;
};

/**
 * Moyenne d'un groupe de matières (littéraire/scientifique/autre) = somme
 * des Moy. Définitives du groupe / somme de leurs coefficients. Les
 * matières sans note ce trimestre (moyenneDefinitive null) sont exclues des
 * deux sommes. Null si aucune matière du groupe n'a de note.
 */
export function computeGroupAverage(
  subjectResults: CategorySubjectResult[],
  category: SubjectCategory,
): number | null {
  const graded = subjectResults.filter(
    (s) => s.category === category && s.moyenneDefinitive !== null,
  );
  if (graded.length === 0) {
    return null;
  }
  const totalDefinitive = graded.reduce(
    (sum, s) => sum + (s.moyenneDefinitive as number),
    0,
  );
  const totalCoef = graded.reduce((sum, s) => sum + s.coefficient, 0);
  return round2(totalDefinitive / totalCoef);
}

export type StudentPeriodTotals = {
  totalPoints: number;
  totalCoef: number;
  moyenneGenerale: number;
};

/**
 * Total points = somme de toutes les Moy. Définitives (toutes catégories
 * confondues). Total coef. = somme de tous les coefficients. MGP = Total
 * points / Total coef. Matières sans note exclues des deux sommes, comme
 * pour computeGroupAverage. Throws if every subject is ungraded (a session
 * can't be validated with zero graded subjects for a matched student - the
 * caller is expected to have already guaranteed at least one).
 */
export function computeStudentPeriodTotals(
  subjectResults: Array<{
    moyenneDefinitive: number | null;
    coefficient: number;
  }>,
): StudentPeriodTotals {
  const graded = subjectResults.filter((s) => s.moyenneDefinitive !== null);
  const totalPoints = round2(
    graded.reduce((sum, s) => sum + (s.moyenneDefinitive as number), 0),
  );
  const totalCoef = graded.reduce((sum, s) => sum + s.coefficient, 0);
  if (totalCoef === 0) {
    throw new Error(
      'Impossible de calculer la moyenne generale : aucune matiere notee',
    );
  }
  return {
    totalPoints,
    totalCoef,
    moyenneGenerale: round2(totalPoints / totalCoef),
  };
}
