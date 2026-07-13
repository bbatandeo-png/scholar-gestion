import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import PDFDocument from 'pdfkit';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { Invoice } from '../billing/schemas/invoice.schema';
import { Level } from '../levels/schemas/level.schema';
import { Student } from '../students/schemas/student.schema';
import { SchoolYear } from '../school-years/schemas/school-year.schema';
import { SettingsService } from '../settings/settings.service';
import { SchoolYearStatus } from '../common/enums/domain.enums';

type PdfDocumentInstance = InstanceType<typeof PDFDocument>;
type RegistrationPaidFilter = 'registration' | 'tuition' | 'full' | 'partial' | 'none';

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Invoice.name) private readonly invoiceModel: Model<Invoice>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Level.name) private readonly levelModel: Model<Level>,
    @InjectModel(SchoolYear.name) private readonly schoolYearModel: Model<SchoolYear>,
    private readonly settingsService: SettingsService,
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

  async registrationPaidStudents(
    filter: RegistrationPaidFilter = 'registration',
    levelId?: string,
    schoolYearId?: string,
  ) {
    const invoices = await this.invoiceModel
      .find({})
      .populate({ path: 'enrollmentId', populate: [{ path: 'studentId' }, { path: 'schoolYearId' }, { path: 'levelId' }] })
      .lean()
      .exec();

    const toEntityId = (value: any) => {
      if (!value) return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'object' && value._id) return String(value._id);
      return String(value);
    };

    return invoices
      .filter((invoice: any) => {
        const paidAmount = invoice.paidAmount ?? 0;
        const registrationFee = invoice.registrationFee ?? 0;
        const tuitionFee = invoice.tuitionFee ?? 0;
        const totalFee = registrationFee + tuitionFee;
        const enrollment = invoice.enrollmentId;
        const matchesLevel = !levelId || toEntityId(enrollment?.levelId) === String(levelId);
        const matchesSchoolYear = !schoolYearId || toEntityId(enrollment?.schoolYearId) === String(schoolYearId);

        if (!matchesLevel || !matchesSchoolYear) {
          return false;
        }

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

  async listSchoolYears() {
    return this.schoolYearModel?.find().sort({ startDate: -1 }).lean().exec() ?? [];
  }

  async findLevelName(levelId: string) {
    const level = await this.levelModel.findById(levelId).lean().exec();
    return level?.label;
  }

  async findOpenSchoolYearLabel() {
    const schoolYear = await this.schoolYearModel?.findOne({ status: SchoolYearStatus.OPEN }).lean().exec();
    if (!schoolYear) {
      return undefined;
    }
    return schoolYear.label ?? `${new Date(schoolYear.startDate).getFullYear()} – ${new Date(schoolYear.endDate).getFullYear()}`;
  }

  private renderPdfHeader(doc: PdfDocumentInstance, schoolName: string, levelName?: string) {
    const trimmedName = (schoolName || '').trim();
    const [firstWord, ...restWords] = trimmedName.split(' ');
    const secondLine = restWords.join(' ');

    if (firstWord) {
      doc.font('Times-Bold').fontSize(20).text(firstWord.toUpperCase(), { align: 'center' });
    }
    if (secondLine) {
      doc.font('Times-Bold').fontSize(20).text(secondLine.toUpperCase(), { align: 'center' });
    }

    if (levelName) {
      doc.moveDown(0.5);
      doc.font('Times-Bold').fontSize(12).text(`Niveau : ${levelName}`, { align: 'center' });
    }

    doc.moveDown(1);
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

  async renderRegistrationPaidPdf(
    report: any[],
    filter: 'registration' | 'tuition' | 'full' | 'partial' | 'none' = 'registration',
    levelName?: string,
  ) {
    const schoolName = await this.settingsService.getSchoolName();
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

    return await new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      this.renderPdfHeader(doc, schoolName, levelName);

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
      const bottomLimit = doc.page.height - doc.page.margins.bottom;

      const drawHeader = () => {
        const y = doc.y;
        let x = startX;
        doc.font('Times-Bold').fontSize(10).fillColor('#000000');

        headers.forEach((text, index) => {
          doc.rect(x, y, columnWidths[index], rowHeight).fillAndStroke('#F0F0F0', '#000000');
          doc.fillColor('#000000').text(text, x + 4, y + 4, {
            width: columnWidths[index] - 8,
            align: index >= 4 ? 'right' : 'left',
          });
          x += columnWidths[index];
        });

        doc.y = y + rowHeight;
        doc.x = startX;
      };

      const drawRow = (values: any[]) => {
        const y = doc.y;
        let x = startX;
        doc.font('Times-Roman').fontSize(10).fillColor('#000000');

        values.forEach((value, index) => {
          doc.rect(x, y, columnWidths[index], rowHeight).stroke('#000000');
          doc.fillColor('#000000').text(String(value), x + 4, y + 4, {
            width: columnWidths[index] - 8,
            align: index >= 4 ? 'right' : 'left',
            ellipsis: true,
          });
          x += columnWidths[index];
        });

        doc.y = y + rowHeight;
        doc.x = startX;
      };

      if (!report.length) {
        doc.font('Times-Roman').fontSize(10).text('Aucun résultat pour ce filtre.', { align: 'left' });
      } else {
        drawHeader();
        report.forEach((item: any, index: number) => {
          if (doc.y + rowHeight > bottomLimit) {
            doc.addPage();
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

          drawRow(values);
        });
      }

      doc.end();
    });
  }

  async renderClassFinancialSituationPdf(report: any[], levelName?: string) {
    const schoolName = await this.settingsService.getSchoolName();
    const schoolYearLabel = await this.findOpenSchoolYearLabel();
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

    return await new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      this.renderPdfHeader(doc, schoolName, levelName);

      const title = `Situation financière des classes${levelName ? ` - ${levelName}` : ''}`;
      doc.font('Times-Bold').fontSize(18).text(title, { align: 'center' });
      doc.moveDown(0.5);
      doc.font('Times-Roman').fontSize(10).text(`Date : ${new Date().toLocaleDateString('fr-FR')}`, { align: 'right' });
      doc.moveDown(1);

      const headers = ['Matricule', 'Nom', 'Sexe', 'Inscription', 'Écolage', 'Total dû', 'Payé', 'Reste'];
      const columnWidths = [70, 120, 40, 70, 70, 65, 65, 65];
      const rowHeight = 18;
      const startX = doc.page.margins.left;
      const bottomLimit = doc.page.height - doc.page.margins.bottom;

      const drawHeader = () => {
        const y = doc.y;
        let x = startX;
        doc.font('Times-Bold').fontSize(10).fillColor('#000000');
        headers.forEach((text, index) => {
          doc.rect(x, y, columnWidths[index], rowHeight).fillAndStroke('#F0F0F0', '#000000');
          doc.fillColor('#000000').text(text, x + 4, y + 4, {
            width: columnWidths[index] - 8,
            align: index >= 3 ? 'right' : 'left',
          });
          x += columnWidths[index];
        });
        doc.y = y + rowHeight;
        doc.x = startX;
      };

      const drawRow = (values: any[]) => {
        const y = doc.y;
        let x = startX;
        doc.font('Times-Roman').fontSize(9).fillColor('#000000');
        values.forEach((value, index) => {
          doc.rect(x, y, columnWidths[index], rowHeight).stroke('#000000');
          doc.fillColor('#000000').text(String(value), x + 4, y + 4, {
            width: columnWidths[index] - 8,
            align: index >= 3 ? 'right' : 'left',
            ellipsis: true,
          });
          x += columnWidths[index];
        });
        doc.y = y + rowHeight;
        doc.x = startX;
      };

      drawHeader();

      report.forEach((item: any) => {
        if (doc.y + rowHeight > bottomLimit) {
          doc.addPage();
          drawHeader();
        }

        const values = [
          item.student?.matricule ?? '',
          `${item.student?.lastname ?? ''} ${item.student?.firstname ?? ''}`.trim(),
          item.student?.gender ?? '',
          (item.registrationFee ?? 0).toFixed(2),
          (item.tuitionFee ?? 0).toFixed(2),
          (item.totalDue ?? 0).toFixed(2),
          (item.paidAmount ?? 0).toFixed(2),
          (item.balanceDue ?? 0).toFixed(2),
        ];

        drawRow(values);
      });

      doc.end();
    });
  }
}