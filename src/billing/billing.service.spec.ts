import { Model } from 'mongoose';
import { BillingService } from './billing.service';
import { FeeScheduleDocument } from './schemas/fee-schedule.schema';
import { InvoiceDocument } from './schemas/invoice.schema';

describe('BillingService', () => {
  it('calcule correctement la facture avec remise et impayes reportes', () => {
    const service = new BillingService(
      null as unknown as Model<FeeScheduleDocument>,
      null as unknown as Model<InvoiceDocument>,
    );

    const result = service.calculateInvoiceAmounts({
      registrationFee: 20000,
      tuitionFee: 80000,
      discountAmount: 10000,
      arrearsAmount: 15000,
      paidAmount: 25000,
    });

    expect(result.totalDue).toBe(105000);
    expect(result.balanceDue).toBe(80000);
    expect(result.status).toBe('partial');
  });
});
