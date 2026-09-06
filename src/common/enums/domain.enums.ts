export enum Role {
  PLATFORM_ADMIN = 'platform_admin',
  SUPER_ADMIN = 'super_admin',
  DIRECTION = 'direction',
  SECRETARIAT = 'secretariat',
  COMPTABILITE = 'comptabilite',
  AUDITEUR = 'auditeur',
}

export enum EcoleAccountStatus {
  ESSAI = 'essai',
  ACTIF = 'actif',
  SUSPENDU = 'suspendu',
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
  BULLETIN_SESSION_VALIDATED = 'bulletin_session_validated',
  MODULE_ACTIVATED = 'module_activated',
  MODULE_DEACTIVATED = 'module_deactivated',
  LICENSE_RENEWED = 'license_renewed',
}

export enum SettingKey {
  PAYMENT_ALLOCATION_RULE = 'payment_allocation_rule',
  STUDENT_MATRICULE_RULE = 'student_matricule_rule',
  RECEIPT_MODE = 'receipt_mode',
  CHEF_ETABLISSEMENT_NOM = 'chef_etablissement_nom',
}

export enum ReceiptMode {
  TUITION_ONLY = 'tuition_only',
  TUITION_AND_REGISTRATION = 'tuition_and_registration',
}

export enum PaymentAllocationRule {
  ARREARS_FIRST = 'arrears_first',
  CURRENT_FEES_FIRST = 'current_fees_first',
}

export enum FacturationMode {
  FORFAIT = 'forfait',
  USAGE_ELEVE = 'usage_eleve',
  USAGE_BULLETIN = 'usage_bulletin',
}

export enum FacturationSousType {
  TRIMESTRIEL = 'trimestriel',
  ANNUEL = 'annuel',
  ILLIMITE = 'illimite',
}

export enum TypeEvenementConsommation {
  BULLETIN = 'bulletin',
  USAGE_ELEVE = 'usage_eleve',
}

export enum FactureStatut {
  BROUILLON = 'brouillon',
  EMISE = 'emise',
  PAYEE = 'payee',
  EN_RETARD = 'en_retard',
}

export enum LevelCycle {
  COLLEGE = 1,
  LYCEE = 2,
}

export enum Periode {
  TRIMESTRE_1 = 'trimestre_1',
  TRIMESTRE_2 = 'trimestre_2',
  TRIMESTRE_3 = 'trimestre_3',
  SEMESTRE_1 = 'semestre_1',
  SEMESTRE_2 = 'semestre_2',
}

export enum SubjectCategory {
  LITTERAIRE = 'litteraire',
  SCIENTIFIQUE = 'scientifique',
  AUTRE = 'autre',
}

export enum BulletinSessionStatus {
  DRAFT = 'draft',
  IMPORTED = 'imported',
  PENDING_REVIEW = 'pending_review',
  READY = 'ready',
  VALIDATED = 'validated',
}

export enum ImportRowMatchStatus {
  MATCHED = 'matched',
  SUGGESTED = 'suggested',
  AMBIGUOUS = 'ambiguous',
  UNRESOLVED = 'unresolved',
}

export enum BulletinImportMode {
  PREMIER_IMPORT = 'premier_import',
  ECRASER = 'ecraser',
  FUSIONNER = 'fusionner',
}

// RECONCILE: match import rows against existing Student/Enrollment records
// (Bulletins Phase 1 default). AUTO_CREATE: for schools using this platform
// solely for bulletin generation, with no pre-existing students - each row
// creates its own Student+Enrollment instead (see
// BulletinsService.createStudentAndEnrollmentForRow). Chosen once at session
// creation, immutable after.
export enum BulletinStudentMatchingMode {
  RECONCILE = 'reconcile',
  AUTO_CREATE = 'auto_create',
}
