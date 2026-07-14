import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import PDFDocument from 'pdfkit';
import { Connection, Model } from 'mongoose';
import { ArrearsService } from '../arrears/arrears.service';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import {
  AuditAction,
  PaymentAllocationRule,
  ReceiptMode,
} from '../common/enums/domain.enums';
import { runWithMongoTransactionFallback } from '../common/utils/mongo-transaction.util';
import { SettingsService } from '../settings/settings.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { Payment, PaymentDocument } from './schemas/payment.schema';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    private readonly billingService: BillingService,
    private readonly arrearsService: ArrearsService,
    private readonly settingsService: SettingsService,
    private readonly auditService: AuditService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private generateReceiptNumber() {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, '')
      .slice(0, 14);
    const random = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0');
    return `RC-${stamp}-${random}`;
  }

  async createPayment(dto: CreatePaymentDto, actorId?: string) {
    if (dto.amount <= 0) {
      throw new BadRequestException('Le montant doit etre positif');
    }

    return runWithMongoTransactionFallback(this.connection, async (session) => {
      const invoice = await this.billingService.findInvoiceById(dto.invoiceId);
      if (!invoice) {
        throw new NotFoundException('Facture introuvable');
      }
      if (dto.amount > invoice.balanceDue) {
        throw new BadRequestException('Le montant depasse le solde restant');
      }

      const rule = await this.settingsService.getPaymentAllocationRule();
      const enrollmentId = String(invoice.enrollmentId);
      const enrollmentArrears =
        await this.arrearsService.findByTargetEnrollment(enrollmentId, session);

      let arrearsApplied = 0;
      let currentFeesApplied = 0;
      const allocation: Array<Record<string, unknown>> = [];
      let remaining = dto.amount;

      if (
        rule === PaymentAllocationRule.ARREARS_FIRST &&
        enrollmentArrears.length > 0
      ) {
        const result = await this.arrearsService.applyPaymentAllocations(
          enrollmentArrears.map((item) => String(item._id)),
          remaining,
          session,
        );
        arrearsApplied = result.allocations.reduce(
          (sum, item) => sum + item.amount,
          0,
        );
        remaining = result.remaining;
        allocation.push(
          ...result.allocations.map((item) => ({ type: 'arrear', ...item })),
        );
      }

      currentFeesApplied = remaining;
      if (currentFeesApplied > 0) {
        allocation.push({ type: 'current_fees', amount: currentFeesApplied });
      }

      if (
        rule === PaymentAllocationRule.CURRENT_FEES_FIRST &&
        enrollmentArrears.length > 0
      ) {
        const leftoverForArrears = Math.max(dto.amount - currentFeesApplied, 0);
        if (leftoverForArrears > 0) {
          const result = await this.arrearsService.applyPaymentAllocations(
            enrollmentArrears.map((item) => String(item._id)),
            leftoverForArrears,
            session,
          );
          arrearsApplied = result.allocations.reduce(
            (sum, item) => sum + item.amount,
            0,
          );
          allocation.push(
            ...result.allocations.map((item) => ({ type: 'arrear', ...item })),
          );
        }
      }

      const updatedInvoice = await this.billingService.createOrUpdateInvoice(
        {
          enrollmentId,
          registrationFee: invoice.registrationFee,
          tuitionFee: invoice.tuitionFee,
          discountAmount: invoice.discountAmount,
          arrearsAmount: invoice.arrearsAmount,
          paidAmount: invoice.paidAmount + dto.amount,
        },
        session,
      );

      const payment = await this.paymentModel.create(
        [
          {
            invoiceId: dto.invoiceId,
            amount: dto.amount,
            method: dto.method,
            reference: dto.reference,
            receiptNumber: this.generateReceiptNumber(),
            allocation,
            createdBy: actorId,
            paidAt: new Date(),
          },
        ],
        { session },
      );

      await this.auditService.log({
        actorId,
        action: AuditAction.PAYMENT_CREATED,
        entityType: 'Payment',
        entityId: String(payment[0]._id),
        details: {
          invoiceId: dto.invoiceId,
          amount: dto.amount,
          arrearsApplied,
          currentFeesApplied,
          receiptNumber: payment[0].receiptNumber,
        },
      });

      return {
        payment: payment[0],
        invoice: updatedInvoice,
      };
    });
  }

  async findReceiptById(id: string) {
    const payment = await this.paymentModel
      .findById(id)
      .populate({
        path: 'invoiceId',
        populate: {
          path: 'enrollmentId',
          populate: [
            { path: 'studentId' },
            { path: 'schoolYearId' },
            { path: 'levelId' },
          ],
        },
      })
      .lean()
      .exec();
    if (!payment) {
      throw new NotFoundException('Recu introuvable');
    }

    return payment;
  }

  async listByInvoiceIds(invoiceIds: string[]) {
    if (!invoiceIds.length) {
      return [];
    }

    return this.paymentModel
      .find({ invoiceId: { $in: invoiceIds } })
      .sort({ paidAt: -1 })
      .lean()
      .exec();
  }

  getReceiptAmounts(invoice: any, receiptMode: ReceiptMode) {
    const registrationFee = Math.max(Number(invoice?.registrationFee ?? 0), 0);
    const tuitionFee = Math.max(Number(invoice?.tuitionFee ?? 0), 0);
    const discountAmount = Math.max(Number(invoice?.discountAmount ?? 0), 0);
    const paidAmount = Math.max(Number(invoice?.paidAmount ?? 0), 0);
    const netTuitionFee = Math.max(tuitionFee - discountAmount, 0);

    if (receiptMode === ReceiptMode.TUITION_AND_REGISTRATION) {
      const amountDue = registrationFee + netTuitionFee;
      const totalPaid = Math.min(paidAmount, amountDue);
      return {
        tuitionFee,
        registrationFee,
        totalPaid,
        balanceDue: Math.max(amountDue - totalPaid, 0),
      };
    }

    // En mode écolage seul, la part consacrée à l'inscription est exclue des calculs.
    const tuitionPaid = Math.min(
      Math.max(paidAmount - registrationFee, 0),
      netTuitionFee,
    );
    return {
      tuitionFee,
      totalPaid: tuitionPaid,
      balanceDue: Math.max(netTuitionFee - tuitionPaid, 0),
    };
  }

  async renderReceiptPdf(
    id: string,
    receiptMode: ReceiptMode = ReceiptMode.TUITION_ONLY,
  ) {
    const receipt = await this.findReceiptById(id);
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

    const storedSchoolName = await this.settingsService.getSchoolName();
    const schoolName =
      storedSchoolName || process.env.SCHOOL_NAME || "Nom de l'école";
    const invoice = receipt.invoiceId as any;
    const enrollment = invoice?.enrollmentId as any;
    const student = enrollment?.studentId as any;
    const schoolYearLabel = enrollment?.schoolYearId?.label ?? '-';
    const levelLabel = enrollment?.levelId?.label ?? '-';
    const gender = student?.gender ?? '-';
    const studentFullName =
      `${student?.lastname ?? ''} ${student?.firstname ?? ''}`.trim() || '-';
    const receiptDate = receipt.paidAt ? new Date(receipt.paidAt) : new Date();
    const formattedDate = `${receiptDate.getDate().toString().padStart(2, '0')}/${(
      receiptDate.getMonth() + 1
    )
      .toString()
      .padStart(
        2,
        '0',
      )}/${receiptDate.getFullYear()} à ${receiptDate.getHours().toString().padStart(2, '0')} h ${receiptDate
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;
    const amounts = this.getReceiptAmounts(invoice, receiptMode);
    const formatAmount = (value: unknown) =>
      new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
        .format(Number(value ?? 0))
        .replace(/[\u00a0\u202f]/g, ' ');

    return await new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const renderCopy = (top: number) => {
        const startX = 30;
        const contentWidth = doc.page.width - startX * 2;
        const rows: Array<[string, string]> = [
          ['Référence ou numéro de reçu', String(receipt.receiptNumber ?? '-')],
          ['Année scolaire', schoolYearLabel],
          ["Nom et prénoms de l'élève", studentFullName],
          ['N° matricule', String(student?.matricule ?? '-')],
          ['Sexe', gender],
          ['Classe', levelLabel],
          ["Montant de l'écolage", formatAmount(amounts.tuitionFee)],
        ];

        if (receiptMode === ReceiptMode.TUITION_AND_REGISTRATION) {
          rows.push([
            "Frais d'inscription",
            formatAmount(amounts.registrationFee),
          ]);
        }

        rows.push(
          ['Nouveau paiement', formatAmount(receipt.amount)],
          ['Total payé', formatAmount(amounts.totalPaid)],
          ['Reste à payer', formatAmount(amounts.balanceDue)],
        );

        doc
          .font('Helvetica-Bold')
          .fontSize(14)
          .text(schoolName.toUpperCase(), startX, top, {
            width: contentWidth,
            align: 'center',
          });
        doc
          .font('Helvetica-Bold')
          .fontSize(11)
          .text('REÇU DE PAIEMENT DES FRAIS DE SCOLARITÉ', startX, top + 21, {
            width: contentWidth,
            align: 'center',
          });

        const rowHeight = 18;
        const labelWidth = 205;
        const valueWidth = contentWidth - labelWidth;
        let y = top + 45;

        rows.forEach(([label, value]) => {
          doc.rect(startX, y, labelWidth, rowHeight).stroke('#222222');
          doc
            .rect(startX + labelWidth, y, valueWidth, rowHeight)
            .stroke('#222222');
          doc
            .font('Helvetica-Bold')
            .fontSize(8.5)
            .text(label, startX + 5, y + 5, {
              width: labelWidth - 10,
              lineBreak: false,
            });
          doc
            .font('Helvetica')
            .fontSize(8.5)
            .text(value, startX + labelWidth + 5, y + 5, {
              width: valueWidth - 10,
              lineBreak: false,
            });
          y += rowHeight;
        });

        doc
          .font('Helvetica')
          .fontSize(8.5)
          .text(`Lomé, le ${formattedDate}`, startX, y + 9, {
            width: contentWidth,
            align: 'right',
          });
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .text("L'économe", startX, y + 30, {
            width: contentWidth,
            align: 'right',
          });
      };

      renderCopy(22);
      const cutY = doc.page.height / 2;
      doc
        .save()
        .dash(5, { space: 4 })
        .strokeColor('#777777')
        .moveTo(18, cutY)
        .lineTo(doc.page.width - 18, cutY)
        .stroke()
        .restore();
      renderCopy(cutY + 22);

      doc.end();
    });
  }
}
