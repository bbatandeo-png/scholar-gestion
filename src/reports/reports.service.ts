import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import PDFDocument from 'pdfkit';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { Invoice } from '../billing/schemas/invoice.schema';
import { Level } from '../levels/schemas/level.schema';
import { Student } from '../students/schemas/student.schema';
import { SchoolYear } from '../school-years/schemas/school-year.schema';
import { SettingsService } from '../settings/settings.service';
import { SchoolYearStatus } from '../common/enums/domain.enums';
import { Payment } from '../payments/schemas/payment.schema';

type PdfDocumentInstance = InstanceType<typeof PDFDocument>;
export type RegistrationPaidFilter =
  | 'registration'
  | 'tuition'
  | 'full'
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
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    private readonly settingsService: SettingsService,
  ) {}

  private applyEnrollmentSnapshots(invoices: any[]) {
    return invoices.map((invoice: any) => {
      const enrollment = invoice.enrollmentId;
      if (!enrollment) {
        return invoice;
      }
      return {
        ...invoice,
        enrollmentId: {
          ...enrollment,
          studentId: enrollment.studentSnapshot
            ? { ...(enrollment.studentId ?? {}), ...enrollment.studentSnapshot }
            : enrollment.studentId,
          levelId: enrollment.levelSnapshot
            ? { ...(enrollment.levelId ?? {}), ...enrollment.levelSnapshot }
            : enrollment.levelId,
        },
      };
    });
  }

  async studentsByLevel(schoolYearId: string) {
    return this.enrollmentModel.aggregate([
      {
        $match: {
          schoolYearId: new Types.ObjectId(schoolYearId),
          status: 'active',
        },
      },
      { $group: { _id: '$levelId', total: { $sum: 1 } } },
    ]);
  }

  async paidStudents(schoolYearId: string) {
    const invoices = await this.invoiceModel
      .find({ schoolYearId, status: 'paid' })
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
    return this.applyEnrollmentSnapshots(invoices);
  }

  async unpaidStudents(schoolYearId: string) {
    const invoices = await this.invoiceModel
      .find({ schoolYearId, status: { $in: ['unpaid', 'partial'] } })
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
    return this.applyEnrollmentSnapshots(invoices);
  }

  async registrationPaidStudents(
    filter: RegistrationPaidFilter = 'registration',
    levelId?: string,
    schoolYearId?: string,
  ) {
    const invoices = await this.invoiceModel
      .find(schoolYearId ? { schoolYearId } : {})
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

    return this.applyEnrollmentSnapshots(invoices)
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
        if (filter === 'full') {
          return (
            invoice.amountDue > 0 && invoice.amountPaid >= invoice.amountDue
          );
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

  async classFinancialSituation(schoolYearId: string) {
    const enrollments = await this.enrollmentModel
      .find({ schoolYearId, status: 'active' })
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
        const student = (enrollment.studentSnapshot ??
          enrollment.studentId) as any;
        const level = (enrollment.levelSnapshot ?? enrollment.levelId) as any;
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

  async getNominalRoll(
    levelId: string,
    schoolYearId?: string,
  ): Promise<NominalRoll> {
    if (!levelId) {
      throw new BadRequestException('Veuillez sélectionner une classe');
    }

    const levelQuery = this.levelModel.findById(levelId).lean();
    const schoolYearQuery = schoolYearId
      ? this.schoolYearModel.findById(schoolYearId).lean()
      : this.schoolYearModel.findOne({ status: SchoolYearStatus.OPEN }).lean();
    const level = await levelQuery.exec();
    const schoolYear = await schoolYearQuery.exec();
    const schoolName = await this.getSchoolName();

    if (!level) {
      throw new NotFoundException('Classe introuvable');
    }
    if (!schoolYear) {
      throw new BadRequestException("Aucune année scolaire n'est disponible");
    }

    const enrollments = await this.enrollmentModel
      .find({
        levelId,
        schoolYearId: schoolYear._id,
        status: 'active',
      })
      .populate({
        path: 'studentId',
        select: 'lastname firstname matricule gender',
      })
      .lean()
      .exec();

    const students = enrollments
      .map((enrollment: any) => ({
        ...(enrollment.studentId ?? {}),
        ...(enrollment.studentSnapshot ?? {}),
      }))
      .filter((student: any) => student.lastname || student.firstname)
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
      schoolName,
      schoolYearLabel:
        schoolYear.label ||
        `${new Date(schoolYear.startDate).getFullYear()} – ${new Date(schoolYear.endDate).getFullYear()}`,
      levelName: (level as any).label,
      students,
      boys: students.filter((student) => student.gender === 'M').length,
      girls: students.filter((student) => student.gender === 'F').length,
      total: students.length,
    };
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

  private renderPdfHeader(
    doc: PdfDocumentInstance,
    schoolName: string,
    levelName?: string,
    schoolYearLabel?: string,
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
    if (schoolYearLabel) {
      doc.moveDown(0.25);
      doc
        .font('Times-Roman')
        .fontSize(10)
        .text(`Annee scolaire : ${schoolYearLabel}`, { align: 'center' });
    }

    doc.moveDown(1);
  }

  async revenue(schoolYearId: string) {
    const [aggregation, payments] = await Promise.all([
      this.invoiceModel.aggregate([
        { $match: { schoolYearId: new Types.ObjectId(schoolYearId) } },
        {
          $group: {
            _id: null,
            outstanding: { $sum: '$balanceDue' },
            totalDue: { $sum: '$totalDue' },
          },
        },
      ]),
      this.paymentModel.find({ schoolYearId }).lean().exec(),
    ]);

    const aggregated = aggregation[0];
    let collected = 0;
    let currentFeesCollected = 0;
    for (const payment of payments as any[]) {
      collected += Number(payment.amount ?? 0);
      currentFeesCollected += (payment.allocation ?? [])
        .filter((item: any) => item.type === 'current_fees')
        .reduce((sum: number, item: any) => sum + Number(item.amount ?? 0), 0);
    }
    return {
      collected,
      outstanding: aggregated?.outstanding ?? 0,
      totalDue: aggregated?.totalDue ?? 0,
      currentFeesCollected,
      arrearsCollected: Math.max(collected - currentFeesCollected, 0),
    };
  }

  async renderRegistrationPaidPdf(
    report: any[],
    filter:
      | 'registration'
      | 'tuition'
      | 'full'
      | 'partial'
      | 'none' = 'registration',
    levelName?: string,
    schoolYearLabel?: string,
  ) {
    const schoolName = await this.settingsService.getSchoolName();
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      margin: 40,
      size: 'A4',
      layout: 'landscape',
      bufferPages: true,
    });
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

    return await new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      this.renderPdfHeader(doc, schoolName, levelName, schoolYearLabel);

      const filterLabel =
        filter === 'tuition'
          ? 'Écolage payé'
          : filter === 'full'
            ? 'Inscription et écolage payés'
            : filter === 'partial'
              ? 'Paiement partiel'
              : filter === 'none'
                ? 'Aucun paiement'
                : 'Inscription payée';

      const title = `Liste des élèves - ${filterLabel}`;
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
        'Élève',
        'Matricule',
        'Année',
        'Niveau',
        'Inscription',
        'Payé',
        'Reste',
      ];
      const columnWidths = [140, 60, 50, 80, 65, 65, 65];
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
        doc
          .font('Times-Roman')
          .fontSize(10)
          .text('Aucun résultat pour ce filtre.', { align: 'left' });
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

  async renderClassFinancialSituationPdf(
    report: any[],
    levelName?: string,
    schoolYearLabel?: string,
  ) {
    const schoolName = await this.settingsService.getSchoolName();
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

    return await new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      this.renderPdfHeader(doc, schoolName, levelName, schoolYearLabel);

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
            { align: 'center' },
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

      const headers = ['N°', 'Nom et prénoms', 'Matricule', 'Sexe'];
      const availableWidth =
        doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const columnWidths = [45, availableWidth - 205, 105, 55];
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

      const drawRow = (values: string[], rowNumber: number) => {
        const y = doc.y;
        let x = startX;
        const allValues = [String(rowNumber), ...values];
        doc.font('Helvetica').fontSize(10).fillColor('#000000');
        allValues.forEach((value, index) => {
          doc.rect(x, y, columnWidths[index], rowHeight).stroke('#000000');
          doc.fillColor('#000000').text(value, x + 4, y + 6, {
            width: columnWidths[index] - 8,
            align: index === 0 || index === 3 ? 'center' : 'left',
            ellipsis: true,
          });
          x += columnWidths[index];
        });
        doc.y = y + rowHeight;
        doc.x = startX;
      };

      drawDocumentHeading();
      drawHeader();
      roll.students.forEach((student, index) => {
        if (doc.y + rowHeight > bottomLimit) {
          doc.addPage();
          drawDocumentHeading(true);
          drawHeader();
        }
        drawRow(
          [
            `${student.lastname} ${student.firstname}`.trim(),
            student.matricule,
            student.gender,
          ],
          index + 1,
        );
      });
      doc.end();
    });
  }
}
