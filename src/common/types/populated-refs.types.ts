// Shapes for the "invoice/enrollment populated + lean() + snapshot merge"
// pattern repeated across payments.service.ts and reports.service.ts.
// Mongoose's own populate() typings don't follow multi-level populate
// chains, so callers assert their query result to one of these once, at
// the query boundary, instead of threading `any` through every downstream
// read. All nested fields are optional: an enrollment can carry a snapshot
// instead of (or merged over) a live ref, and older/partial records may be
// missing a link entirely.
export interface PopulatedStudentLean {
  _id?: unknown;
  matricule?: string;
  lastname?: string;
  firstname?: string;
  gender?: string;
}

export interface PopulatedLevelLean {
  _id?: unknown;
  label?: string;
}

export interface PopulatedSchoolYearLean {
  _id?: unknown;
  label?: string;
}

export interface PopulatedEnrollmentLean {
  _id?: unknown;
  studentId?: PopulatedStudentLean | null;
  schoolYearId?: PopulatedSchoolYearLean | null;
  levelId?: PopulatedLevelLean | null;
  studentSnapshot?: Record<string, unknown>;
  levelSnapshot?: Record<string, unknown>;
}

export interface PopulatedInvoiceLean {
  _id?: unknown;
  registrationFee?: number;
  tuitionFee?: number;
  discountAmount?: number;
  paidAmount?: number;
  balanceDue?: number;
  totalDue?: number;
  arrearsAmount?: number;
  schoolYearId?: string;
  status?: string;
  enrollmentId?: PopulatedEnrollmentLean | null;
}
