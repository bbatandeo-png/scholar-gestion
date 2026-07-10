import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import PDFDocument from 'pdfkit';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { Invoice } from '../billing/schemas/invoice.schema';
import { Level } from '../levels/schemas/level.schema';
import { Student } from '../students/schemas/student.schema';

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Invoice.name) private readonly invoiceModel: Model<Invoice>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Level.name) private readonly levelModel: Model<Level>,
  ) {}

  async studentsByLevel() {
    return this.enrollmentModel.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$levelId', total: { $sum: 1 } } },
    ]);
  }

  async paidStudents() {
    return this.invoiceModel
      .find({ status: 'paid' })
      .populate({ path: 'enrollmentId', populate: [{ path: 'studentId' }, { path: 'schoolYearId' }, { path: 'levelId' }] })
      .lean()
      .exec();
  }

  async unpaidStudents() {
    return this.invoiceModel
      .find({ status: { $in: ['unpaid', 'partial'] } })
      .populate({ path: 'enrollmentId', populate: [{ path: 'studentId' }, { path: 'schoolYearId' }, { path: 'levelId' }] })
      .lean()
      .exec();
  }

  async registrationPaidStudents(filter: 'registration' | 'tuition' | 'full' | 'partial' | 'none' = 'registration') {
    const invoices = await this.invoiceModel
      .find({})
      .populate({ path: 'enrollmentId', populate: [{ path: 'studentId' }, { path: 'schoolYearId' }, { path: 'levelId' }] })
      .lean()
      .exec();

    return invoices
      .filter((invoice: any) => {
        const paidAmount = invoice.paidAmount ?? 0;
        const registrationFee = invoice.registrationFee ?? 0;
        const tuitionFee = invoice.tuitionFee ?? 0;
        const totalFee = registrationFee + tuitionFee;

        switch (filter) {
          case 'tuition':
            return paidAmount >= tuitionFee;
          case 'full':
            return paidAmount >= totalFee;
          case 'partial':
            return paidAmount > 0 && paidAmount < totalFee;
          case 'none':
            return paidAmount === 0;
          default:
            return paidAmount >= registrationFee;
        }
      })
      .sort((a: any, b: any) => {
        const aStudent = a.enrollmentId?.studentId;
        const bStudent = b.enrollmentId?.studentId;
        const aName = `${aStudent?.lastname ?? ''} ${aStudent?.firstname ?? ''}`.trim();
        const bName = `${bStudent?.lastname ?? ''} ${bStudent?.firstname ?? ''}`.trim();
        return aName.localeCompare(bName, 'fr');
      });
  }

  async classFinancialSituation() {
    const enrollments = await this.enrollmentModel
      .find({ status: 'active' })
      .populate([{ path: 'studentId' }, { path: 'levelId' }, { path: 'schoolYearId' }])
      .lean()
      .exec();

    const invoices = await this.invoiceModel
      .find({ enrollmentId: { $in: enrollments.map((item: any) => item._id) } })
      .populate({ path: 'enrollmentId', populate: [{ path: 'studentId' }, { path: 'levelId' }] })
      .lean()
      .exec();

    const invoiceByEnrollment = new Map(invoices.map((invoice: any) => [String(invoice.enrollmentId?._id ?? invoice.enrollmentId), invoice]));

    return enrollments
      .map((enrollment: any) => {
        const invoice = invoiceByEnrollment.get(String(enrollment._id));
        const student = enrollment.studentId as any;
        const level = enrollment.levelId as any;
        return {
          enrollment,
          student,
          level,
          registrationFee: invoice?.registrationFee ?? 0,
          tuitionFee: invoice?.tuitionFee ?? 0,
          paidAmount: invoice?.paidAmount ?? 0,
          balanceDue: invoice?.balanceDue ?? 0,
          totalDue: invoice?.totalDue ?? 0,
        };
      })
      .sort((a, b) => `${a.student?.lastname ?? ''} ${a.student?.firstname ?? ''}`.localeCompare(`${b.student?.lastname ?? ''} ${b.student?.firstname ?? ''}`, 'fr'));
  }

  async listLevels() {
    return this.levelModel.find().sort({ sortOrder: 1 }).lean().exec();
  }

  async revenue() {
    const [aggregated] = await this.invoiceModel.aggregate([
      {
        $group: {
          _id: null,
          collected: { $sum: '$paidAmount' },
          outstanding: { $sum: '$balanceDue' },
          totalDue: { $sum: '$totalDue' },
          registrationRevenue: { $sum: '$registrationFee' },
          tuitionRevenue: { $sum: '$tuitionFee' },
        },
      },
    ]);

    return {
      collected: aggregated?.collected ?? 0,
      outstanding: aggregated?.outstanding ?? 0,
      totalDue: aggregated?.totalDue ?? 0,
      registrationRevenue: aggregated?.registrationRevenue ?? 0,
      tuitionRevenue: aggregated?.tuitionRevenue ?? 0,
    };
  }

  async renderRegistrationPaidPdf(report: any[], filter: 'registration' | 'tuition' | 'full' | 'partial' | 'none' = 'registration') {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

    return await new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const filterLabel =
        filter === 'tuition'
          ? "Écolage payé"
          : filter === 'full'
          ? "Inscription et écolage payés"
          : filter === 'partial'
          ? "Paiement partiel"
          : filter === 'none'
          ? "Aucun paiement"
          : "Inscription payée";

      const title = `Liste des élèves - ${filterLabel}`;
      doc.font('Times-Bold').fontSize(18).text(title, { align: 'center' });
      doc.moveDown(0.5);
      doc.font('Times-Roman').fontSize(10).text(`Date : ${new Date().toLocaleDateString('fr-FR')}`, { align: 'right' });
      doc.moveDown(1);

      const headers = ['Élève', 'Matricule', 'Année', 'Niveau', 'Inscription', 'Payé', 'Reste'];
      const columnWidths = [140, 60, 50, 80, 65, 65, 65];
      const rowHeight = 18;
      const startX = doc.page.margins.left;
      const maxWidth = columnWidths.reduce((sum, width) => sum + width, 0);
      const bottomLimit = doc.page.height - doc.page.margins.bottom;

      const drawHeader = () => {
        let x = startX;
        const y = doc.y;
        doc.rect(x - 2, y - 2, maxWidth + 4, rowHeight + 4).fillOpacity(0.08).fillAndStroke('#000000', '#000000');
        doc.fillOpacity(1);
        headers.forEach((text, index) => {
          doc.font('Times-Bold').fontSize(10).fillColor('#000000').text(text, x, y, {
            width: columnWidths[index],
            align: index >= 4 ? 'right' : 'left',
          });
          x += columnWidths[index];
        });
        doc.moveDown(1.3);
        drawLine(doc.y - 4);
      };

      const drawLine = (y: number) => {
        let x = startX;
        doc.save();
        doc.lineWidth(0.5).strokeColor('#999999');
        doc.moveTo(x, y);
        doc.lineTo(x + maxWidth, y);
        doc.stroke();
        for (const width of columnWidths) {
          doc.moveTo(x, y - rowHeight - 2);
          doc.lineTo(x, y + rowHeight + 6);
          doc.stroke();
          x += width;
        }
        doc.restore();
      };

      if (!report.length) {
        doc.font('Times-Roman').fontSize(10).text('Aucun résultat pour ce filtre.', { align: 'left' });
      } else {
        drawHeader();
        report.forEach((item: any, index: number) => {
          if (doc.y + rowHeight * 2 > bottomLimit) {
            doc.addPage();
            doc.moveDown(1);
            drawHeader();
          }

          const student = item.enrollmentId?.studentId;
          const enrollment = item.enrollmentId;
          const values = [
            `${student?.lastname ?? ''} ${student?.firstname ?? ''}`.trim(),
            student?.matricule ?? '',
            enrollment?.schoolYearId?.label ?? '',
            enrollment?.levelId?.label ?? '',
            item.registrationFee ?? 0,
            item.paidAmount ?? 0,
            item.balanceDue ?? 0,
          ];

          let x = startX;
          const y = doc.y;
          values.forEach((value, colIndex) => {
            doc.font('Times-Roman').fontSize(10).fillColor('#000000').text(String(value), x, y, {
              width: columnWidths[colIndex],
              align: colIndex >= 4 ? 'right' : 'left',
              ellipsis: true,
            });
            x += columnWidths[colIndex];
          });
          doc.moveDown(1.2);
          const lineY = doc.y - 6;
          doc.save();
          doc.lineWidth(0.3).strokeColor('#DDDDDD');
          doc.moveTo(startX, lineY);
          doc.lineTo(startX + maxWidth, lineY);
          doc.stroke();
          doc.restore();
        });
      }

      doc.end();
    });
  }
}