import {
  ArrearStatus,
  BulletinImportMode,
  BulletinSessionStatus,
  BulletinStudentMatchingMode,
  EcoleAccountStatus,
  EnrollmentStatus,
  EnrollmentType,
  GuardianType,
  ImportRowMatchStatus,
  InvoiceStatus,
  PaymentMethod,
  Role,
  SchoolYearStatus,
  StudentStatus,
  SubjectCategory,
  UserStatus,
} from '../enums/domain.enums';

export type EnumMetaEntry = { label: string; description: string };
export type EnumMetaGroup = Record<string, EnumMetaEntry>;

// Human-readable French label + short explanation for every enum value shown
// in a status badge or a raw <select> across the njk views. Exposed to all
// templates as the ENUM_META nunjucks global (see main.ts) so a single
// source of truth drives both badges (status-badge.njk) and the per-page
// legends (partials/legend.njk), instead of each view hardcoding its own
// English/raw enum tokens as visible text.
export const ENUM_META: Record<string, EnumMetaGroup> = {
  enrollmentType: {
    [EnrollmentType.INITIAL]: {
      label: 'Initiale',
      description: "Premiere inscription de l'eleve dans l'etablissement.",
    },
    [EnrollmentType.RE_ENROLLMENT]: {
      label: 'Reinscription',
      description: "L'eleve revient apres une annee sans inscription active.",
    },
    [EnrollmentType.PROMOTION]: {
      label: 'Promotion',
      description:
        "L'eleve passe au niveau superieur apres validation de l'annee precedente.",
    },
    [EnrollmentType.REPEAT]: {
      label: 'Redoublement',
      description: "L'eleve reprend le meme niveau l'annee suivante.",
    },
  },
  enrollmentStatus: {
    [EnrollmentStatus.DRAFT]: {
      label: 'Brouillon',
      description: 'Inscription creee mais pas encore activee.',
    },
    [EnrollmentStatus.ACTIVE]: {
      label: 'Active',
      description: "L'eleve est actuellement inscrit sur cette annee/niveau.",
    },
    [EnrollmentStatus.CLOSED]: {
      label: 'Cloturee',
      description: "L'annee scolaire de cette inscription a ete cloturee.",
    },
    [EnrollmentStatus.ARCHIVED]: {
      label: 'Archivee',
      description: 'Inscription conservee a titre historique, non modifiable.',
    },
  },
  studentStatus: {
    [StudentStatus.ACTIVE]: {
      label: 'Actif',
      description: "L'eleve est actuellement scolarise dans l'etablissement.",
    },
    [StudentStatus.ARCHIVED]: {
      label: 'Archive',
      description: "Dossier conserve mais l'eleve n'est plus scolarise ici.",
    },
    [StudentStatus.TRANSFERRED]: {
      label: 'Transfere',
      description: "L'eleve a quitte l'etablissement pour un autre.",
    },
    [StudentStatus.LEFT]: {
      label: 'Parti',
      description: "L'eleve a quitte l'etablissement (abandon, depart, etc.).",
    },
  },
  schoolYearStatus: {
    [SchoolYearStatus.DRAFT]: {
      label: 'Brouillon',
      description: 'Annee scolaire preparee mais pas encore ouverte.',
    },
    [SchoolYearStatus.OPEN]: {
      label: 'Ouverte',
      description:
        'Annee scolaire en cours : inscriptions et paiements actifs.',
    },
    [SchoolYearStatus.CLOSED]: {
      label: 'Cloturee',
      description: 'Annee terminee, plus aucune nouvelle operation.',
    },
    [SchoolYearStatus.ARCHIVED]: {
      label: 'Archivee',
      description: 'Annee ancienne conservee en lecture seule.',
    },
  },
  invoiceStatus: {
    [InvoiceStatus.UNPAID]: {
      label: 'Impayee',
      description: 'Aucun paiement enregistre sur cette facture.',
    },
    [InvoiceStatus.PARTIAL]: {
      label: 'Partiellement payee',
      description: 'Un paiement partiel a ete enregistre, un solde reste du.',
    },
    [InvoiceStatus.PAID]: {
      label: 'Payee',
      description: 'La facture est integralement soldee.',
    },
  },
  arrearStatus: {
    [ArrearStatus.OPEN]: {
      label: 'Ouvert',
      description: 'Impaye reporte, encore du en totalite.',
    },
    [ArrearStatus.PARTIALLY_PAID]: {
      label: 'Partiellement paye',
      description: "Une partie de l'impaye a ete reglee.",
    },
    [ArrearStatus.PAID]: {
      label: 'Solde',
      description: "L'impaye a ete integralement regle.",
    },
    [ArrearStatus.CANCELLED]: {
      label: 'Annule',
      description: "L'impaye a ete annule (abandon de creance, etc.).",
    },
  },
  ecoleAccountStatus: {
    [EcoleAccountStatus.ESSAI]: {
      label: 'Essai',
      description: "Periode d'essai gratuite, acces limite dans le temps.",
    },
    [EcoleAccountStatus.ACTIF]: {
      label: 'Actif',
      description: 'Abonnement actif, acces complet a la plateforme.',
    },
    [EcoleAccountStatus.SUSPENDU]: {
      label: 'Suspendu',
      description: 'Acces suspendu (impaye, decision administrative).',
    },
  },
  userStatus: {
    [UserStatus.ACTIVE]: {
      label: 'Actif',
      description: 'Le compte peut se connecter normalement.',
    },
    [UserStatus.DISABLED]: {
      label: 'Desactive',
      description: 'Le compte ne peut plus se connecter.',
    },
  },
  bulletinSessionStatus: {
    [BulletinSessionStatus.DRAFT]: {
      label: 'Brouillon',
      description: "Session creee, aucun fichier importe pour l'instant.",
    },
    [BulletinSessionStatus.IMPORTED]: {
      label: 'Importee',
      description: 'Fichier importe, rapprochement pas encore verifie.',
    },
    [BulletinSessionStatus.PENDING_REVIEW]: {
      label: 'A verifier',
      description:
        'Des eleves ou matieres restent a rapprocher/approuver avant validation.',
    },
    [BulletinSessionStatus.READY]: {
      label: 'Prete',
      description: 'Tout est rapproche et approuve, prete a etre validee.',
    },
    [BulletinSessionStatus.VALIDATED]: {
      label: 'Validee',
      description: 'Notes enregistrees definitivement pour cette periode.',
    },
  },
  importRowMatchStatus: {
    [ImportRowMatchStatus.MATCHED]: {
      label: 'Rapproche',
      description:
        'La ligne du fichier correspond a un eleve identifie avec certitude.',
    },
    [ImportRowMatchStatus.SUGGESTED]: {
      label: 'Suggestion',
      description:
        'Des eleves proches ont ete trouves, a confirmer manuellement.',
    },
    [ImportRowMatchStatus.AMBIGUOUS]: {
      label: 'Ambigu',
      description:
        'Plusieurs eleves correspondent, un choix manuel est necessaire.',
    },
    [ImportRowMatchStatus.UNRESOLVED]: {
      label: 'Non resolu',
      description: 'Aucun eleve correspondant trouve dans la classe.',
    },
  },
  bulletinImportMode: {
    [BulletinImportMode.PREMIER_IMPORT]: {
      label: 'Premier import',
      description:
        'Aucune donnee existante pour cette session : import initial.',
    },
    [BulletinImportMode.ECRASER]: {
      label: 'Ecraser',
      description:
        'Remplace entierement les notes deja importees par le nouveau fichier.',
    },
    [BulletinImportMode.FUSIONNER]: {
      label: 'Fusionner',
      description:
        'Complete les notes existantes sans effacer ce qui est deja rapproche.',
    },
  },
  bulletinStudentMatchingMode: {
    [BulletinStudentMatchingMode.RECONCILE]: {
      label: 'Rapprochement',
      description:
        'Chaque ligne du fichier est associee a un eleve deja inscrit.',
    },
    [BulletinStudentMatchingMode.AUTO_CREATE]: {
      label: 'Creation automatique',
      description:
        'Chaque ligne du fichier cree un nouvel eleve et une nouvelle inscription, sans rapprochement.',
    },
  },
  guardianType: {
    [GuardianType.FATHER]: { label: 'Pere', description: '' },
    [GuardianType.MOTHER]: { label: 'Mere', description: '' },
    [GuardianType.TUTOR]: { label: 'Tuteur', description: '' },
  },
  paymentMethod: {
    [PaymentMethod.CASH]: { label: 'Especes', description: '' },
    [PaymentMethod.MOBILE_MONEY]: { label: 'Mobile Money', description: '' },
    [PaymentMethod.BANK_TRANSFER]: {
      label: 'Virement bancaire',
      description: '',
    },
    [PaymentMethod.OTHER]: { label: 'Autre', description: '' },
  },
  subjectCategory: {
    [SubjectCategory.LITTERAIRE]: { label: 'Litteraire', description: '' },
    [SubjectCategory.SCIENTIFIQUE]: { label: 'Scientifique', description: '' },
    [SubjectCategory.AUTRE]: { label: 'Autre', description: '' },
  },
  role: {
    [Role.PLATFORM_ADMIN]: {
      label: 'Administrateur plateforme',
      description: 'Gere toutes les ecoles clientes de la plateforme.',
    },
    [Role.SUPER_ADMIN]: {
      label: 'Super administrateur',
      description: "Controle total de l'application pour cette ecole.",
    },
    [Role.DIRECTION]: {
      label: 'Direction',
      description: 'Pilotage pedagogique et administratif.',
    },
    [Role.SECRETARIAT]: {
      label: 'Secretariat',
      description: 'Gestion operationnelle des dossiers scolaires.',
    },
    [Role.COMPTABILITE]: {
      label: 'Comptabilite',
      description: 'Gestion financiere et suivi des reglements.',
    },
    [Role.AUDITEUR]: {
      label: 'Auditeur',
      description: 'Consultation et controle sans operations sensibles.',
    },
  },
};
