import { ReportsService } from './reports.service';

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

    const service = new ReportsService(
      {} as any,
      invoiceModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await service.registrationPaidStudents(
      'registration',
      'level-1',
      'year-1',
    );

    expect(result).toHaveLength(1);
    expect((result[0] as any).enrollmentId.studentId.lastname).toBe('A');
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
    const service = new ReportsService(
      {} as any,
      invoiceModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

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
    const service = new ReportsService(
      {} as any,
      invoiceModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

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
    const service = new ReportsService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        getSchoolName: jest.fn().mockResolvedValue('Complexe scolaire Dunya'),
      } as any,
    );

    const pdf = await service.renderRegistrationPaidPdf(
      [],
      'registration',
      '2026 – 2027',
    );
    const pdfSource = pdf.toString('latin1');

    expect(pdfSource).toContain('/MediaBox [0 0 841.89 595.28]');
  });

  it('builds the open-year nominal roll in alphabetical order with gender totals', async () => {
    const enrollmentModel = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              {
                studentId: {
                  lastname: 'Zongo',
                  firstname: 'Ali',
                  matricule: 'M2',
                  gender: 'M',
                },
              },
              {
                studentId: {
                  lastname: 'Afidégnon',
                  firstname: 'Yawa',
                  matricule: 'M1',
                  gender: 'F',
                },
              },
              {
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
    const settingsService = {
      getSchoolName: jest.fn().mockResolvedValue('Complexe scolaire Dunya'),
    };
    const service = new ReportsService(
      enrollmentModel as any,
      {} as any,
      {} as any,
      levelModel as any,
      schoolYearModel as any,
      settingsService as any,
    );

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
    const service = new ReportsService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
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
