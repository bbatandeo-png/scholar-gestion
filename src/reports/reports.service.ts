import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import PDFDocument from 'pdfkit';
import {
  AlignmentType,
  Document,
  Footer,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { Invoice } from '../billing/schemas/invoice.schema';
import { Level } from '../levels/schemas/level.schema';
import { Student } from '../students/schemas/student.schema';
import { SchoolYear } from '../school-years/schemas/school-year.schema';
import { EcolesService } from '../ecoles/ecoles.service';
import { SchoolYearStatus } from '../common/enums/domain.enums';
import { Payment } from '../payments/schemas/payment.schema';
import { SettingsService } from '../settings/settings.service';
import { resolveUploadedImagePath } from '../common/utils/uploaded-image.util';
import { resolveStaticAssetPath } from '../common/utils/runtime-paths.util';
import { getReadableTextColor } from '../common/utils/color.util';
import { toDisplayString } from '../common/utils/safe-string.util';
import ExcelJS from 'exceljs';
import {
  PopulatedEnrollmentLean,
  PopulatedInvoiceLean,
  PopulatedLevelLean,
  PopulatedStudentLean,
} from '../common/types/populated-refs.types';

type PdfDocumentInstance = InstanceType<typeof PDFDocument>;
export type RegistrationPaidFilter =
  | 'registration'
  | 'tuition'
  | 'full'
  | 'partial'
  | 'none';

export type StudentIdCardData = {
  schoolName: string;
  schoolLogoPath: string | null;
  headerColor: string | null;
  ministereTutelle: string;
  localite: string;
  contact: string;
  chefEtablissementNom: string;
  lastname: string;
  firstname: string;
  birthDateAndPlaceLabel: string;
  genderLabel: string;
  levelLabel: string;
  issueDateLabel: string;
  photoPath: string | null;
};

export interface RegistrationPaidRow extends PopulatedInvoiceLean {
  amountDue: number;
  amountPaid: number;
}

export interface ClassFinancialSituationRow {
  enrollment: PopulatedEnrollmentLean;
  student?: PopulatedStudentLean | Record<string, unknown> | null;
  level?: PopulatedLevelLean | Record<string, unknown> | null;
  registrationFee: number;
  tuitionFee: number;
  paidAmount: number;
  balanceDue: number;
  totalDue: number;
}

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

// How many "Note" and "Devoir" columns the blank grade sheet (PDF/Word/
// Excel, see renderGradeSheet*() below) should have - configurable per
// school/subject instead of the fixed 2 Notes + 1 Devoir it shipped with,
// since different subjects/levels grade differently (some track 3 written
// notes and no devoir, others 1 note and 4 devoirs, etc).
export type GradeSheetOptions = {
  noteCount?: number;
  devoirCount?: number;
  interroCount?: number;
};

type GradeSheetColumnPlan = {
  soloHeaders: string[];
  groupSubHeaders: string[];
  // Widths in "pt", the PDF renderer's own unit - the Word and Excel
  // renderers scale these to DXA / character-width themselves so all three
  // formats stay visually consistent as the counts change.
  soloWidthsPt: number[];
  groupSubWidthsPt: number[];
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
    private readonly ecolesService: EcolesService,
    private readonly settingsService: SettingsService,
  ) {}

  private applyEnrollmentSnapshots(
    invoices: PopulatedInvoiceLean[],
  ): PopulatedInvoiceLean[] {
    return invoices.map((invoice) => {
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
    return this.enrollmentModel.aggregate<{ _id: string; total: number }>([
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
    const invoices = (await this.invoiceModel
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
      .exec()) as PopulatedInvoiceLean[];
    return this.applyEnrollmentSnapshots(invoices);
  }

  async unpaidStudents(schoolYearId: string) {
    const invoices = (await this.invoiceModel
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
      .exec()) as PopulatedInvoiceLean[];
    return this.applyEnrollmentSnapshots(invoices);
  }

  async registrationPaidStudents(
    filter: RegistrationPaidFilter = 'registration',
    levelId?: string,
    schoolYearId?: string,
  ) {
    const invoices = (await this.invoiceModel
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
      .exec()) as PopulatedInvoiceLean[];

    const toEntityId = (value: unknown): string => {
      if (!value) return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'object') {
        const id = (value as { _id?: unknown })._id;
        if (id) return toDisplayString(id);
      }
      return toDisplayString(value);
    };

    return this.applyEnrollmentSnapshots(invoices)
      .map((invoice) => {
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
      .filter((invoice) => {
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
      .sort((a, b) => {
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
    const enrollments = (await this.enrollmentModel
      .find({ schoolYearId, status: 'active' })
      .populate([
        { path: 'studentId' },
        { path: 'levelId' },
        { path: 'schoolYearId' },
      ])
      .lean()
      .exec()) as PopulatedEnrollmentLean[];

    const invoices = (await this.invoiceModel
      .find({ enrollmentId: { $in: enrollments.map((item) => item._id) } })
      .populate({
        path: 'enrollmentId',
        populate: [{ path: 'studentId' }, { path: 'levelId' }],
      })
      .lean()
      .exec()) as PopulatedInvoiceLean[];

    const invoiceByEnrollment = new Map(
      invoices.map((invoice) => [
        toDisplayString(invoice.enrollmentId?._id ?? invoice.enrollmentId),
        invoice,
      ]),
    );

    return enrollments
      .map((enrollment) => {
        const invoice = invoiceByEnrollment.get(
          toDisplayString(enrollment._id),
        );
        const student = enrollment.studentSnapshot ?? enrollment.studentId;
        const level = enrollment.levelSnapshot ?? enrollment.levelId;
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
      .sort((a, b) => {
        const aName =
          `${toDisplayString(a.student?.lastname)} ${toDisplayString(a.student?.firstname)}`.trim();
        const bName =
          `${toDisplayString(b.student?.lastname)} ${toDisplayString(b.student?.firstname)}`.trim();
        return aName.localeCompare(bName, 'fr');
      });
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
      (await this.ecolesService.getCurrentSchoolName()) ||
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

    const enrollments = (await this.enrollmentModel
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
      .exec()) as unknown as Array<
      PopulatedEnrollmentLean & { createdAt: Date }
    >;

    const students = enrollments
      .map((enrollment) => ({
        ...(enrollment.studentId ?? {}),
        ...(enrollment.studentSnapshot ?? {}),
        enrolledAt: enrollment.createdAt,
      }))
      .filter((student) => student.lastname || student.firstname)
      .map((student) => ({
        lastname: String(student.lastname ?? ''),
        firstname: String(student.firstname ?? ''),
        matricule: String(student.matricule ?? ''),
        gender: String(student.gender ?? '').toUpperCase(),
        enrolledAt: student.enrolledAt,
      }))
      // Most recently registered first - the date itself isn't shown on
      // this document (a fixed-layout official roster), only the order.
      .sort(
        (left, right) =>
          new Date(right.enrolledAt).getTime() -
          new Date(left.enrolledAt).getTime(),
      )
      .map(({ lastname, firstname, matricule, gender }) => ({
        lastname,
        firstname,
        matricule,
        gender,
      }));

    return {
      schoolName,
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

  // Roster for the "Cartes scolaires" picker page - unlike getNominalRoll
  // (which deliberately strips ids for the printed official document),
  // this keeps each student's _id so the page can link to their card.
  async getClassRosterForCards(levelId: string, schoolYearId?: string) {
    if (!levelId) {
      throw new BadRequestException('Veuillez sélectionner une classe');
    }
    const level = await this.levelModel.findById(levelId).lean().exec();
    const schoolYearQuery = schoolYearId
      ? this.schoolYearModel.findById(schoolYearId).lean()
      : this.schoolYearModel.findOne({ status: SchoolYearStatus.OPEN }).lean();
    const schoolYear = await schoolYearQuery.exec();
    if (!level) {
      throw new NotFoundException('Classe introuvable');
    }
    if (!schoolYear) {
      throw new BadRequestException("Aucune année scolaire n'est disponible");
    }

    const enrollments = (await this.enrollmentModel
      .find({ levelId, schoolYearId: schoolYear._id, status: 'active' })
      .populate({
        path: 'studentId',
        select: 'lastname firstname matricule',
      })
      .lean()
      .exec()) as unknown as Array<
      PopulatedEnrollmentLean & { createdAt: Date }
    >;

    const students = enrollments
      .slice()
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .map((enrollment) => ({
        _id: toDisplayString(
          enrollment.studentId?._id ?? enrollment.studentId ?? '',
        ),
        lastname: toDisplayString(
          enrollment.studentSnapshot?.lastname ??
            enrollment.studentId?.lastname ??
            '',
        ),
        firstname: toDisplayString(
          enrollment.studentSnapshot?.firstname ??
            enrollment.studentId?.firstname ??
            '',
        ),
        matricule: toDisplayString(
          enrollment.studentSnapshot?.matricule ??
            enrollment.studentId?.matricule ??
            '',
        ),
      }))
      .filter((student) => student._id);

    return {
      levelName: level.label,
      schoolYearId: toDisplayString(schoolYear._id),
      students,
    };
  }

  // Assembles everything renderStudentIdCardPdf()/renderClassIdCardsPdf()
  // need for one student's card - shared by the single-student and
  // whole-class routes so both always show identical data (same pattern
  // as BulletinsService.buildBulletinPageData).
  async getStudentIdCardData(
    studentId: string,
    schoolYearId?: string,
  ): Promise<StudentIdCardData> {
    const student = await this.studentModel.findById(studentId).lean().exec();
    if (!student) {
      throw new NotFoundException('Eleve introuvable');
    }

    const schoolYearQuery = schoolYearId
      ? this.schoolYearModel.findById(schoolYearId).lean()
      : this.schoolYearModel.findOne({ status: SchoolYearStatus.OPEN }).lean();
    const schoolYear = await schoolYearQuery.exec();

    const enrollment = schoolYear
      ? ((await this.enrollmentModel
          .findOne({
            studentId,
            schoolYearId: schoolYear._id,
            status: 'active',
          })
          .populate({ path: 'levelId', select: 'label' })
          .lean()
          .exec()) as PopulatedEnrollmentLean | null)
      : null;
    const levelLabel =
      (enrollment?.levelSnapshot?.label as string | undefined) ??
      enrollment?.levelId?.label ??
      '-';

    const [ecole, chefEtablissementNom] = await Promise.all([
      this.ecolesService.getCurrentEcole(),
      this.settingsService.getChefEtablissementNom(),
    ]);

    const genderLabel =
      String(student.gender ?? '').toUpperCase() === 'F'
        ? 'Féminin'
        : 'Masculin';
    const birthDate = student.birthDate ? new Date(student.birthDate) : null;
    const birthDateLabel =
      birthDate && !Number.isNaN(birthDate.getTime())
        ? `${String(birthDate.getDate()).padStart(2, '0')}/${String(birthDate.getMonth() + 1).padStart(2, '0')}/${birthDate.getFullYear()}`
        : '-';
    const birthPlace = student.birthPlace ? ` à ${student.birthPlace}` : '';

    const today = new Date();
    const issueDateLabel = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

    return {
      schoolName: ecole?.nom || (await this.getSchoolName()),
      schoolLogoPath: this.ecolesService.resolveLogoAbsolutePath(ecole),
      headerColor: ecole?.couleurCarte || null,
      ministereTutelle:
        ecole?.ministereTutelle || "MINISTERE DE L'EDUCATION NATIONALE",
      localite: ecole?.localite || '-',
      contact: ecole?.contact || '-',
      chefEtablissementNom: chefEtablissementNom || '-',
      lastname: student.lastname ?? '',
      firstname: student.firstname ?? '',
      birthDateAndPlaceLabel: `${birthDateLabel}${birthPlace}`,
      genderLabel,
      levelLabel,
      issueDateLabel,
      photoPath: resolveUploadedImagePath(student.photo),
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
      this.invoiceModel.aggregate<{ outstanding: number; totalDue: number }>([
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
    for (const payment of payments) {
      collected += Number(payment.amount ?? 0);
      currentFeesCollected += (payment.allocation ?? [])
        .filter((item) => item.type === 'current_fees')
        .reduce((sum: number, item) => sum + Number(item.amount ?? 0), 0);
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
    report: RegistrationPaidRow[],
    filter:
      | 'registration'
      | 'tuition'
      | 'full'
      | 'partial'
      | 'none' = 'registration',
    levelName?: string,
    schoolYearLabel?: string,
  ) {
    const schoolName = await this.ecolesService.getCurrentSchoolName();
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      margin: 40,
      size: 'A4',
      layout: 'landscape',
      bufferPages: true,
    });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

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
      const columnWidths = [160, 70, 70, 90, 70, 70, 70];
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
            ellipsis: true,
            lineBreak: false,
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
            lineBreak: false,
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
        report.forEach((item) => {
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
    report: ClassFinancialSituationRow[],
    levelName?: string,
    schoolYearLabel?: string,
  ) {
    const schoolName = await this.ecolesService.getCurrentSchoolName();
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

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
            ellipsis: true,
            lineBreak: false,
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
            lineBreak: false,
          });
          x += columnWidths[index];
        });
        doc.y = y + rowHeight;
        doc.x = startX;
      };

      drawHeader();

      report.forEach((item) => {
        if (doc.y + rowHeight > bottomLimit) {
          doc.addPage();
          drawHeader();
        }

        const student = item.student as PopulatedStudentLean | null | undefined;
        const values = [
          student?.matricule ?? '',
          `${student?.lastname ?? ''} ${student?.firstname ?? ''}`.trim(),
          student?.gender ?? '',
          item.registrationFee.toFixed(2),
          item.tuitionFee.toFixed(2),
          item.totalDue.toFixed(2),
          item.paidAmount.toFixed(2),
          item.balanceDue.toFixed(2),
        ];

        drawRow(values);
      });

      doc.end();
    });
  }

  async renderStudentListPdf(roll: NominalRoll) {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 36, size: 'A4', bufferPages: true });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

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
            ellipsis: true,
            lineBreak: false,
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
            lineBreak: false,
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

  // Shared by all three renderGradeSheet*() methods below: works out the
  // column headers and their widths for a given note/devoir count. Kept in
  // "pt" - the PDF's own unit, comfortably inside A4's ~523pt usable width
  // at 36pt margins - since that's the tightest of the three formats; Word
  // and Excel scale these same widths to their own units so a given
  // note/devoir count lays out the same way (proportionally) everywhere.
  private buildGradeSheetColumns(
    noteCountInput: number,
    devoirCountInput: number,
    interroCountInput: number,
  ): GradeSheetColumnPlan {
    // Capped at 8 each: past that, the elastic columns below floor out at
    // MIN_ELASTIC and the table simply runs wider than one printed page -
    // still usable, just no longer a design goal.
    const clamp = (value: number) =>
      Math.max(0, Math.min(8, Math.round(Number.isFinite(value) ? value : 0)));
    const noteCount = clamp(noteCountInput);
    const devoirCount = clamp(devoirCountInput);
    const interroCount = clamp(interroCountInput);

    // A single interro/devoir stays the bare "Interro"/"Devoir" the
    // reference model uses - only numbered once there's more than one.
    const numberedOrBare = (label: string, count: number) =>
      count === 1
        ? [label]
        : Array.from({ length: count }, (_, i) => `${label} ${i + 1}`);

    const soloHeaders = [
      'N°',
      'Nom et prénoms',
      'Matricule',
      'Sexe',
      ...Array.from({ length: noteCount }, (_, i) => `Note ${i + 1}`),
    ];
    const groupSubHeaders = [
      ...numberedOrBare('Interro', interroCount),
      ...numberedOrBare('Devoir', devoirCount),
      'Compo',
    ];

    const TABLE_WIDTH_PT = 515;
    const FIXED_NO = 25;
    const FIXED_MATRICULE = 80;
    const FIXED_SEXE = 28;
    const MIN_NOM = 90;
    const MIN_ELASTIC = 24;
    const MAX_ELASTIC = 44;

    const elasticCount = noteCount + groupSubHeaders.length;
    const availableForNomAndElastic =
      TABLE_WIDTH_PT - FIXED_NO - FIXED_MATRICULE - FIXED_SEXE;
    const elasticWidth =
      elasticCount === 0
        ? MAX_ELASTIC
        : Math.min(
            MAX_ELASTIC,
            Math.max(
              MIN_ELASTIC,
              (availableForNomAndElastic - MIN_NOM) / elasticCount,
            ),
          );
    const nomWidth = Math.max(
      MIN_NOM,
      availableForNomAndElastic - elasticCount * elasticWidth,
    );

    return {
      soloHeaders,
      groupSubHeaders,
      soloWidthsPt: [
        FIXED_NO,
        nomWidth,
        FIXED_MATRICULE,
        FIXED_SEXE,
        ...Array<number>(noteCount).fill(elasticWidth),
      ],
      groupSubWidthsPt: Array<number>(groupSubHeaders.length).fill(
        elasticWidth,
      ),
    };
  }

  // A blank, printable per-class mark sheet: the roster (name/matricule/sexe)
  // is real data, everything else - trimestre/semestre, matiere, coefficient,
  // teacher, and every note column - is left blank for a teacher to fill in
  // by hand, one photocopy per subject. Not tied to the digital Bulletins
  // feature at all: this is the paper step schools already run before (or
  // instead of) entering marks into the system.
  async renderGradeSheetPdf(
    roll: NominalRoll,
    options: GradeSheetOptions = {},
  ) {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 36, size: 'A4', bufferPages: true });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    return await new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const drawDocumentHeading = (continued = false) => {
        doc
          .font('Helvetica-Bold')
          .fontSize(15)
          .text(roll.schoolName.toUpperCase(), { align: 'center' });
        doc.moveDown(0.5);
        doc
          .font('Helvetica-Bold')
          .fontSize(13)
          .text(
            `Fiche de notes du ______ Trimestre/Semestre de la classe de ${roll.levelName}${continued ? ' (suite)' : ''}`,
            { align: 'center' },
          );
        doc.moveDown(0.4);
        doc
          .font('Helvetica')
          .fontSize(10)
          .text(`Année scolaire : ${roll.schoolYearLabel}`, {
            align: 'center',
          });
        doc.moveDown(1.1);

        if (!continued) {
          doc
            .font('Helvetica')
            .fontSize(10)
            .text(
              'Matière : _____________________        Coef : ______        Chargé de la matière : _____________________',
              { align: 'left' },
            );
          doc.moveDown(1);

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
              .fontSize(10)
              .text(value, doc.page.margins.left + index * statsWidth, statsY, {
                width: statsWidth,
                align: index === 0 ? 'left' : index === 2 ? 'right' : 'center',
              });
          });
          doc.y = statsY + 30;
        }
      };

      // N° / Nom et prenoms / Matricule / Sexe / Note 1..N / Interro 1 /
      // Interro 2 / Devoir 1..M / Compo - elastic per buildGradeSheetColumns()
      // above, narrow enough on A4 portrait to fit inside its ~523pt usable
      // width at 36pt margins for a reasonable note/devoir count.
      const plan = this.buildGradeSheetColumns(
        options.noteCount ?? 2,
        options.devoirCount ?? 1,
        options.interroCount ?? 2,
      );
      const columnWidths = [...plan.soloWidthsPt, ...plan.groupSubWidthsPt];
      const soloCount = plan.soloHeaders.length;
      const headerRowHeight = 18;
      const rowHeight = 20;
      const startX = doc.page.margins.left;
      const bottomLimit = doc.page.height - doc.page.margins.bottom;

      const drawHeader = () => {
        const y = doc.y;
        const groupTop = y;
        let x = startX;
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000');
        plan.soloHeaders.forEach((text, index) => {
          // Spans both header rows: a lone header has no sub-header below it.
          doc
            .rect(x, groupTop, columnWidths[index], headerRowHeight * 2)
            .fillAndStroke('#E8E8E8', '#222222');
          doc
            .fillColor('#000000')
            .text(text, x + 2, groupTop + headerRowHeight / 2, {
              width: columnWidths[index] - 4,
              align: 'center',
              ellipsis: true,
              lineBreak: false,
            });
          x += columnWidths[index];
        });

        const groupWidth = columnWidths
          .slice(soloCount)
          .reduce((a, b) => a + b, 0);
        doc
          .rect(x, groupTop, groupWidth, headerRowHeight)
          .fillAndStroke('#E8E8E8', '#222222');
        doc.fillColor('#000000').text('Notes à saisir', x, groupTop + 5, {
          width: groupWidth,
          align: 'center',
        });

        let subX = x;
        const subY = groupTop + headerRowHeight;
        plan.groupSubHeaders.forEach((text, index) => {
          const width = columnWidths[soloCount + index];
          doc
            .rect(subX, subY, width, headerRowHeight)
            .fillAndStroke('#E8E8E8', '#222222');
          doc.fillColor('#000000').text(text, subX + 1, subY + 5, {
            width: width - 2,
            align: 'center',
            ellipsis: true,
            lineBreak: false,
          });
          subX += width;
        });

        doc.y = groupTop + headerRowHeight * 2;
        doc.x = startX;
      };

      const drawRow = (
        student: NominalRoll['students'][number],
        rowNumber: number,
      ) => {
        const y = doc.y;
        let x = startX;
        const values = [
          String(rowNumber),
          `${student.lastname} ${student.firstname}`.trim(),
          student.matricule,
          student.gender,
          ...Array<string>(columnWidths.length - 4).fill(''),
        ];
        doc.font('Helvetica').fontSize(9).fillColor('#000000');
        values.forEach((value, index) => {
          doc.rect(x, y, columnWidths[index], rowHeight).stroke('#000000');
          if (value) {
            doc.fillColor('#000000').text(value, x + 3, y + 6, {
              width: columnWidths[index] - 6,
              // A height bound is what actually makes pdfkit's ellipsis
              // truncate a too-long single "word" (e.g. a long matricule
              // with no spaces) onto one line - without it, lineBreak:false
              // alone still let text like "MAT-ASSOGBA" wrap and overflow
              // down into the row below.
              height: rowHeight - 10,
              align: index === 0 || index === 3 ? 'center' : 'left',
              ellipsis: true,
              lineBreak: false,
            });
          }
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
        drawRow(student, index + 1);
      });

      // A long roster spills onto several pages (see the addPage() above) -
      // number every one of them once the true page count is known, rather
      // than while it's still being drawn. Requires bufferPages: true,
      // already set above.
      const pageRange = doc.bufferedPageRange();
      for (
        let i = pageRange.start;
        i < pageRange.start + pageRange.count;
        i += 1
      ) {
        doc.switchToPage(i);
        // Writing inside the bottom margin is exactly what pdfkit's own
        // auto-pagination watches for - left as-is, this footer text
        // silently appends a blank extra page per call instead of landing
        // on the page it's meant to number. Zeroing the tracked margin for
        // the duration of the write is the standard pdfkit footer pattern.
        const bottomMargin = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#000000')
          .text(
            `Page ${i + 1} / ${pageRange.count}`,
            doc.page.margins.left,
            doc.page.height - bottomMargin + 12,
            {
              width:
                doc.page.width - doc.page.margins.left - doc.page.margins.right,
              align: 'center',
              lineBreak: false,
            },
          );
        doc.page.margins.bottom = bottomMargin;
      }

      doc.end();
    });
  }

  // Same blank grade sheet as renderGradeSheetPdf(), as an .xlsx. Uses
  // exceljs (not the xlsx/buildExcelBuffer* helpers used by every other
  // export in this file) purely for its cell borders: the community
  // edition of the xlsx package writes merges fine but can't write cell
  // border styles at all, and this particular document's whole point is a
  // fillable, printable grid of boxes.
  async renderGradeSheetExcel(
    roll: NominalRoll,
    options: GradeSheetOptions = {},
  ): Promise<Buffer> {
    const plan = this.buildGradeSheetColumns(
      options.noteCount ?? 2,
      options.devoirCount ?? 1,
      options.interroCount ?? 2,
    );
    const soloCount = plan.soloHeaders.length;
    const COLS = soloCount + plan.groupSubHeaders.length;
    // pt -> Excel "character width" - roughly the same ~4.5pt/char ratio the
    // original fixed widths (25→5, 80→16, 28→6, ...) were tuned to.
    const toCharWidth = (pt: number) => Math.max(4, Math.round(pt / 4.5));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Fiche de notes', {
      pageSetup: {
        orientation: 'landscape',
        fitToPage: true,
        // A long roster prints across several pages - repeat the header
        // rows (rows 8-9: the school/title/year/matiere/stats lines above
        // them are always exactly 7 rows) on every one, and number the
        // pages themselves via the footer below.
        printTitlesRow: '8:9',
      },
      headerFooter: { oddFooter: '&CPage &P sur &N' },
    });

    const thinBorder: Partial<ExcelJS.Borders> = {
      top: { style: 'thin' },
      bottom: { style: 'thin' },
      left: { style: 'thin' },
      right: { style: 'thin' },
    };
    const centered: Partial<ExcelJS.Alignment> = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true,
    };

    sheet.columns = [...plan.soloWidthsPt, ...plan.groupSubWidthsPt].map(
      (pt) => ({ width: toCharWidth(pt) }),
    );

    const addTitleRow = (text: string, bold: boolean, size: number) => {
      const row = sheet.addRow([text]);
      sheet.mergeCells(row.number, 1, row.number, COLS);
      const cell = row.getCell(1);
      cell.font = { bold, size };
      cell.alignment = {
        horizontal: text.startsWith('Matière') ? 'left' : 'center',
      };
    };

    addTitleRow(roll.schoolName.toUpperCase(), true, 14);
    addTitleRow(
      `Fiche de notes du ______ Trimestre/Semestre de la classe de ${roll.levelName}`,
      true,
      12,
    );
    addTitleRow(`Année scolaire : ${roll.schoolYearLabel}`, false, 10);
    sheet.addRow([]);
    addTitleRow(
      'Matière : _____________________        Coef : ______        Chargé de la matière : _____________________',
      false,
      10,
    );
    addTitleRow(
      `Garçons : ${roll.boys}        Filles : ${roll.girls}        Total : ${roll.total}`,
      true,
      10,
    );
    sheet.addRow([]);

    const headerRow1 = sheet.addRow([...plan.soloHeaders, 'Notes à saisir']);
    const headerRow2 = sheet.addRow([
      ...Array<string>(soloCount).fill(''),
      ...plan.groupSubHeaders,
    ]);
    for (let col = 1; col <= soloCount; col += 1) {
      sheet.mergeCells(headerRow1.number, col, headerRow2.number, col);
    }
    sheet.mergeCells(headerRow1.number, soloCount + 1, headerRow1.number, COLS);
    for (const row of [headerRow1, headerRow2]) {
      for (let col = 1; col <= COLS; col += 1) {
        const cell = row.getCell(col);
        cell.font = { bold: true, size: 9 };
        cell.alignment = centered;
        cell.border = thinBorder;
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE8E8E8' },
        };
      }
    }

    roll.students.forEach((student, index) => {
      // Only the 4 real values are given - the remaining note columns stay
      // genuinely empty (not ''), while still getting a bordered box below
      // via row.getCell(), which creates the cell on access either way.
      const row = sheet.addRow([
        index + 1,
        `${student.lastname} ${student.firstname}`.trim(),
        student.matricule,
        student.gender,
      ]);
      for (let col = 1; col <= COLS; col += 1) {
        const cell = row.getCell(col);
        cell.border = thinBorder;
        if (col === 1 || col === 4) cell.alignment = { horizontal: 'center' };
      }
    });

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  // Same blank grade sheet again, as a .docx - a real Word file (not a PDF
  // renamed) so the school can still edit it (e.g. widen a column, add a
  // logo) before printing.
  async renderGradeSheetDocx(
    roll: NominalRoll,
    options: GradeSheetOptions = {},
  ): Promise<Buffer> {
    const plan = this.buildGradeSheetColumns(
      options.noteCount ?? 2,
      options.devoirCount ?? 1,
      options.interroCount ?? 2,
    );
    const soloCount = plan.soloHeaders.length;
    const TABLE_WIDTH = 10000;
    // pt -> DXA at the same ~19.417 ratio the original fixed widths (515pt
    // -> 10 000 DXA) were scaled at - see renderGradeSheetExcel() above for
    // the same columns in the .xlsx version.
    const toDxa = (pt: number) => Math.round((pt * TABLE_WIDTH) / 515);
    const columnWidths = [...plan.soloWidthsPt, ...plan.groupSubWidthsPt].map(
      toDxa,
    );

    const headerCell = (
      text: string,
      opts: { columnSpan?: number; rowSpan?: number; width?: number } = {},
    ) =>
      new TableCell({
        columnSpan: opts.columnSpan,
        rowSpan: opts.rowSpan,
        width: { size: opts.width ?? 0, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        shading: { type: ShadingType.CLEAR, fill: 'E8E8E8' },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text, bold: true, size: 16 })],
          }),
        ],
      });

    const dataCell = (text: string, width: number, center = false) =>
      new TableCell({
        width: { size: width, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
            children: [new TextRun({ text, size: 18 })],
          }),
        ],
      });

    const headerRow1 = new TableRow({
      children: [
        ...plan.soloHeaders.map((label, i) =>
          headerCell(label, { rowSpan: 2, width: columnWidths[i] }),
        ),
        headerCell('Notes à saisir', {
          columnSpan: plan.groupSubHeaders.length,
          width: columnWidths.slice(soloCount).reduce((a, b) => a + b, 0),
        }),
      ],
    });
    const headerRow2 = new TableRow({
      children: plan.groupSubHeaders.map((label, i) =>
        headerCell(label, { width: columnWidths[soloCount + i] }),
      ),
    });

    const dataRows = roll.students.map(
      (student, index) =>
        new TableRow({
          children: [
            dataCell(String(index + 1), columnWidths[0], true),
            dataCell(
              `${student.lastname} ${student.firstname}`.trim(),
              columnWidths[1],
            ),
            dataCell(student.matricule, columnWidths[2]),
            dataCell(student.gender, columnWidths[3], true),
            ...Array.from({ length: columnWidths.length - 4 }, (_, i) =>
              dataCell('', columnWidths[4 + i]),
            ),
          ],
        }),
    );

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              size: { width: 11906, height: 16838 }, // A4
              margin: { top: 900, bottom: 900, left: 900, right: 900 },
            },
          },
          // A long roster spans several pages once printed - number them
          // (Word computes CURRENT/TOTAL_PAGES itself, so this stays correct
          // whatever the school's own printer/margins do to the page count).
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({ text: 'Page ', size: 16 }),
                    new TextRun({ children: [PageNumber.CURRENT], size: 16 }),
                    new TextRun({ text: ' / ', size: 16 }),
                    new TextRun({
                      children: [PageNumber.TOTAL_PAGES],
                      size: 16,
                    }),
                  ],
                }),
              ],
            }),
          },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 120 },
              children: [
                new TextRun({
                  text: roll.schoolName.toUpperCase(),
                  bold: true,
                  size: 28,
                }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 100 },
              children: [
                new TextRun({
                  text: `Fiche de notes du ______ Trimestre/Semestre de la classe de ${roll.levelName}`,
                  bold: true,
                  size: 24,
                }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 280 },
              children: [
                new TextRun({
                  text: `Année scolaire : ${roll.schoolYearLabel}`,
                  size: 20,
                }),
              ],
            }),
            new Paragraph({
              spacing: { after: 240 },
              children: [
                new TextRun({
                  text: 'Matière : _____________________        Coef : ______        Chargé de la matière : _____________________',
                  size: 20,
                }),
              ],
            }),
            new Paragraph({
              spacing: { after: 280 },
              children: [
                new TextRun({
                  text: `Garçons : ${roll.boys}        Filles : ${roll.girls}        Total : ${roll.total}`,
                  bold: true,
                  size: 20,
                }),
              ],
            }),
            new Table({
              width: { size: TABLE_WIDTH, type: WidthType.DXA },
              columnWidths,
              rows: [headerRow1, headerRow2, ...dataRows],
            }),
          ],
        },
      ],
    });

    return Packer.toBuffer(doc);
  }

  // Draws one 8.5cm x 5.5cm (standard CR80 landscape) student ID card with
  // its top-left corner at (x, y) on doc's current page - three bands
  // (header / identity / footer), each separated by a thin accent rule:
  // header carries the Togo flags sized to fill their corner, identity
  // carries the photo and personal fields, footer gives the school's
  // address/contact and the principal's signature block their own
  // dedicated width instead of squeezing them into the identity column.
  // Never embeds an actual photo/logo when the student/ecole has none,
  // matching the "draw nothing rather than a placeholder" rule used
  // throughout this feature.
  private drawIdCard(
    doc: PdfDocumentInstance,
    data: StudentIdCardData,
    x: number,
    y: number,
  ): void {
    const CARD_W = 241;
    const CARD_H = 156;
    const PAD = 5;
    const ACCENT = '#1a3d8f';
    const LOGO_SIZE = 10;
    const LOGO_ROW_H = LOGO_SIZE + 1;

    // The ecole can pick its own header color (Ecole.couleurCarte) in place
    // of the default pale blue - since that choice could be dark, header
    // text switches to whichever of black/white actually reads on top of
    // it (relative luminance), rather than assuming black always works.
    // The default color's own text stays black/blue exactly as before, so
    // no ecole's card changes unless it opts in.
    const HEADER_BG = data.headerColor || '#eef2fb';
    const hasCustomHeaderColor = Boolean(data.headerColor);
    const headerTextColor = hasCustomHeaderColor
      ? getReadableTextColor(HEADER_BG)
      : '#000000';
    const schoolNameColor = hasCustomHeaderColor ? headerTextColor : ACCENT;

    doc.rect(x, y, CARD_W, CARD_H).stroke('#000000');

    // Ecole logo watermark, centered behind everything else - drawn very
    // faint (10% opacity) so the fields on top stay fully legible. Skipped
    // entirely when the ecole has no logo, same rule as everywhere else.
    if (data.schoolLogoPath) {
      try {
        const WATERMARK_SIZE = Math.min(CARD_W, CARD_H) - 16;
        doc.save();
        doc.opacity(0.1);
        doc.image(
          data.schoolLogoPath,
          x + CARD_W / 2 - WATERMARK_SIZE / 2,
          y + CARD_H / 2 - WATERMARK_SIZE / 2,
          {
            fit: [WATERMARK_SIZE, WATERMARK_SIZE],
            align: 'center',
            valign: 'center',
          },
        );
        doc.restore();
      } catch {
        // Missing/unreadable asset - card still renders without the watermark.
      }
    }

    // --- Header band: tinted background, Togo flags filling both corners,
    // ministry, ecole logo, school name (blue), document title. Every line
    // below sits at a fixed offset from y (heights here don't depend on
    // data content), so the total is a constant - computed once so the
    // background can be painted before the text without a throwaway pass.
    const REPUBLIQUE_Y = 4;
    const MINISTERE_Y = REPUBLIQUE_Y + 8;
    const LOGO_Y = MINISTERE_Y + 6;
    const SCHOOL_NAME_Y = LOGO_Y + LOGO_ROW_H;
    const TITLE_Y = SCHOOL_NAME_Y + 8;
    const HEADER_H = TITLE_Y + 8;
    const hy = y + HEADER_H;

    doc.rect(x, y, CARD_W, HEADER_H).fill(HEADER_BG);
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor(headerTextColor)
      .text('REPUBLIQUE TOGOLAISE', x, y + REPUBLIQUE_Y, {
        width: CARD_W,
        align: 'center',
      });
    doc
      .font('Helvetica-Bold')
      .fontSize(5.6)
      .text(data.ministereTutelle.toUpperCase(), x, y + MINISTERE_Y, {
        width: CARD_W,
        align: 'center',
      });

    // Ecole logo (uploaded via the ecole record) - space is always
    // reserved so the header height stays consistent across a batch,
    // but nothing is drawn when the ecole has no logo.
    if (data.schoolLogoPath) {
      try {
        doc.image(
          data.schoolLogoPath,
          x + CARD_W / 2 - LOGO_SIZE / 2,
          y + LOGO_Y,
          { fit: [LOGO_SIZE, LOGO_SIZE], align: 'center', valign: 'center' },
        );
      } catch {
        // Missing/unreadable asset - rest of the header still renders.
      }
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(7.2)
      .fillColor(schoolNameColor)
      .text(data.schoolName.toUpperCase(), x + PAD, y + SCHOOL_NAME_Y, {
        width: CARD_W - PAD * 2,
        align: 'center',
      });
    doc.fillColor(headerTextColor);
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .text("Carte d'identite scolaire", x, y + TITLE_Y, {
        width: CARD_W,
        align: 'center',
      });

    // Togo flags, sized to fill their corner of the header band rather
    // than sitting as a thin sliver next to the title line - anchored
    // against the height of the top two text lines (true flag aspect
    // ratio, 568x352px) so they read as a deliberate corner emblem
    // without crowding the centered text between them.
    const flagPath = resolveStaticAssetPath('cards', 'togo-flag.png');
    if (flagPath) {
      try {
        const flagH = MINISTERE_Y + 5;
        const flagW = flagH * (568 / 352);
        const flagY = y + 3;
        doc.image(flagPath, x + 3, flagY, {
          fit: [flagW, flagH],
          align: 'center',
          valign: 'center',
        });
        doc.image(flagPath, x + CARD_W - 3 - flagW, flagY, {
          fit: [flagW, flagH],
          align: 'center',
          valign: 'center',
        });
      } catch {
        // Missing/unreadable asset - header text still centers fine alone.
      }
    }

    doc
      .lineWidth(1)
      .moveTo(x, hy)
      .lineTo(x + CARD_W, hy)
      .stroke(ACCENT);
    doc.lineWidth(1);
    // The header may have left fillColor on white (a dark custom header
    // background uses white text) - reset explicitly so the rest of the
    // card (always on a plain white background) never inherits that.
    doc.fillColor('#000000');
    const bodyTop = hy + 4;

    // --- Identity band: photo box (left), personal fields (right) ---
    const PHOTO_W = 76;
    const PHOTO_H = 70;
    const photoX = x + PAD;
    doc.rect(photoX, bodyTop, PHOTO_W, PHOTO_H).stroke('#000000');
    if (data.photoPath) {
      try {
        doc.image(data.photoPath, photoX + 1, bodyTop + 1, {
          fit: [PHOTO_W - 2, PHOTO_H - 2],
          align: 'center',
          valign: 'center',
        });
      } catch {
        // Corrupt/unreadable file on disk - leave the box empty rather
        // than fail the whole card.
      }
    } else {
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor('#999999')
        .text('Photo', photoX, bodyTop + PHOTO_H / 2 - 4, {
          width: PHOTO_W,
          align: 'center',
        })
        .fillColor('#000000');
    }

    const colX = photoX + PHOTO_W + 7;
    const colW = x + CARD_W - PAD - colX;
    let ty = bodyTop + 1;
    const line = (text: string, bold = false) => {
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(6.5)
        .text(text, colX, ty, { width: colW });
      ty += doc.heightOfString(text, { width: colW }) + 2;
    };
    line(`Nom : ${data.lastname}`.toUpperCase(), true);
    line(`Prenoms : ${data.firstname}`, true);
    line(`Ne(e) le : ${data.birthDateAndPlaceLabel}`, true);
    line(`Sexe : ${data.genderLabel}`);
    line(`Classe : ${data.levelLabel}`, true);

    const bodyBottom = bodyTop + PHOTO_H;
    doc
      .lineWidth(1)
      .moveTo(x, bodyBottom + 3)
      .lineTo(x + CARD_W, bodyBottom + 3)
      .stroke(ACCENT);
    doc.lineWidth(1);

    // --- Footer band: address/contact (left) and the principal's
    // signature block (right) each get their own dedicated column,
    // instead of being crammed into the identity column above. ---
    const footerTop = bodyBottom + 7;
    const footerLeftW = (CARD_W - PAD * 2) * 0.44;
    const footerRightX = x + PAD + footerLeftW + 6;
    const footerRightW = CARD_W - PAD - footerRightX + x;

    doc
      .lineWidth(0.5)
      .moveTo(x + PAD + footerLeftW + 2, footerTop)
      .lineTo(x + PAD + footerLeftW + 2, y + CARD_H - 4)
      .stroke('#c7cede');
    doc.lineWidth(1);

    let fyLeft = footerTop;
    doc
      .font('Helvetica-Bold')
      .fontSize(5.4)
      .fillColor(ACCENT)
      .text('ADRESSE', x + PAD, fyLeft, { width: footerLeftW });
    doc.fillColor('#000000');
    fyLeft += 5;
    doc
      .font('Helvetica')
      .fontSize(6)
      .text(data.localite, x + PAD, fyLeft, { width: footerLeftW });
    fyLeft += 8;
    doc
      .font('Helvetica-Bold')
      .fontSize(5.4)
      .fillColor(ACCENT)
      .text('CONTACT', x + PAD, fyLeft, { width: footerLeftW });
    doc.fillColor('#000000');
    fyLeft += 5;
    doc
      .font('Helvetica')
      .fontSize(6)
      .text(data.contact, x + PAD, fyLeft, { width: footerLeftW });

    let fyRight = footerTop;
    doc
      .font('Helvetica')
      .fontSize(5.4)
      .text(
        `Fait a ${data.localite}, le ${data.issueDateLabel}`,
        footerRightX,
        fyRight,
        {
          width: footerRightW,
          align: 'right',
        },
      );
    fyRight += 7;
    doc
      .font('Helvetica-Bold')
      .fontSize(6.2)
      .text(data.chefEtablissementNom, footerRightX, fyRight, {
        width: footerRightW,
        align: 'right',
      });
    fyRight += 8;
    doc
      .lineWidth(0.5)
      .moveTo(footerRightX + footerRightW * 0.25, fyRight)
      .lineTo(footerRightX + footerRightW, fyRight)
      .stroke('#000000');
    doc.lineWidth(1);
    fyRight += 2;
    doc
      .font('Helvetica-Oblique')
      .fontSize(5.4)
      .text('Le Proviseur', footerRightX, fyRight, {
        width: footerRightW,
        align: 'right',
      });
  }

  // Lays out up to 10 cards per A4 page (2 columns x 5 rows), separated by
  // dashed cut-guide lines - the standard "print sheet, then cut" layout
  // for CR80-sized cards, matching the client's explicit request. Used by
  // both the single-student route (2 copies, for a print-and-cut pair) and
  // the class/batch routes (one entry per selected student, paginated).
  private renderIdCardsGrid(
    doc: PdfDocumentInstance,
    dataList: StudentIdCardData[],
  ): void {
    const CARD_W = 241;
    const CARD_H = 156;
    const COLS = 2;
    const ROWS = 5;
    const PER_PAGE = COLS * ROWS;
    const COL_GAP = 20;
    const ROW_GAP = 3;
    const gridW = COLS * CARD_W + (COLS - 1) * COL_GAP;
    const gridH = ROWS * CARD_H + (ROWS - 1) * ROW_GAP;
    const startX = (doc.page.width - gridW) / 2;
    const startY = (doc.page.height - gridH) / 2;

    const drawSeparators = () => {
      doc.dash(2, { space: 2 });
      for (let col = 1; col < COLS; col += 1) {
        const lineX = startX + col * CARD_W + (col - 0.5) * COL_GAP;
        doc
          .moveTo(lineX, startY - 6)
          .lineTo(lineX, startY + gridH + 6)
          .stroke('#666666');
      }
      for (let row = 1; row < ROWS; row += 1) {
        const lineY = startY + row * CARD_H + (row - 0.5) * ROW_GAP;
        doc
          .moveTo(startX - 6, lineY)
          .lineTo(startX + gridW + 6, lineY)
          .stroke('#666666');
      }
      doc.undash();
    };

    dataList.forEach((data, index) => {
      const pageIndex = Math.floor(index / PER_PAGE);
      const slotIndex = index % PER_PAGE;
      if (slotIndex === 0) {
        if (pageIndex > 0) {
          doc.addPage();
        }
        drawSeparators();
      }
      const col = slotIndex % COLS;
      const row = Math.floor(slotIndex / COLS);
      const cardX = startX + col * (CARD_W + COL_GAP);
      const cardY = startY + row * (CARD_H + ROW_GAP);
      this.drawIdCard(doc, data, cardX, cardY);
    });
  }

  async renderStudentIdCardPdf(data: StudentIdCardData): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 20, size: 'A4' });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    return await new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      // Two copies of the same card, for a print-and-cut pair.
      this.renderIdCardsGrid(doc, [data, data]);
      doc.end();
    });
  }

  // One 10-card grid page per 10 students - see renderIdCardsGrid.
  async renderClassIdCardsPdf(dataList: StudentIdCardData[]): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 20, size: 'A4' });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    return await new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      this.renderIdCardsGrid(doc, dataList);
      if (dataList.length === 0) {
        doc
          .font('Helvetica')
          .fontSize(12)
          .text('Aucun eleve dans cette classe.');
      }
      doc.end();
    });
  }
}
