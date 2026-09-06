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
import { EcolesService } from '../ecoles/ecoles.service';
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
    private readonly ecolesService: EcolesService,
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

      const rule = await this.settingsService.getPaymentAllocationRule(
        String(invoice.schoolYearId),
      );
      const enrollmentId = String(invoice.enrollmentId);
      const enrollmentArrears =
        await this.arrearsService.findByTargetEnrollment(enrollmentId, session);
      const previousPayments = await this.paymentModel
        .find({ invoiceId: dto.invoiceId })
        .session(session ?? null)
        .lean()
        .exec();
      const currentFeesPaidBefore = previousPayments.reduce(
        (sum, payment: any) =>
          sum +
          (payment.allocation ?? [])
            .filter((item: any) => item.type === 'current_fees')
            .reduce(
              (allocationSum: number, item: any) =>
                allocationSum + Number(item.amount ?? 0),
              0,
            ),
        0,
      );
      const currentFeesDue = Math.max(
        Number(invoice.registrationFee) +
          Number(invoice.tuitionFee) -
          Number(invoice.discountAmount),
        0,
      );
      const currentFeesRemaining = Math.max(
        currentFeesDue - currentFeesPaidBefore,
        0,
      );

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

      currentFeesApplied =
        rule === PaymentAllocationRule.CURRENT_FEES_FIRST
          ? Math.min(remaining, currentFeesRemaining)
          : remaining;
      remaining -= currentFeesApplied;
      if (currentFeesApplied > 0) {
        allocation.push({ type: 'current_fees', amount: currentFeesApplied });
      }

      if (
        rule === PaymentAllocationRule.CURRENT_FEES_FIRST &&
        enrollmentArrears.length > 0
      ) {
        const leftoverForArrears = remaining;
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
          schoolYearId: String(invoice.schoolYearId),
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
            schoolYearId: invoice.schoolYearId,
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

      await this.auditService.log(
        {
          schoolYearId: String(invoice.schoolYearId),
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
        },
        session,
      );

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
    const enrollment = (payment.invoiceId as any)?.enrollmentId;
    if (enrollment) {
      if (enrollment.studentSnapshot) {
        enrollment.studentId = {
          ...(enrollment.studentId ?? {}),
          ...enrollment.studentSnapshot,
        };
      }
      if (enrollment.levelSnapshot) {
        enrollment.levelId = {
          ...(enrollment.levelId ?? {}),
          ...enrollment.levelSnapshot,
        };
      }
    }
    return payment;
  }

  async findReceiptYear(id: string) {
    const payment = await this.paymentModel
      .findById(id)
      .select('schoolYearId')
      .lean()
      .exec();
    if (!payment) {
      throw new NotFoundException('Recu introuvable');
    }
    return String(payment.schoolYearId);
  }

  async findReceiptYearByInvoice(invoiceId: string) {
    const invoice = await this.billingService.findInvoiceById(invoiceId);
    if (!invoice) {
      throw new NotFoundException('Facture introuvable');
    }
    return String(invoice.schoolYearId);
  }

  async listByInvoiceIds(invoiceIds: string[], schoolYearId?: string) {
    if (!invoiceIds.length) {
      return [];
    }

    return this.paymentModel
      .find({
        invoiceId: { $in: invoiceIds },
        ...(schoolYearId ? { schoolYearId } : {}),
      })
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

  // Two identical copies stacked on one A4 page, separated by a dashed cut
  // line - mirrors the carbon-copy paper receipt booklets this digitizes:
  // "SOUCHE" (top) stays with the school, "REÇU CLIENT" (bottom) is handed
  // to the payer after the page is cut in half.
  async renderReceiptPdf(
    id: string,
    receiptMode: ReceiptMode = ReceiptMode.TUITION_ONLY,
  ) {
    const receipt = await this.findReceiptById(id);
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 24, size: 'A4' });
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

    const storedSchoolName = await this.ecolesService.getCurrentSchoolName();
    const schoolName =
      storedSchoolName || process.env.SCHOOL_NAME || "Nom de l'école";
    const invoice = receipt.invoiceId as any;
    const enrollment = invoice?.enrollmentId;
    const student = enrollment?.studentId;
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
      )} / ${receiptDate.getFullYear()} à ${receiptDate.getHours().toString().padStart(2, '0')}h ${receiptDate
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;

    // Same netting rules as the HTML receipt (receiptMode-aware discount/
    // registration-fee handling) - computing "Total paye"/"Reste a payer"
    // straight from raw invoice fields here would silently disagree with
    // what the HTML page shows for the same receipt.
    const receiptSummary = this.getReceiptAmounts(invoice, receiptMode);

    const rows = [
      ['Référence ou Numéro de reçu', receipt.receiptNumber ?? '-'],
      ['Année scolaire', schoolYearLabel],
      ['Nom et prénoms de l’élève', studentFullName],
      ['N° Matricule', student?.matricule ?? '-'],
      ['Sexe', gender],
      ['Classe', levelLabel],
    ];
    if (receiptMode === ReceiptMode.TUITION_AND_REGISTRATION) {
      rows.push(["Frais d'inscription", receiptSummary.registrationFee ?? '-']);
    }
    rows.push(['Montant de l’écolage', receiptSummary.tuitionFee]);
    rows.push(['Nouveau paiement', receipt.amount ?? '-']);
    rows.push(['Total payé', receiptSummary.totalPaid]);
    rows.push(['Reste à payer', receiptSummary.balanceDue]);

    const startX = doc.page.margins.left;
    const usableWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const labelWidth = 160;
    const valueWidth = usableWidth - labelWidth;
    const rowHeight = 14;

    // Draws one full copy of the receipt starting at topY, compact enough
    // that two of them plus the cut line fit in one page's usable height.
    // Returns the y just past the copy's content.
    const drawCopy = (topY: number, copyLabel: string): number => {
      let y = topY;
      doc
        .font('Times-Bold')
        .fontSize(8)
        .text(copyLabel, startX, y, { width: usableWidth, align: 'center' });
      y += 12;
      doc
        .font('Times-Bold')
        .fontSize(12)
        .text(schoolName, startX, y, { width: usableWidth, align: 'center' });
      y += 15;
      doc
        .font('Times-Bold')
        .fontSize(10)
        .text('REÇU DE PAIEMENT DES FRAIS DE SCOLARITE', startX, y, {
          width: usableWidth,
          align: 'center',
        });
      y += 18;

      rows.forEach(([label, value]) => {
        doc.rect(startX, y, labelWidth, rowHeight).stroke('#000000');
        doc
          .rect(startX + labelWidth, y, valueWidth, rowHeight)
          .stroke('#000000');
        doc
          .font('Times-Bold')
          .fontSize(8)
          .text(label, startX + 5, y + 3, {
            width: labelWidth - 10,
            align: 'left',
          });
        doc
          .font('Times-Roman')
          .fontSize(8)
          .text(String(value), startX + labelWidth + 5, y + 3, {
            width: valueWidth - 10,
            align: 'left',
          });
        y += rowHeight;
      });

      y += 8;
      doc
        .font('Times-Roman')
        .fontSize(8)
        .text(`Lomé, le ${formattedDate}`, startX, y, {
          width: usableWidth,
          align: 'right',
        });
      y += 20;
      doc
        .font('Times-Roman')
        .fontSize(8)
        .text('L’économe', startX, y, { width: usableWidth, align: 'right' });
      y += 12;
      return y;
    };

    return await new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const topY = doc.page.margins.top;
      const bottomY = doc.page.height - doc.page.margins.bottom;
      const halfHeight = (bottomY - topY) / 2;
      const cutLineY = topY + halfHeight;

      drawCopy(topY, 'SOUCHE (à conserver par l’école)');

      doc
        .dash(4, { space: 3 })
        .moveTo(startX, cutLineY)
        .lineTo(startX + usableWidth, cutLineY)
        .stroke('#000000')
        .undash();

      drawCopy(cutLineY + 12, 'REÇU CLIENT (à remettre au parent)');

      doc.end();
    });
  }
}
