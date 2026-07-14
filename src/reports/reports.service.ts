import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
export type RegistrationPaidFilter =
  | 'registration'
  | 'tuition'
  | 'partial'
  | 'none';

export type NominalRoll = {
  schoolName: string;
  schoolYearLabel: string;
  levelName: string;
  students: Array<{
    lastname: string;
    firstname: string;
    matricule: string;
    gender: string;
  }>;
  boys: number;
  girls: number;
  total: number;
};

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Enrollment.name)
    private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Invoice.name) private readonly invoiceModel: Model<Invoice>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Level.name) private readonly levelModel: Model<Level>,
    @InjectModel(SchoolYear.name)
    private readonly schoolYearModel: Model<SchoolYear>,
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
      .populate({
        path: 'enrollmentId',
        populate: [
          { path: 'studentId' },
          { path: 'schoolYearId' },
          { path: 'levelId' },
        ],
      })
      .lean()
      .exec();
  }

  async unpaidStudents() {
    return this.invoiceModel
      .find({ status: { $in: ['unpaid', 'partial'] } })
      .populate({
        path: 'enrollmentId',
        populate: [
          { path: 'studentId' },
          { path: 'schoolYearId' },
          { path: 'levelId' },
        ],
      })
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
      .populate({
        path: 'enrollmentId',
        populate: [
          { path: 'studentId' },
          { path: 'schoolYearId' },
          { path: 'levelId' },
        ],
      })
      .lean()
      .exec();

    const toEntityId = (value: any) => {
      if (!value) return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'object' && value._id) return String(value._id);
      return String(value);
    };

    return invoices
      .map((invoice: any) => {
        const paidAmount = Math.max(Number(invoice.paidAmount ?? 0), 0);
        const registrationFee = Math.max(
          Number(invoice.registrationFee ?? 0),
          0,
        );
        const tuitionFee = Math.max(Number(invoice.tuitionFee ?? 0), 0);
        const discountAmount = Math.max(Number(invoice.discountAmount ?? 0), 0);
        const netTuitionFee = Math.max(tuitionFee - discountAmount, 0);
        const registrationPaid = Math.min(paidAmount, registrationFee);
        const tuitionPaid = Math.min(
          Math.max(paidAmount - registrationFee, 0),
          netTuitionFee,
        );
        const totalCurrentFees = registrationFee + netTuitionFee;
        const amountDue =
          filter === 'tuition'
            ? netTuitionFee
            : filter === 'registration'
              ? registrationFee
              : totalCurrentFees;
        const amountPaid =
          filter === 'tuition'
            ? tuitionPaid
            : filter === 'registration'
              ? registrationPaid
              : Math.min(paidAmount, totalCurrentFees);

        return {
          ...invoice,
          amountDue,
          amountPaid,
          balanceDue: Math.max(amountDue - amountPaid, 0),
        };
      })
      .filter((invoice: any) => {
        const enrollment = invoice.enrollmentId;
        const matchesLevel =
          !levelId || toEntityId(enrollment?.levelId) === String(levelId);
        const matchesSchoolYear =
          !schoolYearId ||
          toEntityId(enrollment?.schoolYearId) === String(schoolYearId);

        if (!matchesLevel || !matchesSchoolYear) {
          return false;
        }

        if (filter === 'partial') {
          return (
            invoice.amountPaid > 0 && invoice.amountPaid < invoice.amountDue
          );
        }
        if (filter === 'none') {
          return invoice.amountPaid === 0;
        }
        return invoice.amountPaid > 0;
      })
      .sort((a: any, b: any) => {
        const aStudent = a.enrollmentId?.studentId;
        const bStudent = b.enrollmentId?.studentId;
        const aName =
          `${aStudent?.lastname ?? ''} ${aStudent?.firstname ?? ''}`.trim();
        const bName =
          `${bStudent?.lastname ?? ''} ${bStudent?.firstname ?? ''}`.trim();
        return aName.localeCompare(bName, 'fr');
      });
  }

  async classFinancialSituation() {
    const enrollments = await this.enrollmentModel
      .find({ status: 'active' })
      .populate([
        { path: 'studentId' },
        { path: 'levelId' },
        { path: 'schoolYearId' },
      ])
      .lean()
      .exec();

    const invoices = await this.invoiceModel
      .find({ enrollmentId: { $in: enrollments.map((item: any) => item._id) } })
      .populate({
        path: 'enrollmentId',
        populate: [{ path: 'studentId' }, { path: 'levelId' }],
      })
      .lean()
      .exec();

    const invoiceByEnrollment = new Map(
      invoices.map((invoice: any) => [
        String(invoice.enrollmentId?._id ?? invoice.enrollmentId),
        invoice,
      ]),
    );

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
      .sort((a, b) =>
        `${a.student?.lastname ?? ''} ${a.student?.firstname ?? ''}`.localeCompare(
          `${b.student?.lastname ?? ''} ${b.student?.firstname ?? ''}`,
          'fr',
        ),
      );
  }

  async listLevels() {
    return this.levelModel.find().sort({ sortOrder: 1 }).lean().exec();
  }

  async listSchoolYears() {
    return (
      this.schoolYearModel?.find().sort({ startDate: -1 }).lean().exec() ?? []
    );
  }

  async getSchoolName() {
    return (
      (await this.settingsService.getSchoolName()) ||
      process.env.SCHOOL_NAME ||
      "Nom de l'établissement"
    );
  }

  async findLevelName(levelId: string) {
    const level = await this.levelModel.findById(levelId).lean().exec();
    return level?.label;
  }

  async findOpenSchoolYearLabel() {
    const schoolYear = await this.schoolYearModel
      ?.findOne({ status: SchoolYearStatus.OPEN })
      .lean()
      .exec();
    if (!schoolYear) {
      return undefined;
    }
    return (
      schoolYear.label ??
      `${new Date(schoolYear.startDate).getFullYear()} – ${new Date(schoolYear.endDate).getFullYear()}`
    );
  }

  async getNominalRoll(levelId: string): Promise<NominalRoll> {
    if (!levelId) {
      throw new BadRequestException('Veuillez sélectionner une classe');
    }

    const [level, schoolYear, schoolName] = await Promise.all([
      this.levelModel.findById(levelId).lean().exec(),
      this.schoolYearModel
        .findOne({ status: SchoolYearStatus.OPEN })
        .lean()
        .exec(),
      this.settingsService.getSchoolName(),
    ]);

    if (!level) {
      throw new NotFoundException('Classe introuvable');
    }
    if (!schoolYear) {
      throw new BadRequestException("Aucune année scolaire n'est ouverte");
    }

    const enrollments = await this.enrollmentModel
      .find({ levelId, schoolYearId: schoolYear._id, status: 'active' })
      .populate({
        path: 'studentId',
        select: 'lastname firstname matricule gender',
      })
      .lean()
      .exec();

    const students = enrollments
      .map((enrollment: any) => enrollment.studentId)
      .filter(Boolean)
      .map((student: any) => ({
        lastname: String(student.lastname ?? ''),
        firstname: String(student.firstname ?? ''),
        matricule: String(student.matricule ?? ''),
        gender: String(student.gender ?? '').toUpperCase(),
      }))
      .sort((left, right) => {
        const byLastName = left.lastname.localeCompare(right.lastname, 'fr', {
          sensitivity: 'base',
        });
        return (
          byLastName ||
          left.firstname.localeCompare(right.firstname, 'fr', {
            sensitivity: 'base',
          })
        );
      });

    return {
      schoolName:
        schoolName || process.env.SCHOOL_NAME || "Nom de l'établissement",
      schoolYearLabel:
        schoolYear.label ||
        `${new Date(schoolYear.startDate).getFullYear()} – ${new Date(schoolYear.endDate).getFullYear()}`,
      levelName: level.label,
      students,
      boys: students.filter((student) => student.gender === 'M').length,
      girls: students.filter((student) => student.gender === 'F').length,
      total: students.length,
    };
  }

  private renderPdfHeader(
    doc: PdfDocumentInstance,
    schoolName: string,
    levelName?: string,
  ) {
    const trimmedName = (schoolName || '').trim();
    const [firstWord, ...restWords] = trimmedName.split(' ');
    const secondLine = restWords.join(' ');

    if (firstWord) {
      doc
        .font('Times-Bold')
        .fontSize(20)
        .text(firstWord.toUpperCase(), { align: 'center' });
    }
    if (secondLine) {
      doc
        .font('Times-Bold')
        .fontSize(20)
        .text(secondLine.toUpperCase(), { align: 'center' });
    }

    if (levelName) {
      doc.moveDown(0.5);
      doc
        .font('Times-Bold')
        .fontSize(12)
        .text(`Niveau : ${levelName}`, { align: 'center' });
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
    filter: RegistrationPaidFilter = 'registration',
    schoolYearLabel = '',
  ) {
    const schoolName = await this.getSchoolName();
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      margin: 30,
      size: 'A4',
      layout: 'landscape',
      bufferPages: true,
    });
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

    return await new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const reportTitle =
        filter === 'tuition'
          ? "Situation de paiement de l'écolage"
          : filter === 'partial'
            ? 'Situation des paiements partiels'
            : filter === 'none'
              ? 'Situation des élèves sans paiement'
              : "Situation de paiement des frais d'inscription";

      const drawDocumentHeading = (continued = false) => {
        doc
          .font('Helvetica-Bold')
          .fontSize(16)
          .text(schoolName.toUpperCase(), { align: 'center' });
        doc.moveDown(0.45);
        doc
          .font('Helvetica')
          .fontSize(14)
          .text(`${reportTitle}${continued ? ' (suite)' : ''}`, {
            align: 'center',
          });
        doc.moveDown(0.35);
        doc
          .font('Helvetica-Bold')
          .fontSize(12)
          .text(`Année scolaire : ${schoolYearLabel || 'Non précisée'}`, {
            align: 'center',
          });
        doc.moveDown(0.8);
      };

      const headers = [
        'N°',
        'Nom et prénoms',
        'Sexe',
        'Matricule',
        'Classe',
        'Montant',
        'Payé',
        'Reste',
      ];
      const columnWidths = [36, 190, 45, 85, 80, 115, 115, 115];
      const rowHeight = 22;
      const startX = doc.page.margins.left;
      const bottomLimit = doc.page.height - doc.page.margins.bottom;

      const drawHeader = () => {
        const y = doc.y;
        let x = startX;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');

        headers.forEach((text, index) => {
          doc
            .rect(x, y, columnWidths[index], rowHeight)
            .fillAndStroke('#F0F0F0', '#000000');
          doc.fillColor('#000000').text(text, x + 4, y + 4, {
            width: columnWidths[index] - 8,
            align: index >= 5 ? 'right' : index === 0 ? 'center' : 'left',
          });
          x += columnWidths[index];
        });

        doc.y = y + rowHeight;
        doc.x = startX;
      };

      const drawRow = (values: any[]) => {
        const y = doc.y;
        let x = startX;
        doc.font('Helvetica').fontSize(9).fillColor('#000000');

        values.forEach((value, index) => {
          doc.rect(x, y, columnWidths[index], rowHeight).stroke('#000000');
          doc.fillColor('#000000').text(String(value), x + 4, y + 4, {
            width: columnWidths[index] - 8,
            align: index >= 5 ? 'right' : index === 0 ? 'center' : 'left',
            ellipsis: true,
          });
          x += columnWidths[index];
        });

        doc.y = y + rowHeight;
        doc.x = startX;
      };

      drawDocumentHeading();

      if (!report.length) {
        doc
          .font('Helvetica')
          .fontSize(10)
          .text('Aucun paiement trouvé pour ce filtre.', { align: 'left' });
      } else {
        drawHeader();
        report.forEach((item: any, index: number) => {
          if (doc.y + rowHeight > bottomLimit) {
            doc.addPage();
            drawDocumentHeading(true);
            drawHeader();
          }

          const student = item.enrollmentId?.studentId;
          const enrollment = item.enrollmentId;
          const values = [
            index + 1,
            `${student?.lastname ?? ''} ${student?.firstname ?? ''}`.trim(),
            student?.gender ?? '',
            student?.matricule ?? '',
            enrollment?.levelId?.label ?? '',
            item.amountDue ?? 0,
            item.amountPaid ?? 0,
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
      doc
        .font('Times-Roman')
        .fontSize(10)
        .text(`Date : ${new Date().toLocaleDateString('fr-FR')}`, {
          align: 'right',
        });
      doc.moveDown(1);

      const headers = [
        'Matricule',
        'Nom',
        'Sexe',
        'Inscription',
        'Écolage',
        'Total dû',
        'Payé',
        'Reste',
      ];
      const columnWidths = [70, 120, 40, 70, 70, 65, 65, 65];
      const rowHeight = 18;
      const startX = doc.page.margins.left;
      const bottomLimit = doc.page.height - doc.page.margins.bottom;

      const drawHeader = () => {
        const y = doc.y;
        let x = startX;
        doc.font('Times-Bold').fontSize(10).fillColor('#000000');
        headers.forEach((text, index) => {
          doc
            .rect(x, y, columnWidths[index], rowHeight)
            .fillAndStroke('#F0F0F0', '#000000');
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

  async renderStudentListPdf(roll: NominalRoll) {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 36, size: 'A4', bufferPages: true });
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

    return await new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const drawDocumentHeading = (continued = false) => {
        doc
          .font('Helvetica-Bold')
          .fontSize(16)
          .text(roll.schoolName.toUpperCase(), { align: 'center' });
        doc.moveDown(0.55);
        doc
          .font('Helvetica-Bold')
          .fontSize(14)
          .text(
            `Liste nominative de la classe de ${roll.levelName}${continued ? ' (suite)' : ''}`,
            {
              align: 'center',
            },
          );
        doc.moveDown(0.35);
        doc
          .font('Helvetica')
          .fontSize(11)
          .text(`Année scolaire : ${roll.schoolYearLabel}`, {
            align: 'center',
          });
        doc.moveDown(0.8);

        if (!continued) {
          const statsY = doc.y;
          const statsWidth =
            (doc.page.width - doc.page.margins.left - doc.page.margins.right) /
            3;
          const stats = [
            `Garçons : ${String(roll.boys).padStart(2, '0')}`,
            `Filles : ${String(roll.girls).padStart(2, '0')}`,
            `Total : ${String(roll.total).padStart(2, '0')}`,
          ];
          stats.forEach((value, index) => {
            doc
              .font('Helvetica-Bold')
              .fontSize(11)
              .text(value, doc.page.margins.left + index * statsWidth, statsY, {
                width: statsWidth,
                align: index === 0 ? 'left' : index === 2 ? 'right' : 'center',
              });
          });
          doc.y = statsY + 24;
        }
      };

      drawDocumentHeading();

      const headers = ['N°', 'Nom et prénoms', 'Matricule', 'Sexe'];
      const availableWidth =
        doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const columnWidths = [45, availableWidth - 45 - 105 - 55, 105, 55];
      const rowHeight = 22;
      const startX = doc.page.margins.left;
      const bottomLimit = doc.page.height - doc.page.margins.bottom;

      const drawHeader = () => {
        const y = doc.y;
        let x = startX;
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000');

        headers.forEach((text, index) => {
          doc
            .rect(x, y, columnWidths[index], rowHeight)
            .fillAndStroke('#E8E8E8', '#222222');
          doc.fillColor('#000000').text(text, x + 4, y + 6, {
            width: columnWidths[index] - 8,
            align: 'center',
          });
          x += columnWidths[index];
        });

        doc.y = y + rowHeight;
        doc.x = startX;
      };

      const drawRow = (values: any[], rowNum: number) => {
        const y = doc.y;
        let x = startX;
        doc.font('Helvetica').fontSize(10).fillColor('#000000');

        const allValues = [String(rowNum), ...values];
        allValues.forEach((value, index) => {
          doc.rect(x, y, columnWidths[index], rowHeight).stroke('#000000');
          doc.fillColor('#000000').text(String(value), x + 4, y + 6, {
            width: columnWidths[index] - 8,
            align: index === 0 ? 'center' : index === 3 ? 'center' : 'left',
            ellipsis: true,
          });
          x += columnWidths[index];
        });

        doc.y = y + rowHeight;
        doc.x = startX;
      };

      drawHeader();

      roll.students.forEach((student, index) => {
        if (doc.y + rowHeight > bottomLimit) {
          doc.addPage();
          drawDocumentHeading(true);
          drawHeader();
        }

        const values = [
          `${student.lastname} ${student.firstname}`.trim(),
          student.matricule,
          student.gender,
        ];

        drawRow(values, index + 1);
      });

      doc.end();
    });
  }
}
