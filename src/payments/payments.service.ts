import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import PDFDocument from 'pdfkit';
import { Connection, Model } from 'mongoose';
import { ArrearsService } from '../arrears/arrears.service';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import {
  AuditAction,
  PaymentAllocationRule,
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
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
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
      const enrollmentArrears = await this.arrearsService.findByTargetEnrollment(enrollmentId, session);

      let arrearsApplied = 0;
      let currentFeesApplied = 0;
      const allocation: Array<Record<string, unknown>> = [];
      let remaining = dto.amount;

      if (rule === PaymentAllocationRule.ARREARS_FIRST && enrollmentArrears.length > 0) {
        const result = await this.arrearsService.applyPaymentAllocations(
          enrollmentArrears.map((item) => String(item._id)),
          remaining,
          session,
        );
        arrearsApplied = result.allocations.reduce((sum, item) => sum + item.amount, 0);
        remaining = result.remaining;
        allocation.push(...result.allocations.map((item) => ({ type: 'arrear', ...item })));
      }

      currentFeesApplied = remaining;
      if (currentFeesApplied > 0) {
        allocation.push({ type: 'current_fees', amount: currentFeesApplied });
      }

      if (rule === PaymentAllocationRule.CURRENT_FEES_FIRST && enrollmentArrears.length > 0) {
        const leftoverForArrears = Math.max(dto.amount - currentFeesApplied, 0);
        if (leftoverForArrears > 0) {
          const result = await this.arrearsService.applyPaymentAllocations(
            enrollmentArrears.map((item) => String(item._id)),
            leftoverForArrears,
            session,
          );
          arrearsApplied = result.allocations.reduce((sum, item) => sum + item.amount, 0);
          allocation.push(...result.allocations.map((item) => ({ type: 'arrear', ...item })));
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

  async renderReceiptPdf(id: string) {
    const receipt = await this.findReceiptById(id);
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 40 });
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

    const storedSchoolName = await this.settingsService.getSchoolName();
    const schoolName = storedSchoolName || process.env.SCHOOL_NAME || "Nom de l'école";
    const invoice = receipt.invoiceId as any;
    const enrollment = invoice?.enrollmentId as any;
    const student = enrollment?.studentId as any;
    const schoolYearLabel = enrollment?.schoolYearId?.label ?? '-';
    const levelLabel = enrollment?.levelId?.label ?? '-';
    const gender = student?.gender ?? '-';
    const studentFullName = `${student?.lastname ?? ''} ${student?.firstname ?? ''}`.trim() || '-';
    const receiptDate = receipt.paidAt ? new Date(receipt.paidAt) : new Date();
    const formattedDate = `${receiptDate.getDate().toString().padStart(2, '0')}/${(
      receiptDate.getMonth() + 1
    )
      .toString()
      .padStart(2, '0')} / ${receiptDate.getFullYear()} à ${receiptDate.getHours().toString().padStart(2, '0')}h ${receiptDate
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;

    return await new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      doc.font('Times-Bold').fontSize(18).text(schoolName, { align: 'center' });
      doc.moveDown(0.5);
      doc.font('Times-Bold').fontSize(14).text('REÇU DE PAIEMENT DES FRAIS DE SCOLARITE', { align: 'center' });
      doc.moveDown(1);

      const pad = (text: string, width: number) => text.padEnd(width, ' ');
      const field = (label: string, value: string | number) => {
        doc.font('Courier').fontSize(12).text(`${pad(label, 35)}: ${String(value)}`);
      };

      field('Référence ou Numéro de reçu', receipt.receiptNumber ?? '-');
      field('Année scolaire', schoolYearLabel);
      field('Nom et prénoms de l’élève', studentFullName);
      field('N° Matricule', student?.matricule ?? '-');
      field('Sexe', gender);
      field('Classe', levelLabel);
      field('Montant de l’écolage', invoice?.tuitionFee ?? '-');
      field('Nouveau paiement', receipt.amount ?? '-');
      field('Total payé', invoice?.paidAmount ?? '-');
      field('Reste à payer', invoice?.balanceDue ?? '-');

      doc.moveDown(2);
      doc.font('Courier').text(`Lomé, le ${formattedDate}`, { align: 'right' });
      doc.moveDown(2);
      doc.font('Times-Roman').text('L’économe', { align: 'right' });

      doc.end();
    });
  }
}