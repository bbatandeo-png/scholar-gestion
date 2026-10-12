import { Model } from 'mongoose';
import { BillingService } from './billing.service';
import { FeeScheduleDocument } from './schemas/fee-schedule.schema';
import { InvoiceDocument } from './schemas/invoice.schema';
import { PaymentDocument } from '../payments/schemas/payment.schema';

describe('BillingService', () => {
  it('calcule correctement la facture avec remise et impayes reportes', () => {
    const service = new BillingService(
      null as unknown as Model<FeeScheduleDocument>,
      null as unknown as Model<InvoiceDocument>,
      null as unknown as Model<PaymentDocument>,
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

describe('BillingService.recordPaymentCorrection', () => {
  // A correction's delta must be split across the ledger's existing
  // 'current_fees'/'arrear' buckets rather than always tagged 'current_fees'
  // - otherwise reducing the paid amount on an invoice that also has an
  // arrear payment could drive 'current_fees' negative, an impossible value
  // that then corrupted the dashboard's revenue split (see dashboard.service
  // and the client report this fixes: "les calculs ne sont pas exacts").
  function buildService(existingPayments: Array<{ allocation: unknown[] }>) {
    const create = jest
      .fn<
        Promise<Array<{ _id: string }>>,
        [Array<Record<string, unknown>>, unknown]
      >()
      .mockResolvedValue([{ _id: 'correction-1' }]);
    const find = jest.fn().mockReturnValue({
      session: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(existingPayments),
        }),
      }),
    });
    const service = new BillingService(
      null as unknown as Model<FeeScheduleDocument>,
      null as unknown as Model<InvoiceDocument>,
      { create, find } as unknown as Model<PaymentDocument>,
    );
    return { service, create };
  }

  const runCorrection = (service: BillingService, delta: number) =>
    service.recordPaymentCorrection({
      invoiceId: 'inv-1',
      schoolYearId: 'year-1',
      delta,
      reason: 'test',
    });

  it('reduit le seul present : current_fees, sans toucher aux arrieres', async () => {
    const { service, create } = buildService([
      { allocation: [{ type: 'current_fees', amount: 20000 }] },
    ]);

    await runCorrection(service, -5000);

    const [[rows]] = create.mock.calls;
    expect(rows[0].allocation).toEqual([
      { type: 'current_fees', amount: -5000 },
    ]);
  });

  it("epuise d'abord current_fees puis deborde sur arrear, sans jamais rendre current_fees negatif", async () => {
    const { service, create } = buildService([
      {
        allocation: [
          { type: 'arrear', amount: 10000 },
          { type: 'current_fees', amount: 2000 },
        ],
      },
    ]);

    await runCorrection(service, -5000);

    const [[rows]] = create.mock.calls;
    expect(rows[0].allocation).toEqual([
      { type: 'current_fees', amount: -2000 },
      { type: 'arrear', amount: -3000 },
    ]);
  });

  it('une augmentation du montant paye reste attribuee a current_fees', async () => {
    const { service, create } = buildService([]);

    await runCorrection(service, 4000);

    const [[rows]] = create.mock.calls;
    expect(rows[0].allocation).toEqual([
      { type: 'current_fees', amount: 4000 },
    ]);
  });
});
