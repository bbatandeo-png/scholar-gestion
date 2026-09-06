import { DashboardController } from './dashboard.controller';

describe('DashboardController.index', () => {
  it("affiche un etat de bienvenue au lieu de planter quand aucune annee scolaire n'est ouverte", async () => {
    const dashboardService = { getSummary: jest.fn() };
    const schoolYearsService = {
      resolveSelected: jest
        .fn()
        .mockRejectedValue(new Error('Aucune annee scolaire ouverte')),
    };
    const controller = new DashboardController(
      dashboardService as any,
      schoolYearsService as any,
    );

    const result = await controller.index({ session: {} } as any);

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
    const controller = new DashboardController(
      dashboardService as any,
      schoolYearsService as any,
    );

    const result = await controller.index({ session: {} } as any);

    expect(dashboardService.getSummary).toHaveBeenCalledWith('year-1');
    expect(result).toEqual({
      title: 'Dashboard',
      summary: { totalStudents: 42 },
      selectedYear: year,
    });
  });
});
