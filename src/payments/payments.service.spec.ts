import { Connection, Model } from 'mongoose';
import { ReceiptMode } from '../common/enums/domain.enums';
import { ArrearsService } from '../arrears/arrears.service';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { EcolesService } from '../ecoles/ecoles.service';
import { SettingsService } from '../settings/settings.service';
import { PaymentsService } from './payments.service';
import { PaymentDocument } from './schemas/payment.schema';

// Every test below only exercises one or two of PaymentsService's 7
// constructor dependencies - this builds a fully-stubbed instance and lets
// each test override just the mocks it actually cares about, instead of
// repeating 7 "{} as any" placeholders (and the associated lint noise) at
// every call site.
function createService(
  overrides: {
    paymentModel?: unknown;
    billingService?: unknown;
    arrearsService?: unknown;
    settingsService?: unknown;
    ecolesService?: unknown;
    auditService?: unknown;
    connection?: unknown;
  } = {},
): PaymentsService {
  return new PaymentsService(
    (overrides.paymentModel ?? {}) as unknown as Model<PaymentDocument>,
    (overrides.billingService ?? {}) as unknown as BillingService,
    (overrides.arrearsService ?? {}) as unknown as ArrearsService,
    (overrides.settingsService ?? {}) as unknown as SettingsService,
    (overrides.ecolesService ?? {}) as unknown as EcolesService,
    (overrides.auditService ?? {}) as unknown as AuditService,
    (overrides.connection ?? {}) as unknown as Connection,
  );
}

describe('PaymentsService receipt amounts', () => {
  const service = createService();
  const invoice = {
    tuitionFee: 80000,
    registrationFee: 6000,
    discountAmount: 0,
    paidAmount: 56000,
  };

  it('excludes registration fees from tuition-only receipt calculations', () => {
    expect(
      service.getReceiptAmounts(invoice, ReceiptMode.TUITION_ONLY),
    ).toEqual({
      tuitionFee: 80000,
      totalPaid: 50000,
      balanceDue: 30000,
    });
  });

  it('includes registration fees in the combined receipt calculations', () => {
    expect(
      service.getReceiptAmounts(invoice, ReceiptMode.TUITION_AND_REGISTRATION),
    ).toEqual({
      tuitionFee: 80000,
      registrationFee: 6000,
      totalPaid: 56000,
      balanceDue: 30000,
    });
  });

  it('renders the two receipt copies on a single A4 page', async () => {
    const pdfService = createService({
      ecolesService: {
        getCurrentSchoolName: jest
          .fn()
          .mockResolvedValue('Complexe scolaire Dunya'),
      },
    });
    pdfService.findReceiptById = jest.fn().mockResolvedValue({
      receiptNumber: 'RC-TEST-001',
      amount: 10000,
      paidAt: new Date('2026-07-14T10:30:00Z'),
      invoiceId: {
        ...invoice,
        enrollmentId: {
          studentId: {
            lastname: 'AFANVI',
            firstname: 'Kodjo',
            matricule: 'MAT-010',
            gender: 'M',
          },
          schoolYearId: { label: '2026 – 2027' },
          levelId: { label: 'CP1' },
        },
      },
    });

    const pdf = await pdfService.renderReceiptPdf(
      'payment-1',
      ReceiptMode.TUITION_AND_REGISTRATION,
    );
    const source = pdf.toString('latin1');

    expect(source.match(/\/Type \/Page\b/g)).toHaveLength(1);
    expect(pdf.length).toBeGreaterThan(1500);
  });
});
