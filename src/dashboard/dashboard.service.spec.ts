import { DashboardService } from './dashboard.service';

describe('DashboardService financial summary', () => {
  const service = new DashboardService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  it('calcule le taux de recouvrement uniquement sur l ecolage', () => {
    const summary = service.calculateFinancialSummary(
      [
        {
          registrationFee: 6000,
          tuitionFee: 80000,
          discountAmount: 0,
          paidAmount: 56000,
          balanceDue: 30000,
        },
      ],
      [],
    );

    expect(summary.registrationRevenue).toBe(6000);
    expect(summary.tuitionRevenue).toBe(50000);
    expect(summary.tuitionExpected).toBe(80000);
    expect(summary.recoveryRate).toBe(63);
  });

  it('deduit les reductions de l ecolage attendu et plafonne l encaissement', () => {
    const summary = service.calculateFinancialSummary(
      [
        {
          registrationFee: 6000,
          tuitionFee: 80000,
          discountAmount: 10000,
          paidAmount: 86000,
          balanceDue: 0,
        },
      ],
      [],
    );

    expect(summary.tuitionExpected).toBe(70000);
    expect(summary.tuitionRevenue).toBe(70000);
    expect(summary.recoveryRate).toBe(100);
  });
});
