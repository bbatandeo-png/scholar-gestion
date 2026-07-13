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

    const service = new ReportsService({} as any, invoiceModel as any, {} as any, {} as any);

    const result = await service.registrationPaidStudents('registration', 'level-1', 'year-1');

    expect(result).toHaveLength(1);
    expect((result[0] as any).enrollmentId.studentId.lastname).toBe('A');
  });
});
