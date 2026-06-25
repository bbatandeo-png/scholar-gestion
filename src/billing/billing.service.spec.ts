import { BillingService } from './billing.service';

describe('BillingService', () => {
  it('calcule correctement la facture avec remise et impayes reportes', () => {
    const service = new BillingService(null as any, null as any);

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