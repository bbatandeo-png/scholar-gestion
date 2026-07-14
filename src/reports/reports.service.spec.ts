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

    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(1);
    expect(pdf.length).toBeGreaterThan(5000);
  });
});
