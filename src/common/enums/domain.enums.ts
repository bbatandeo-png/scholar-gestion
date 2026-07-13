export enum Role {
  SUPER_ADMIN = 'super_admin',
  DIRECTION = 'direction',
  SECRETARIAT = 'secretariat',
  COMPTABILITE = 'comptabilite',
  AUDITEUR = 'auditeur',
}

export enum UserStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
}

export enum SchoolYearStatus {
  DRAFT = 'draft',
  OPEN = 'open',
  CLOSED = 'closed',
  ARCHIVED = 'archived',
}

export enum StudentStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
  TRANSFERRED = 'transferred',
  LEFT = 'left',
}

export enum GuardianType {
  FATHER = 'father',
  MOTHER = 'mother',
  TUTOR = 'tutor',
}

export enum EnrollmentType {
  INITIAL = 'initial',
  RE_ENROLLMENT = 're_enrollment',
  PROMOTION = 'promotion',
  REPEAT = 'repeat',
}

export enum EnrollmentStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  CLOSED = 'closed',
  ARCHIVED = 'archived',
}

export enum FinalDecision {
  PROMOTED = 'promoted',
  REPEATED = 'repeated',
  TRANSFERRED = 'transferred',
  LEFT = 'left',
  ARCHIVED = 'archived',
  PENDING = 'pending',
}

export enum InvoiceStatus {
  UNPAID = 'unpaid',
  PARTIAL = 'partial',
  PAID = 'paid',
}

export enum PaymentMethod {
  CASH = 'cash',
  MOBILE_MONEY = 'mobile_money',
  BANK_TRANSFER = 'bank_transfer',
  OTHER = 'other',
}

export enum ArrearStatus {
  OPEN = 'open',
  PARTIALLY_PAID = 'partially_paid',
  PAID = 'paid',
  CANCELLED = 'cancelled',
}

export enum AuditAction {
  LOGIN = 'login',
  STUDENT_CREATED = 'student_created',
  STUDENT_UPDATED = 'student_updated',
  ENROLLMENT_CREATED = 'enrollment_created',
  REENROLLMENT_CREATED = 'reenrollment_created',
  PAYMENT_CREATED = 'payment_created',
  DISCOUNT_APPLIED = 'discount_applied',
  YEAR_CLOSED = 'year_closed',
  PROMOTION_VALIDATED = 'promotion_validated',
  ARREAR_CARRIED_FORWARD = 'arrear_carried_forward',
}

export enum SettingKey {
  PAYMENT_ALLOCATION_RULE = 'payment_allocation_rule',
  STUDENT_MATRICULE_RULE = 'student_matricule_rule',
  SCHOOL_NAME = 'school_name',
  RECEIPT_MODE = 'receipt_mode',
}

export enum ReceiptMode {
  TUITION_ONLY = 'tuition_only',
  TUITION_AND_REGISTRATION = 'tuition_and_registration',
}

export enum PaymentAllocationRule {
  ARREARS_FIRST = 'arrears_first',
  CURRENT_FEES_FIRST = 'current_fees_first',
}