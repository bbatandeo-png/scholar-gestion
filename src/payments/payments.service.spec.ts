import { ReceiptMode } from '../common/enums/domain.enums';
import { PaymentsService } from './payments.service';

describe('PaymentsService receipt amounts', () => {
  const service = new PaymentsService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
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
    const pdfService = new PaymentsService(
      {} as any,
      {} as any,
      {} as any,
      { getSchoolName: jest.fn().mockResolvedValue('Complexe scolaire Dunya') } as any,
      {} as any,
      {} as any,
    );
    pdfService.findReceiptById = jest.fn().mockResolvedValue({
      receiptNumber: 'RC-TEST-001',
      amount: 10000,
      paidAt: new Date('2026-07-14T10:30:00Z'),
      invoiceId: {
        ...invoice,
        enrollmentId: {
          studentId: { lastname: 'AFANVI', firstname: 'Kodjo', matricule: 'MAT-010', gender: 'M' },
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
