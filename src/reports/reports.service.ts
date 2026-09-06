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
import { EcolesService } from '../ecoles/ecoles.service';
import { SchoolYearStatus } from '../common/enums/domain.enums';
import { Payment } from '../payments/schemas/payment.schema';
import { SettingsService } from '../settings/settings.service';
import { resolveUploadedImagePath } from '../common/utils/uploaded-image.util';
import { resolveStaticAssetPath } from '../common/utils/runtime-paths.util';
import { getReadableTextColor } from '../common/utils/color.util';

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
    private readonly ecolesService: EcolesService,
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
        enrolledAt: enrollment.createdAt,
      }))
      .filter((student: any) => student.lastname || student.firstname)
      .map((student: any) => ({
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
      levelName: (level as any).label,
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

    const enrollments = await this.enrollmentModel
      .find({ levelId, schoolYearId: schoolYear._id, status: 'active' })
      .populate({
        path: 'studentId',
        select: 'lastname firstname matricule',
      })
      .lean()
      .exec();

    const students = enrollments
      .slice()
      .sort(
        (a: any, b: any) =>
          new Date(b.createdAt ?? 0).getTime() -
          new Date(a.createdAt ?? 0).getTime(),
      )
      .map((enrollment: any) => ({
        _id: String(enrollment.studentId?._id ?? enrollment.studentId ?? ''),
        lastname: String(
          enrollment.studentSnapshot?.lastname ??
            enrollment.studentId?.lastname ??
            '',
        ),
        firstname: String(
          enrollment.studentSnapshot?.firstname ??
            enrollment.studentId?.firstname ??
            '',
        ),
        matricule: String(
          enrollment.studentSnapshot?.matricule ??
            enrollment.studentId?.matricule ??
            '',
        ),
      }))
      .filter((student) => student._id);

    return {
      levelName: (level as any).label as string,
      schoolYearId: String(schoolYear._id),
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
      ? await this.enrollmentModel
          .findOne({
            studentId,
            schoolYearId: schoolYear._id,
            status: 'active',
          })
          .populate({ path: 'levelId', select: 'label' })
          .lean()
          .exec()
      : null;
    const levelLabel =
      (enrollment as any)?.levelSnapshot?.label ??
      (enrollment as any)?.levelId?.label ??
      '-';

    const [ecole, chefEtablissementNom] = await Promise.all([
      this.ecolesService.getCurrentEcole(),
      this.settingsService.getChefEtablissementNom(),
    ]);

    const genderLabel =
      String((student as any).gender ?? '').toUpperCase() === 'F'
        ? 'Féminin'
        : 'Masculin';
    const birthDate = (student as any).birthDate
      ? new Date((student as any).birthDate)
      : null;
    const birthDateLabel =
      birthDate && !Number.isNaN(birthDate.getTime())
        ? `${String(birthDate.getDate()).padStart(2, '0')}/${String(birthDate.getMonth() + 1).padStart(2, '0')}/${birthDate.getFullYear()}`
        : '-';
    const birthPlace = (student as any).birthPlace
      ? ` à ${(student as any).birthPlace}`
      : '';

    const today = new Date();
    const issueDateLabel = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

    return {
      schoolName: (ecole as any)?.nom || (await this.getSchoolName()),
      schoolLogoPath: this.ecolesService.resolveLogoAbsolutePath(ecole),
      headerColor: (ecole as any)?.couleurCarte || null,
      ministereTutelle:
        (ecole as any)?.ministereTutelle ||
        "MINISTERE DE L'EDUCATION NATIONALE",
      localite: (ecole as any)?.localite || '-',
      contact: (ecole as any)?.contact || '-',
      chefEtablissementNom: chefEtablissementNom || '-',
      lastname: (student as any).lastname ?? '',
      firstname: (student as any).firstname ?? '',
      birthDateAndPlaceLabel: `${birthDateLabel}${birthPlace}`,
      genderLabel,
      levelLabel,
      issueDateLabel,
      photoPath: resolveUploadedImagePath((student as any).photo),
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
    const schoolName = await this.ecolesService.getCurrentSchoolName();
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
    const schoolName = await this.ecolesService.getCurrentSchoolName();
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
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

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
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

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
