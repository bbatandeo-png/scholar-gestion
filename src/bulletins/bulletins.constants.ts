import { LevelCycle, Periode } from '../common/enums/domain.enums';

export const PERIODES_BY_CYCLE: Record<LevelCycle, Periode[]> = {
  [LevelCycle.COLLEGE]: [
    Periode.TRIMESTRE_1,
    Periode.TRIMESTRE_2,
    Periode.TRIMESTRE_3,
  ],
  [LevelCycle.LYCEE]: [Periode.SEMESTRE_1, Periode.SEMESTRE_2],
};

export const PERIODE_LABELS: Record<Periode, string> = {
  [Periode.TRIMESTRE_1]: '1er Trimestre',
  [Periode.TRIMESTRE_2]: '2eme Trimestre',
  [Periode.TRIMESTRE_3]: '3eme Trimestre',
  [Periode.SEMESTRE_1]: '1er Semestre',
  [Periode.SEMESTRE_2]: '2eme Semestre',
};
