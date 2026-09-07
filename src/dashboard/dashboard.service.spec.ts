import { Model } from 'mongoose';
import { DashboardService } from './dashboard.service';
import { Student } from '../students/schemas/student.schema';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { Invoice } from '../billing/schemas/invoice.schema';
import { Arrear } from '../arrears/schemas/arrear.schema';
import { Expense } from '../expenses/schemas/expense.schema';
import { Payment } from '../payments/schemas/payment.schema';
import { ArrearCarryForward } from '../arrears/schemas/arrear-carry-forward.schema';

describe('DashboardService financial summary', () => {
  const service = new DashboardService(
    {} as unknown as Model<Student>,
    {} as unknown as Model<Enrollment>,
    {} as unknown as Model<Invoice>,
    {} as unknown as Model<Arrear>,
    {} as unknown as Model<Expense>,
    {} as unknown as Model<Payment>,
    {} as unknown as Model<ArrearCarryForward>,
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
