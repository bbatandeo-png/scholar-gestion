import { Request } from 'express';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { SchoolYearsService } from '../school-years/school-years.service';

function buildController(
  dashboardService: Pick<DashboardService, 'getSummary'>,
  schoolYearsService: Pick<SchoolYearsService, 'resolveSelected'>,
): DashboardController {
  return new DashboardController(
    dashboardService as unknown as DashboardService,
    schoolYearsService as unknown as SchoolYearsService,
  );
}

const fakeRequest = { session: {} } as unknown as Request;

describe('DashboardController.index', () => {
  it("affiche un etat de bienvenue au lieu de planter quand aucune annee scolaire n'est ouverte", async () => {
    const dashboardService = { getSummary: jest.fn() };
    const schoolYearsService = {
      resolveSelected: jest
        .fn()
        .mockRejectedValue(new Error('Aucune annee scolaire ouverte')),
    };
    const controller = buildController(dashboardService, schoolYearsService);

    const result = await controller.index(fakeRequest);

    expect(result).toEqual({
      title: 'Dashboard',
      summary: null,
      selectedYear: null,
    });
    expect(dashboardService.getSummary).not.toHaveBeenCalled();
  });

  it('affiche le resume normal quand une annee scolaire est resolue', async () => {
    const year = { _id: 'year-1', label: '2025-2026' };
    const dashboardService = {
      getSummary: jest.fn().mockResolvedValue({ totalStudents: 42 }),
    };
    const schoolYearsService = {
      resolveSelected: jest.fn().mockResolvedValue(year),
    };
    const controller = buildController(dashboardService, schoolYearsService);

    const result = await controller.index(fakeRequest);

    expect(dashboardService.getSummary).toHaveBeenCalledWith('year-1');
    expect(result).toEqual({
      title: 'Dashboard',
      summary: { totalStudents: 42 },
      selectedYear: year,
    });
  });
});
