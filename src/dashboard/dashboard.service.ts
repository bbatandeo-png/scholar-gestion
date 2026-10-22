import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Arrear } from '../arrears/schemas/arrear.schema';
import { AuditService } from '../audit/audit.service';
import { Invoice } from '../billing/schemas/invoice.schema';
import { AuditAction } from '../common/enums/domain.enums';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { Level } from '../levels/schemas/level.schema';
import { Student } from '../students/schemas/student.schema';
import { Expense } from '../expenses/schemas/expense.schema';
import { Payment } from '../payments/schemas/payment.schema';
import { ArrearCarryForward } from '../arrears/schemas/arrear-carry-forward.schema';
import { SchoolYear } from '../school-years/schemas/school-year.schema';
import { computeLedgerDivergences } from '../billing/ledger.util';

// 3-letter, accent-free (matches the rest of the app's compact table/column
// headers) month abbreviations for the "Encaissements" chart's X axis.
const MONTH_LABELS = [
  'JAN',
  'FEV',
  'MAR',
  'AVR',
  'MAI',
  'JUN',
  'JUL',
  'AOU',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

export type DashboardFilters = {
  levelId?: string;
  // Restricts "activity in a period" figures (recettes, dépenses,
  // modifications de paiement) to money that actually moved within
  // [dateFrom, dateTo] - "état actuel" figures (effectifs, impayés, solde
  // dû) stay as of now regardless, since they aren't meaningfully tied to
  // a single date range. See getSummary()'s comments below.
  dateFrom?: Date;
  dateTo?: Date;
};

type DashboardInvoiceAmounts = {
  paidAmount?: number;
  balanceDue?: number;
  registrationFee?: number;
  tuitionFee?: number;
  discountAmount?: number;
};

type DashboardExpenseAmount = {
  amount?: number;
};

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Enrollment.name)
    private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Invoice.name) private readonly invoiceModel: Model<Invoice>,
    @InjectModel(Arrear.name) private readonly arrearModel: Model<Arrear>,
    @InjectModel(Expense.name) private readonly expenseModel: Model<Expense>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(ArrearCarryForward.name)
    private readonly carryForwardModel: Model<ArrearCarryForward>,
    @InjectModel(Level.name) private readonly levelModel: Model<Level>,
    @InjectModel(SchoolYear.name)
    private readonly schoolYearModel: Model<SchoolYear>,
    private readonly auditService: AuditService,
  ) {}

  calculateFinancialSummary(
    invoices: DashboardInvoiceAmounts[],
    expenses: DashboardExpenseAmount[],
  ) {
    const revenue = invoices.reduce(
      (sum, invoice) => sum + Math.max(Number(invoice.paidAmount ?? 0), 0),
      0,
    );
    const totalBalance = invoices.reduce(
      (sum, invoice) => sum + Math.max(Number(invoice.balanceDue ?? 0), 0),
      0,
    );
    const totalExpenses = expenses.reduce(
      (sum, expense) => sum + Math.max(Number(expense.amount ?? 0), 0),
      0,
    );
    const registrationRevenue = invoices.reduce(
      (sum, invoice) =>
        sum +
        Math.min(
          Math.max(Number(invoice.paidAmount ?? 0), 0),
          Math.max(Number(invoice.registrationFee ?? 0), 0),
        ),
      0,
    );
    const tuitionExpected = invoices.reduce((sum, invoice) => {
      const tuitionFee = Math.max(Number(invoice.tuitionFee ?? 0), 0);
      const discountAmount = Math.max(Number(invoice.discountAmount ?? 0), 0);
      return sum + Math.max(tuitionFee - discountAmount, 0);
    }, 0);
    const tuitionRevenue = invoices.reduce((sum, invoice) => {
      const paidAmount = Math.max(Number(invoice.paidAmount ?? 0), 0);
      const registrationFee = Math.max(Number(invoice.registrationFee ?? 0), 0);
      const tuitionFee = Math.max(Number(invoice.tuitionFee ?? 0), 0);
      const discountAmount = Math.max(Number(invoice.discountAmount ?? 0), 0);
      const netTuitionFee = Math.max(tuitionFee - discountAmount, 0);
      return (
        sum + Math.min(Math.max(paidAmount - registrationFee, 0), netTuitionFee)
      );
    }, 0);

    return {
      revenue,
      registrationRevenue,
      tuitionRevenue,
      tuitionExpected,
      totalBalance,
      totalExpenses,
      availableBalance: tuitionRevenue - totalExpenses,
      recoveryRate:
        tuitionExpected === 0
          ? 0
          : Math.round((tuitionRevenue / tuitionExpected) * 100),
    };
  }

  async getSummary(schoolYearId: string, filters: DashboardFilters = {}) {
    const levelId = filters.levelId;
    const enrollmentFilter: Record<string, unknown> = { schoolYearId };
    if (levelId) {
      enrollmentFilter.levelId = levelId;
    }

    const carriedArrearIds = await this.carryForwardModel
      .find({ targetSchoolYearId: schoolYearId })
      .distinct('arrearId')
      .exec();
    // Resolved up front (rather than inside the Promise.all below) since
    // invoices/payments/arrears/audit-log all need to be scoped down to this
    // same level's students/invoices when a level filter is active.
    const [studentIds, enrollmentIds] = await Promise.all([
      this.enrollmentModel.distinct('studentId', enrollmentFilter).exec(),
      levelId
        ? this.enrollmentModel.distinct('_id', enrollmentFilter).exec()
        : Promise.resolve(null as string[] | null),
    ]);

    const [activeStudents, archivedStudents, invoices, expenses] =
      await Promise.all([
        this.enrollmentModel.countDocuments({
          ...enrollmentFilter,
          status: 'active',
        }),
        // Promotion decisions (archived/transferred/left) are recorded on the
        // SOURCE enrollment, in the year the student left from - not on any
        // enrollment in the currently selected year, so filtering enrollments
        // by {schoolYearId, finalDecision} here could never match anything.
        // Student.status is the durable, non-year-scoped signal for this
        // (set correctly by PromotionsService.validate()) - matches the
        // "Eleves archives" label exactly, unlike transferred/left. Not
        // scoped by levelId either: a student's declared class can differ
        // from the enrolled one, so this stays a global figure regardless
        // of the filter, same as it already was regardless of school year.
        this.studentModel.countDocuments({ status: 'archived' }),
        this.invoiceModel
          .find({
            schoolYearId,
            ...(enrollmentIds ? { enrollmentId: { $in: enrollmentIds } } : {}),
          })
          .lean()
          .exec(),
        // Une depense n'est rattachee a aucune classe : avec un filtre par
        // classe, elle n'est pas imputee a cette classe (rapport A12).
        levelId
          ? Promise.resolve(
              [] as Array<{ amount?: number; expenseDate?: Date }>,
            )
          : this.expenseModel
              .find({ schoolYearId, isCancelled: { $ne: true } })
              .lean()
              .exec(),
      ]);

    const invoiceIds = invoices.map((invoice) => String(invoice._id));
    const { dateFrom, dateTo } = filters;
    const [
      arrearsOpen,
      paymentsAll,
      paymentCorrectionsCount,
      studentsByLevelRaw,
      duplicateNameGroups,
    ] = await Promise.all([
      this.arrearModel.countDocuments({
        $or: [
          { sourceSchoolYearId: schoolYearId },
          { _id: { $in: carriedArrearIds } },
        ],
        status: { $in: ['open', 'partially_paid'] },
        ...(levelId ? { studentId: { $in: studentIds } } : {}),
      }),
      // Level-scoped only, deliberately never date-scoped: reconciling an
      // invoice's paidAmount needs every payment ever recorded against it,
      // regardless of when - see ledgerDivergences below.
      this.paymentModel
        .find({
          schoolYearId,
          ...(enrollmentIds ? { invoiceId: { $in: invoiceIds } } : {}),
        })
        .lean()
        .exec(),
      // Its own indicator (see the "Historique des modifications de
      // paiement" page) - the count of PAYMENT_CORRECTED audit entries,
      // written only when a payment is actually modified, never for a
      // fresh payment or a plain discount edit (see
      // EnrollmentsService.updateFinancialDetails). Date-scoped: a
      // correction is activity within a period, same as a payment.
      this.auditService.countByAction([AuditAction.PAYMENT_CORRECTED], {
        schoolYearId,
        ...(enrollmentIds ? { entityIds: enrollmentIds.map(String) } : {}),
        dateFrom,
        dateTo,
      }),
      // For the "Effectifs par classe" chart - always by the truly
      // selected level (or every level when none is chosen), never
      // date-scoped (an enrollment isn't a dated event). aggregate()
      // pipelines aren't schema-cast the way find()/distinct() are, so
      // schoolYearId/levelId need casting to ObjectId by hand here -
      // otherwise $match compares a string against a stored ObjectId and
      // silently matches nothing (the ecoleScopePlugin's own tenant
      // $match, prepended ahead of this one, does the same for ecoleId).
      this.enrollmentModel.aggregate([
        {
          $match: {
            schoolYearId: new Types.ObjectId(schoolYearId),
            ...(levelId ? { levelId: new Types.ObjectId(levelId) } : {}),
            status: 'active',
          },
        },
        { $group: { _id: '$levelId', count: { $sum: 1 } } },
      ]),
      // Jamais level/date-scope : un doublon de nom est un etat global de
      // l'ecole, pas une activite d'une periode donnee - voir
      // StudentsService.findDuplicateGroups pour le detail affiche sur
      // /students/duplicates, lie depuis la carte ci-dessous.
      this.studentModel.aggregate<{ count: number }>([
        {
          $group: {
            _id: {
              lastname: { $toLower: '$lastname' },
              firstname: { $toLower: '$firstname' },
            },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $count: 'count' },
      ]),
    ]);

    // Money that actually moved within [dateFrom, dateTo] - falls back to
    // every payment on these invoices when no date filter is set. Kept
    // separate from paymentsAll (used above for reconciliation) so a date
    // filter narrows "recettes" without ever making the ledger-divergence
    // check see a partial, misleading slice of the payment history.
    const paidAtInRange = (paidAt: unknown) => {
      if (!dateFrom && !dateTo) return true;
      const time = paidAt instanceof Date ? paidAt.getTime() : NaN;
      if (Number.isNaN(time)) return true;
      if (dateFrom && time < dateFrom.getTime()) return false;
      if (dateTo && time > dateTo.getTime()) return false;
      return true;
    };
    const payments = paymentsAll.filter((payment) =>
      paidAtInRange(payment.paidAt),
    );

    const levelById = new Map(
      (await this.levelModel.find().lean().exec()).map((level) => [
        String(level._id),
        level,
      ]),
    );
    const studentsByLevel = studentsByLevelRaw
      .map((row: { _id: unknown; count: number }) => ({
        label: levelById.get(String(row._id))?.label ?? '—',
        sortOrder: levelById.get(String(row._id))?.sortOrder ?? 999,
        count: row.count,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const totalStudents = studentIds.length;
    const revenue = payments.reduce(
      (sum, payment) => sum + (payment.amount ?? 0),
      0,
    );
    const totalDue = invoices.reduce(
      (sum, invoice) => sum + (invoice.totalDue ?? 0),
      0,
    );
    const totalBalance = invoices.reduce(
      (sum, invoice) => sum + (invoice.balanceDue ?? 0),
      0,
    );
    // Date-scoped like payments above, so "Dépenses" and "Solde disponible"
    // reflect the same period as "recettes" when a date filter is applied.
    const expensesInRange = expenses.filter((expense) =>
      paidAtInRange(expense.expenseDate),
    );
    const totalExpenses = expensesInRange.reduce(
      (sum, expense) => sum + (expense.amount ?? 0),
      0,
    );
    const currentPaidByInvoice = new Map<string, number>();
    for (const payment of payments) {
      const currentAmount = (payment.allocation ?? [])
        .filter((item) => item.type === 'current_fees')
        .reduce((sum: number, item) => sum + Number(item.amount ?? 0), 0);
      const key = String(payment.invoiceId);
      currentPaidByInvoice.set(
        key,
        (currentPaidByInvoice.get(key) ?? 0) + currentAmount,
      );
    }
    // Clamped to 0: never negative in practice (see billing.service.ts's
    // recordPaymentCorrection for the one case that used to make it so), but
    // this is money shown on a dashboard - worth defending even against a
    // data issue this code didn't anticipate rather than displaying it.
    const registrationRevenue = invoices.reduce((sum, invoice) => {
      const currentPaid = Math.max(
        currentPaidByInvoice.get(String(invoice._id)) ?? 0,
        0,
      );
      return sum + Math.min(currentPaid, invoice.registrationFee ?? 0);
    }, 0);
    const tuitionRevenue = invoices.reduce((sum, invoice) => {
      const paidAmount = Math.max(
        currentPaidByInvoice.get(String(invoice._id)) ?? 0,
        0,
      );
      const registrationFee = invoice.registrationFee ?? 0;
      // Capped at the tuition actually owed (after any discount), the same
      // cap the printed lists and receipts use - otherwise a discounted
      // student is counted for more here than on the lists.
      const netTuitionFee = Math.max(
        (invoice.tuitionFee ?? 0) - (invoice.discountAmount ?? 0),
        0,
      );
      return (
        sum + Math.max(Math.min(paidAmount - registrationFee, netTuitionFee), 0)
      );
    }, 0);
    const ledgerDivergences = computeLedgerDivergences(invoices, paymentsAll);
    const availableBalance = tuitionRevenue - totalExpenses;
    const recoveryRate =
      totalDue === 0 ? 0 : Math.round((revenue / totalDue) * 100);

    return {
      totalStudents,
      revenue,
      registrationRevenue,
      tuitionRevenue,
      totalBalance,
      totalExpenses,
      availableBalance,
      recoveryRate,
      expensesByClass: !levelId,
      activeStudents,
      archivedStudents,
      arrearsOpen,
      enrollmentsActive: activeStudents,
      // Invoices whose paid amount disagrees with the payment ledger the
      // figures above are built from - see billing/ledger.util.ts.
      ledgerDivergence: {
        count: ledgerDivergences.length,
        total: ledgerDivergences.reduce((sum, row) => sum + row.difference, 0),
      },
      paymentCorrectionsCount,
      duplicateNameGroupsCount: duplicateNameGroups[0]?.count ?? 0,
      charts: {
        revenueByCategory: [
          { label: "Frais d'inscription", value: registrationRevenue },
          { label: 'Frais d’écolage', value: tuitionRevenue },
          ...(levelId ? [] : [{ label: 'Dépenses', value: totalExpenses }]),
        ],
        recoveryBreakdown: [
          { label: 'Encaissé', value: Math.max(revenue, 0) },
          { label: 'Reste à percevoir', value: Math.max(totalBalance, 0) },
        ],
        studentsByLevel,
      },
    };
  }

  // "Encaissements" dashboard chart: total payments collected per month,
  // the selected year against the previous one. Deliberately ignores the
  // level filter and the date-range filter that scope the rest of the
  // dashboard - this is a school-wide cash-flow trend, and letting either
  // filter narrow it would make the two years being compared stop lining
  // up month for month.
  async getMonthlyEncaissements(schoolYearId: string) {
    const currentYear = await this.schoolYearModel
      .findById(schoolYearId)
      .lean()
      .exec();
    if (!currentYear) {
      return { months: [], currentYearLabel: '', previousYearLabel: null };
    }

    // The year right before this one, by start date - not necessarily the
    // one immediately preceding it alphabetically/by label.
    const previousYear = await this.schoolYearModel
      .findOne({ startDate: { $lt: currentYear.startDate } })
      .sort({ startDate: -1 })
      .lean()
      .exec();

    // Months elapsed so far in the selected year: from its start up to
    // today (or its end, whichever is sooner) - a year just opened in
    // September shows only September, a fully closed past year shows its
    // whole span, capped to 12 to stay defensive against bad data.
    const start = new Date(currentYear.startDate);
    const cappedEnd =
      new Date() < new Date(currentYear.endDate)
        ? new Date()
        : new Date(currentYear.endDate);
    const elapsedMonths =
      (cappedEnd.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (cappedEnd.getUTCMonth() - start.getUTCMonth()) +
      1;
    const monthCount = Math.min(Math.max(elapsedMonths, 1), 12);

    const [currentPayments, previousPayments] = await Promise.all([
      this.paymentModel
        .find({ schoolYearId: String(currentYear._id), kind: 'payment' })
        .select('amount paidAt')
        .lean()
        .exec(),
      previousYear
        ? this.paymentModel
            .find({ schoolYearId: String(previousYear._id), kind: 'payment' })
            .select('amount paidAt')
            .lean()
            .exec()
        : Promise.resolve([]),
    ]);

    const sumForMonth = (
      payments: { amount?: number; paidAt?: Date }[],
      year: number,
      month: number,
    ) =>
      payments.reduce((sum, payment) => {
        const paidAt =
          payment.paidAt instanceof Date
            ? payment.paidAt
            : new Date(payment.paidAt ?? NaN);
        if (
          paidAt.getUTCFullYear() === year &&
          paidAt.getUTCMonth() === month
        ) {
          return sum + Number(payment.amount ?? 0);
        }
        return sum;
      }, 0);
    // Montants en FCFA : le graphique choisit lui-meme son unite (FCFA,
    // milliers ou millions). Les convertir ici en millions arrondis faisait
    // tomber a 0 tout mois sous 50 000 FCFA.
    const toAmount = (value: number) => Math.round(value);

    const months = Array.from({ length: monthCount }, (_, i) => {
      const current = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1),
      );
      // The previous year's "same academic month" is the same offset from
      // ITS OWN start, not the same calendar month - keeps the two bars for
      // a given position aligned even if the two years don't start on
      // exactly the same day.
      const previous = previousYear
        ? new Date(
            Date.UTC(
              new Date(previousYear.startDate).getUTCFullYear(),
              new Date(previousYear.startDate).getUTCMonth() + i,
              1,
            ),
          )
        : null;

      return {
        label: MONTH_LABELS[current.getUTCMonth()],
        currentYear: toAmount(
          sumForMonth(
            currentPayments,
            current.getUTCFullYear(),
            current.getUTCMonth(),
          ),
        ),
        previousYear: previous
          ? toAmount(
              sumForMonth(
                previousPayments,
                previous.getUTCFullYear(),
                previous.getUTCMonth(),
              ),
            )
          : 0,
      };
    });

    return {
      months,
      currentYearLabel: currentYear.label,
      previousYearLabel: previousYear?.label ?? null,
    };
  }
}
