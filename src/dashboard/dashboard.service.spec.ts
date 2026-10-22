import { Model } from 'mongoose';
import { DashboardService } from './dashboard.service';
import { Student } from '../students/schemas/student.schema';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { Invoice } from '../billing/schemas/invoice.schema';
import { Arrear } from '../arrears/schemas/arrear.schema';
import { Expense } from '../expenses/schemas/expense.schema';
import { Payment } from '../payments/schemas/payment.schema';
import { ArrearCarryForward } from '../arrears/schemas/arrear-carry-forward.schema';
import { Level } from '../levels/schemas/level.schema';
import { SchoolYear } from '../school-years/schemas/school-year.schema';
import { AuditService } from '../audit/audit.service';

describe('DashboardService financial summary', () => {
  const service = new DashboardService(
    {} as unknown as Model<Student>,
    {} as unknown as Model<Enrollment>,
    {} as unknown as Model<Invoice>,
    {} as unknown as Model<Arrear>,
    {} as unknown as Model<Expense>,
    {} as unknown as Model<Payment>,
    {} as unknown as Model<ArrearCarryForward>,
    {} as unknown as Model<Level>,
    {} as unknown as Model<SchoolYear>,
    {} as unknown as AuditService,
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

describe('DashboardService.getMonthlyEncaissements', () => {
  // Mongoose chains used by the method: findById().lean().exec(),
  // findOne().sort().lean().exec(), find().select().lean().exec().
  function mockFindById(result: unknown) {
    return jest.fn().mockReturnValue({
      lean: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(result) }),
    });
  }
  function mockFindOneSort(result: unknown) {
    return jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest
          .fn()
          .mockReturnValue({ exec: jest.fn().mockResolvedValue(result) }),
      }),
    });
  }
  function mockFindSelect(
    byYear: Record<string, Array<{ amount: number; paidAt: Date }>>,
  ) {
    return jest.fn().mockImplementation((query: { schoolYearId: string }) => ({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(byYear[query.schoolYearId] ?? []),
        }),
      }),
    }));
  }

  function buildService(opts: {
    currentYear: {
      _id: string;
      label: string;
      startDate: Date;
      endDate: Date;
    } | null;
    previousYear: { _id: string; label: string; startDate: Date } | null;
    paymentsByYear: Record<string, Array<{ amount: number; paidAt: Date }>>;
  }) {
    const findById = mockFindById(opts.currentYear);
    const findOne = mockFindOneSort(opts.previousYear);
    const find = mockFindSelect(opts.paymentsByYear);
    const service = new DashboardService(
      {} as unknown as Model<Student>,
      {} as unknown as Model<Enrollment>,
      {} as unknown as Model<Invoice>,
      {} as unknown as Model<Arrear>,
      {} as unknown as Model<Expense>,
      { find } as unknown as Model<Payment>,
      {} as unknown as Model<ArrearCarryForward>,
      {} as unknown as Model<Level>,
      { findById, findOne } as unknown as Model<SchoolYear>,
      {} as unknown as AuditService,
    );
    return { service, find };
  }

  beforeEach(() => {
    // Pins "today" (only affects bare `new Date()`/`Date.now()` - `new
    // Date(arg)` keeps working normally) so the number of elapsed academic
    // months, and hence this suite's expectations, don't silently drift as
    // real time passes.
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(new Date('2026-11-15T00:00:00.000Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('aligne le mois N de l annee precedente sur le mois N de l annee en cours, pas le meme mois civil', async () => {
    const { service, find } = buildService({
      currentYear: {
        _id: 'year-2',
        label: '2026-2027',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        endDate: new Date('2027-07-31T00:00:00.000Z'),
      },
      previousYear: {
        _id: 'year-1',
        label: '2025-2026',
        startDate: new Date('2025-09-01T00:00:00.000Z'),
      },
      paymentsByYear: {
        'year-2': [
          { amount: 20_000_000, paidAt: new Date('2026-09-10T00:00:00.000Z') },
          { amount: 15_500_000, paidAt: new Date('2026-10-20T00:00:00.000Z') },
        ],
        'year-1': [
          { amount: 18_000_000, paidAt: new Date('2025-09-05T00:00:00.000Z') },
          { amount: 12_300_000, paidAt: new Date('2025-10-25T00:00:00.000Z') },
          { amount: 9_000_000, paidAt: new Date('2025-11-01T00:00:00.000Z') },
        ],
      },
    });

    const result = await service.getMonthlyEncaissements('year-2');

    // "Today" is pinned to 15 nov 2026, so only SEP/OCT/NOV of the current
    // year have elapsed - the previous year's november (9M) must be
    // included too, aligned by position, even though no current-year
    // payment exists yet that month.
    expect(result.currentYearLabel).toBe('2026-2027');
    expect(result.previousYearLabel).toBe('2025-2026');
    expect(result.months).toEqual([
      { label: 'SEP', currentYear: 20_000_000, previousYear: 18_000_000 },
      { label: 'OCT', currentYear: 15_500_000, previousYear: 12_300_000 },
      { label: 'NOV', currentYear: 0, previousYear: 9_000_000 },
    ]);
    expect(find).toHaveBeenCalledWith({
      schoolYearId: 'year-2',
      kind: 'payment',
    });
    expect(find).toHaveBeenCalledWith({
      schoolYearId: 'year-1',
      kind: 'payment',
    });
  });

  it("retourne des colonnes a zero et aucune 2e requete quand il n'y a pas d'annee precedente", async () => {
    const { service, find } = buildService({
      currentYear: {
        _id: 'year-1',
        label: '2026-2027',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        endDate: new Date('2027-07-31T00:00:00.000Z'),
      },
      previousYear: null,
      paymentsByYear: {
        'year-1': [
          { amount: 20_000_000, paidAt: new Date('2026-09-10T00:00:00.000Z') },
        ],
      },
    });

    const result = await service.getMonthlyEncaissements('year-1');

    expect(result.previousYearLabel).toBeNull();
    expect(result.months.every((m) => m.previousYear === 0)).toBe(true);
    expect(result.months[0]).toEqual({
      label: 'SEP',
      currentYear: 20_000_000,
      previousYear: 0,
    });
    expect(find).toHaveBeenCalledTimes(1);
  });

  // Rapport A01 : 37 000 FCFA encaisses en octobre donnaient 0 (millions arrondis).
  it('garde les petits montants en FCFA au lieu de les arrondir a zero', async () => {
    const { service } = buildService({
      currentYear: {
        _id: 'year-1',
        label: '2026-2027',
        startDate: new Date('2026-10-01T00:00:00.000Z'),
        endDate: new Date('2027-07-31T00:00:00.000Z'),
      },
      previousYear: null,
      paymentsByYear: {
        'year-1': [
          { amount: 30_000, paidAt: new Date('2026-10-19T00:00:00.000Z') },
          { amount: 7_000, paidAt: new Date('2026-10-21T00:00:00.000Z') },
        ],
      },
    });

    const result = await service.getMonthlyEncaissements('year-1');

    expect(result.months[0]).toMatchObject({
      label: 'OCT',
      currentYear: 37_000,
    });
  });

  it('retourne une liste vide sans planter quand l annee scolaire est introuvable', async () => {
    const { service } = buildService({
      currentYear: null,
      previousYear: null,
      paymentsByYear: {},
    });

    const result = await service.getMonthlyEncaissements('missing-year');

    expect(result).toEqual({
      months: [],
      currentYearLabel: '',
      previousYearLabel: null,
    });
  });
});
