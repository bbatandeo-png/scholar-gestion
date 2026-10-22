import { Request } from 'express';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { LevelsService } from '../levels/levels.service';
import { SchoolYearsService } from '../school-years/school-years.service';

function buildController(
  dashboardService: Pick<
    DashboardService,
    'getSummary' | 'getMonthlyEncaissements'
  >,
  schoolYearsService: Pick<SchoolYearsService, 'resolveSelected'>,
  levelsService: Pick<LevelsService, 'listForSchoolYear'> = {
    listForSchoolYear: jest.fn().mockResolvedValue([]),
  },
): DashboardController {
  return new DashboardController(
    dashboardService as unknown as DashboardService,
    schoolYearsService as unknown as SchoolYearsService,
    levelsService as unknown as LevelsService,
  );
}

const fakeRequest = { session: {} } as unknown as Request;

const emptyEncaissements = {
  months: [],
  currentYearLabel: '',
  previousYearLabel: null,
};

describe('DashboardController.index', () => {
  it("affiche un etat de bienvenue au lieu de planter quand aucune annee scolaire n'est ouverte", async () => {
    const dashboardService = {
      getSummary: jest.fn(),
      getMonthlyEncaissements: jest.fn(),
    };
    const schoolYearsService = {
      resolveSelected: jest
        .fn()
        .mockRejectedValue(new Error('Aucune annee scolaire ouverte')),
    };
    const controller = buildController(dashboardService, schoolYearsService);

    const result = await controller.index(fakeRequest);

    expect(result).toEqual({
      title: 'Tableau de bord',
      summary: null,
      selectedYear: null,
    });
    expect(dashboardService.getSummary).not.toHaveBeenCalled();
    expect(dashboardService.getMonthlyEncaissements).not.toHaveBeenCalled();
  });

  it('affiche le resume normal quand une annee scolaire est resolue', async () => {
    const year = { _id: 'year-1', label: '2025-2026' };
    const dashboardService = {
      getSummary: jest.fn().mockResolvedValue({ totalStudents: 42 }),
      getMonthlyEncaissements: jest.fn().mockResolvedValue(emptyEncaissements),
    };
    const schoolYearsService = {
      resolveSelected: jest.fn().mockResolvedValue(year),
    };
    const controller = buildController(dashboardService, schoolYearsService);

    const result = await controller.index(fakeRequest);

    expect(dashboardService.getSummary).toHaveBeenCalledWith('year-1', {
      levelId: undefined,
      dateFrom: undefined,
      dateTo: undefined,
    });
    expect(dashboardService.getMonthlyEncaissements).toHaveBeenCalledWith(
      'year-1',
    );
    expect(result).toEqual({
      title: 'Tableau de bord',
      summary: { totalStudents: 42 },
      selectedYear: year,
      levels: [],
      encaissements: emptyEncaissements,
      filters: { levelId: '', dateFrom: '', dateTo: '' },
      datesSwapped: false,
    });
  });

  it('convertit les dates du filtre en bornes UTC et les inverse si dateFrom > dateTo', async () => {
    const year = { _id: 'year-1', label: '2025-2026' };
    const dashboardService = {
      getSummary: jest.fn().mockResolvedValue({ totalStudents: 1 }),
      getMonthlyEncaissements: jest.fn().mockResolvedValue(emptyEncaissements),
    };
    const schoolYearsService = {
      resolveSelected: jest.fn().mockResolvedValue(year),
    };
    const controller = buildController(dashboardService, schoolYearsService);

    const result = await controller.index(
      fakeRequest,
      undefined,
      '2026-09-30',
      '2026-09-01',
    );

    expect(dashboardService.getSummary).toHaveBeenCalledWith('year-1', {
      levelId: undefined,
      dateFrom: new Date('2026-09-01T00:00:00.000Z'),
      dateTo: new Date('2026-09-30T23:59:59.999Z'),
    });
    // The re-rendered date inputs must match what was actually applied,
    // not the order the user happened to type them in.
    expect(result.filters).toEqual({
      levelId: '',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    });
    // Rapport A20 : l'inversion est signalee a l'utilisateur.
    expect(result.datesSwapped).toBe(true);
  });

  it('ignore une date invalide plutot que de planter', async () => {
    const year = { _id: 'year-1', label: '2025-2026' };
    const dashboardService = {
      getSummary: jest.fn().mockResolvedValue({ totalStudents: 1 }),
      getMonthlyEncaissements: jest.fn().mockResolvedValue(emptyEncaissements),
    };
    const schoolYearsService = {
      resolveSelected: jest.fn().mockResolvedValue(year),
    };
    const controller = buildController(dashboardService, schoolYearsService);

    await controller.index(fakeRequest, undefined, 'pas-une-date', undefined);

    expect(dashboardService.getSummary).toHaveBeenCalledWith('year-1', {
      levelId: undefined,
      dateFrom: undefined,
      dateTo: undefined,
    });
  });
});
