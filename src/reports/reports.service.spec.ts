import { Model } from 'mongoose';
import { ReportsService } from './reports.service';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { Invoice } from '../billing/schemas/invoice.schema';
import { Student } from '../students/schemas/student.schema';
import { Level } from '../levels/schemas/level.schema';
import { SchoolYear } from '../school-years/schemas/school-year.schema';
import { Payment } from '../payments/schemas/payment.schema';
import { EcolesService } from '../ecoles/ecoles.service';
import { SettingsService } from '../settings/settings.service';

// Every test below only exercises one or two of ReportsService's 8
// constructor dependencies - this builds a fully-stubbed instance and lets
// each test override just the mocks it actually cares about, instead of
// repeating 8 "{} as any" placeholders (and the associated lint noise) at
// every call site.
function createService(
  overrides: {
    enrollmentModel?: unknown;
    invoiceModel?: unknown;
    studentModel?: unknown;
    levelModel?: unknown;
    schoolYearModel?: unknown;
    paymentModel?: unknown;
    ecolesService?: unknown;
    settingsService?: unknown;
  } = {},
): ReportsService {
  return new ReportsService(
    (overrides.enrollmentModel ?? {}) as unknown as Model<Enrollment>,
    (overrides.invoiceModel ?? {}) as unknown as Model<Invoice>,
    (overrides.studentModel ?? {}) as unknown as Model<Student>,
    (overrides.levelModel ?? {}) as unknown as Model<Level>,
    (overrides.schoolYearModel ?? {}) as unknown as Model<SchoolYear>,
    (overrides.paymentModel ?? {}) as unknown as Model<Payment>,
    (overrides.ecolesService ?? {}) as unknown as EcolesService,
    (overrides.settingsService ?? {}) as unknown as SettingsService,
  );
}

describe('ReportsService', () => {
  it('filters registration-paid invoices by level and school year', async () => {
    const invoices = [
      {
        paidAmount: 1000,
        registrationFee: 1000,
        tuitionFee: 2000,
        balanceDue: 0,
        enrollmentId: {
          _id: 'enr-1',
          studentId: { lastname: 'A', firstname: 'Alice', matricule: 'M1' },
          schoolYearId: { _id: 'year-1', label: '2025-2026' },
          levelId: { _id: 'level-1', label: 'CP' },
        },
      },
      {
        paidAmount: 1000,
        registrationFee: 1000,
        tuitionFee: 2000,
        balanceDue: 0,
        enrollmentId: {
          _id: 'enr-2',
          studentId: { lastname: 'B', firstname: 'Bob', matricule: 'M2' },
          schoolYearId: { _id: 'year-2', label: '2026-2027' },
          levelId: { _id: 'level-2', label: 'CE1' },
        },
      },
    ];

    const invoiceModel = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(invoices),
          }),
        }),
      }),
    };

    const service = createService({ invoiceModel });

    const result = await service.registrationPaidStudents(
      'registration',
      'level-1',
      'year-1',
    );

    expect(result).toHaveLength(1);
    expect(result[0].enrollmentId?.studentId?.lastname).toBe('A');
    expect(result[0]).toMatchObject({
      amountDue: 1000,
      amountPaid: 1000,
      balanceDue: 0,
    });
  });

  it('separates registration payments from tuition payments', async () => {
    const invoices = [
      {
        paidAmount: 1600,
        registrationFee: 1000,
        tuitionFee: 2200,
        discountAmount: 200,
        enrollmentId: {
          studentId: { lastname: 'Abalo', firstname: 'Koffi' },
          schoolYearId: { _id: 'year-1' },
          levelId: { _id: 'level-1' },
        },
      },
    ];
    const invoiceModel = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(invoices),
          }),
        }),
      }),
    };
    const service = createService({ invoiceModel });

    const registration = await service.registrationPaidStudents('registration');
    const tuition = await service.registrationPaidStudents('tuition');

    expect(registration[0]).toMatchObject({
      amountDue: 1000,
      amountPaid: 1000,
      balanceDue: 0,
    });
    expect(tuition[0]).toMatchObject({
      amountDue: 2000,
      amountPaid: 600,
      balanceDue: 1400,
    });
  });

  it('keeps partial-payment and no-payment filters', async () => {
    const invoices = [
      {
        paidAmount: 500,
        registrationFee: 1000,
        tuitionFee: 2000,
        enrollmentId: { studentId: { lastname: 'Partiel' } },
      },
      {
        paidAmount: 0,
        registrationFee: 1000,
        tuitionFee: 2000,
        enrollmentId: { studentId: { lastname: 'Impayé' } },
      },
    ];
    const invoiceModel = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(invoices),
          }),
        }),
      }),
    };
    const service = createService({ invoiceModel });

    const partial = await service.registrationPaidStudents('partial');
    const none = await service.registrationPaidStudents('none');

    expect(partial).toHaveLength(1);
    expect(partial[0]).toMatchObject({
      amountDue: 3000,
      amountPaid: 500,
      balanceDue: 2500,
    });
    expect(none).toHaveLength(1);
    expect(none[0]).toMatchObject({
      amountDue: 3000,
      amountPaid: 0,
      balanceDue: 3000,
    });
  });

  it('renders the payment situation PDF in A4 landscape', async () => {
    const service = createService({
      ecolesService: {
        getCurrentSchoolName: jest
          .fn()
          .mockResolvedValue('Complexe scolaire Dunya'),
      },
    });

    const pdf = await service.renderRegistrationPaidPdf(
      [],
      'registration',
      '2026 – 2027',
    );
    const pdfSource = pdf.toString('latin1');

    expect(pdfSource).toContain('/MediaBox [0 0 841.89 595.28]');
  });

  it('builds the open-year nominal roll ordered by most recent registration first, with gender totals', async () => {
    const enrollmentModel = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              {
                createdAt: new Date('2026-01-01T00:00:00Z'),
                studentId: {
                  lastname: 'Zongo',
                  firstname: 'Ali',
                  matricule: 'M2',
                  gender: 'M',
                },
              },
              {
                createdAt: new Date('2026-03-01T00:00:00Z'),
                studentId: {
                  lastname: 'Afidégnon',
                  firstname: 'Yawa',
                  matricule: 'M1',
                  gender: 'F',
                },
              },
              {
                createdAt: new Date('2026-02-01T00:00:00Z'),
                studentId: {
                  lastname: 'Zongo',
                  firstname: 'Abla',
                  matricule: 'M3',
                  gender: 'F',
                },
              },
            ]),
          }),
        }),
      }),
    };
    const levelModel = {
      findById: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ _id: 'level-1', label: 'CP1' }),
        }),
      }),
    };
    const schoolYearModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest
            .fn()
            .mockResolvedValue({ _id: 'year-1', label: '2026 – 2027' }),
        }),
      }),
    };
    const ecolesService = {
      getCurrentSchoolName: jest
        .fn()
        .mockResolvedValue('Complexe scolaire Dunya'),
    };
    const service = createService({
      enrollmentModel,
      levelModel,
      schoolYearModel,
      ecolesService,
    });

    const result = await service.getNominalRoll('level-1');

    expect(result.students.map((student) => student.firstname)).toEqual([
      'Yawa',
      'Abla',
      'Ali',
    ]);
    expect(result).toMatchObject({
      levelName: 'CP1',
      boys: 1,
      girls: 2,
      total: 3,
    });
    expect(enrollmentModel.find).toHaveBeenCalledWith({
      levelId: 'level-1',
      schoolYearId: 'year-1',
      status: 'active',
    });
  });

  it('paginates a long nominal roll PDF without losing the A4 table', async () => {
    const service = createService();
    const pdf = await service.renderStudentListPdf({
      schoolName: 'Complexe scolaire Dunya',
      schoolYearLabel: '2026 – 2027',
      levelName: 'CP1',
      students: Array.from({ length: 60 }, (_, index) => ({
        lastname: `NOM ${String(index + 1).padStart(2, '0')}`,
        firstname: 'Prénom',
        matricule: `MAT-${String(index + 1).padStart(3, '0')}`,
        gender: index % 2 ? 'F' : 'M',
      })),
      boys: 30,
      girls: 30,
      total: 60,
    });

    expect(
      pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length,
    ).toBeGreaterThan(1);
    expect(pdf.length).toBeGreaterThan(5000);
  });
});
