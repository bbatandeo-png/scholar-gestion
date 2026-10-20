import {
  ArrearStatus,
  BulletinImportMode,
  BulletinSessionStatus,
  BulletinStudentMatchingMode,
  DisciplineRecordType,
  EcoleAccountStatus,
  EnrollmentStatus,
  EnrollmentType,
  FinalDecision,
  GuardianType,
  ImportRowMatchStatus,
  InvoiceStatus,
  PaymentMethod,
  Periode,
  Role,
  SchoolYearStatus,
  StockCategory,
  StockMovementType,
  StudentStatus,
  SubjectCategory,
  TeacherContractStatus,
  TeacherContractType,
  TeacherStatus,
  TeacherTrackingType,
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
      description: "Première inscription de l'élève dans l'établissement.",
    },
    [EnrollmentType.RE_ENROLLMENT]: {
      label: 'Réinscription',
      description: "L'élève revient après une année sans inscription active.",
    },
    [EnrollmentType.PROMOTION]: {
      label: 'Promotion',
      description:
        "L'élève passe au niveau supérieur après validation de l'année précédente.",
    },
    [EnrollmentType.REPEAT]: {
      label: 'Redoublement',
      description: "L'élève reprend le même niveau l'année suivante.",
    },
  },
  enrollmentStatus: {
    [EnrollmentStatus.DRAFT]: {
      label: 'Brouillon',
      description: 'Inscription créée mais pas encore activée.',
    },
    [EnrollmentStatus.ACTIVE]: {
      label: 'Active',
      description: "L'élève est actuellement inscrit sur cette année/niveau.",
    },
    [EnrollmentStatus.CLOSED]: {
      label: 'Clôturée',
      description: "L'année scolaire de cette inscription a été clôturée.",
    },
    [EnrollmentStatus.ARCHIVED]: {
      label: 'Archivée',
      description: 'Inscription conservée à titre historique, non modifiable.',
    },
  },
  studentStatus: {
    [StudentStatus.ACTIVE]: {
      label: 'Actif',
      description: "L'élève est actuellement scolarisé dans l'établissement.",
    },
    [StudentStatus.ARCHIVED]: {
      label: 'Archivé',
      description: "Dossier conservé mais l'élève n'est plus scolarisé ici.",
    },
    [StudentStatus.TRANSFERRED]: {
      label: 'Transféré',
      description: "L'élève a quitté l'établissement pour un autre.",
    },
    [StudentStatus.LEFT]: {
      label: 'Parti',
      description: "L'élève a quitté l'établissement (abandon, départ, etc.).",
    },
  },
  schoolYearStatus: {
    [SchoolYearStatus.DRAFT]: {
      label: 'Brouillon',
      description: 'Année scolaire préparée mais pas encore ouverte.',
    },
    [SchoolYearStatus.OPEN]: {
      label: 'Ouverte',
      description:
        'Année scolaire en cours : inscriptions et paiements actifs.',
    },
    [SchoolYearStatus.CLOSED]: {
      label: 'Clôturée',
      description: 'Année terminée, plus aucune nouvelle opération.',
    },
    [SchoolYearStatus.ARCHIVED]: {
      label: 'Archivée',
      description: 'Année ancienne conservée en lecture seule.',
    },
  },
  invoiceStatus: {
    [InvoiceStatus.UNPAID]: {
      label: 'Impayée',
      description: 'Aucun paiement enregistré sur cette facture.',
    },
    [InvoiceStatus.PARTIAL]: {
      label: 'Partiellement payée',
      description: 'Un paiement partiel a été enregistré, un solde reste dû.',
    },
    [InvoiceStatus.PAID]: {
      label: 'Payée',
      description: 'La facture est intégralement soldée.',
    },
  },
  arrearStatus: {
    [ArrearStatus.OPEN]: {
      label: 'Ouvert',
      description: 'Impayé reporté, encore dû en totalité.',
    },
    [ArrearStatus.PARTIALLY_PAID]: {
      label: 'Partiellement payé',
      description: "Une partie de l'impayé a été réglée.",
    },
    [ArrearStatus.PAID]: {
      label: 'Soldé',
      description: "L'impayé a été intégralement réglé.",
    },
    [ArrearStatus.CANCELLED]: {
      label: 'Annulé',
      description: "L'impayé a été annulé (abandon de créance, etc.).",
    },
  },
  ecoleAccountStatus: {
    [EcoleAccountStatus.ESSAI]: {
      label: 'Essai',
      description: "Période d'essai gratuite, accès limité dans le temps.",
    },
    [EcoleAccountStatus.ACTIF]: {
      label: 'Actif',
      description: 'Abonnement actif, accès complet à la plateforme.',
    },
    [EcoleAccountStatus.SUSPENDU]: {
      label: 'Suspendu',
      description: 'Accès suspendu (impayé, décision administrative).',
    },
  },
  userStatus: {
    [UserStatus.ACTIVE]: {
      label: 'Actif',
      description: 'Le compte peut se connecter normalement.',
    },
    [UserStatus.DISABLED]: {
      label: 'Désactivé',
      description: 'Le compte ne peut plus se connecter.',
    },
  },
  bulletinSessionStatus: {
    [BulletinSessionStatus.DRAFT]: {
      label: 'Brouillon',
      description: "Session créée, aucun fichier importé pour l'instant.",
    },
    [BulletinSessionStatus.IMPORTED]: {
      label: 'Importée',
      description: 'Fichier importé, rapprochement pas encore vérifié.',
    },
    [BulletinSessionStatus.PENDING_REVIEW]: {
      label: 'À vérifier',
      description:
        'Des élèves ou matières restent à rapprocher/approuver avant validation.',
    },
    [BulletinSessionStatus.READY]: {
      label: 'Prête',
      description: 'Tout est rapproché et approuvé, prête à être validée.',
    },
    [BulletinSessionStatus.VALIDATED]: {
      label: 'Validée',
      description: 'Notes enregistrées définitivement pour cette période.',
    },
  },
  periode: {
    [Periode.TRIMESTRE_1]: {
      label: '1er trimestre',
      description: "Premier trimestre de l'année scolaire.",
    },
    [Periode.TRIMESTRE_2]: {
      label: '2e trimestre',
      description: "Deuxième trimestre de l'année scolaire.",
    },
    [Periode.TRIMESTRE_3]: {
      label: '3e trimestre',
      description: "Troisième trimestre de l'année scolaire.",
    },
    [Periode.SEMESTRE_1]: {
      label: '1er semestre',
      description: "Premier semestre de l'année scolaire.",
    },
    [Periode.SEMESTRE_2]: {
      label: '2e semestre',
      description: "Deuxième semestre de l'année scolaire.",
    },
  },
  importRowMatchStatus: {
    [ImportRowMatchStatus.MATCHED]: {
      label: 'Rapproché',
      description:
        'La ligne du fichier correspond à un élève identifié avec certitude.',
    },
    [ImportRowMatchStatus.SUGGESTED]: {
      label: 'Suggestion',
      description:
        'Des élèves proches ont été trouvés, à confirmer manuellement.',
    },
    [ImportRowMatchStatus.AMBIGUOUS]: {
      label: 'Ambigu',
      description:
        'Plusieurs élèves correspondent, un choix manuel est nécessaire.',
    },
    [ImportRowMatchStatus.UNRESOLVED]: {
      label: 'Non résolu',
      description: 'Aucun élève correspondant trouvé dans la classe.',
    },
  },
  bulletinImportMode: {
    [BulletinImportMode.PREMIER_IMPORT]: {
      label: 'Premier import',
      description:
        'Aucune donnée existante pour cette session : import initial.',
    },
    [BulletinImportMode.ECRASER]: {
      label: 'Écraser',
      description:
        'Remplace entièrement les notes déjà importées par le nouveau fichier.',
    },
    [BulletinImportMode.FUSIONNER]: {
      label: 'Fusionner',
      description:
        'Complète les notes existantes sans effacer ce qui est déjà rapproché.',
    },
  },
  bulletinStudentMatchingMode: {
    [BulletinStudentMatchingMode.RECONCILE]: {
      label: 'Rapprochement',
      description:
        'Chaque ligne du fichier est associée à un élève déjà inscrit.',
    },
    [BulletinStudentMatchingMode.AUTO_CREATE]: {
      label: 'Création automatique',
      description:
        'Chaque ligne du fichier crée un nouvel élève et une nouvelle inscription, sans rapprochement.',
    },
  },
  guardianType: {
    [GuardianType.FATHER]: { label: 'Père', description: '' },
    [GuardianType.MOTHER]: { label: 'Mère', description: '' },
    [GuardianType.TUTOR]: { label: 'Tuteur', description: '' },
  },
  paymentMethod: {
    [PaymentMethod.CASH]: { label: 'Espèces', description: '' },
    [PaymentMethod.MOBILE_MONEY]: { label: 'Mobile Money', description: '' },
    [PaymentMethod.BANK_TRANSFER]: {
      label: 'Virement bancaire',
      description: '',
    },
    [PaymentMethod.OTHER]: { label: 'Autre', description: '' },
  },
  subjectCategory: {
    [SubjectCategory.LITTERAIRE]: { label: 'Littéraire', description: '' },
    [SubjectCategory.SCIENTIFIQUE]: { label: 'Scientifique', description: '' },
    [SubjectCategory.AUTRE]: { label: 'Autre', description: '' },
  },
  // Decisions de fin d'annee (passage annuel). PENDING n'est jamais proposee :
  // c'est l'etat d'attente avant la validation.
  finalDecision: {
    [FinalDecision.PROMOTED]: {
      label: 'Admis',
      description: 'Passe dans la classe supérieure (niveau cible).',
    },
    [FinalDecision.REPEATED]: {
      label: 'Redouble',
      description: 'Reste dans la même classe l’année suivante.',
    },
    [FinalDecision.TRANSFERRED]: {
      label: 'Transféré',
      description: 'Part dans un autre établissement à sa demande.',
    },
    [FinalDecision.LEFT]: {
      label: 'Quitte l’école',
      description: 'Arrête sa scolarité dans l’école (abandon, déménagement…).',
    },
    [FinalDecision.ARCHIVED]: {
      label: 'Archivé',
      description: 'Dossier clôturé et conservé, sans réinscription.',
    },
  },
  disciplineRecordType: {
    [DisciplineRecordType.AVERTISSEMENT]: {
      label: 'Avertissement',
      description: "Rappel à l'ordre consigné au dossier, sans sanction.",
    },
    [DisciplineRecordType.SANCTION]: {
      label: 'Sanction',
      description: 'Mesure disciplinaire effective (retenue, exclusion, etc.).',
    },
    [DisciplineRecordType.CONVOCATION]: {
      label: 'Convocation',
      description: "Convocation de l'élève et/ou de ses responsables.",
    },
  },
  stockCategory: {
    [StockCategory.PEDAGOGIQUE]: {
      label: 'Pédagogique',
      description: 'Matériel utilisé en classe (fournitures, manuels, etc.).',
    },
    [StockCategory.ADMINISTRATIF]: {
      label: 'Administratif',
      description:
        "Matériel de bureau et de fonctionnement de l'établissement.",
    },
    [StockCategory.AUTRE]: { label: 'Autre', description: '' },
  },
  stockMovementType: {
    [StockMovementType.ENTREE]: {
      label: 'Entrée',
      description: 'Ajout au stock (achat, don, inventaire initial).',
    },
    [StockMovementType.SORTIE]: {
      label: 'Sortie',
      description: 'Retrait du stock (distribution, perte, casse).',
    },
  },
  teacherStatus: {
    [TeacherStatus.ACTIF]: {
      label: 'Actif',
      description:
        "L'enseignant est actuellement en poste dans l'établissement.",
    },
    [TeacherStatus.INACTIF]: {
      label: 'Inactif',
      description: 'Dossier conservé mais sans poste actif actuellement.',
    },
    [TeacherStatus.DEPART]: {
      label: 'Départ',
      description: "L'enseignant a quitté l'établissement.",
    },
  },
  teacherContractType: {
    [TeacherContractType.CDI]: { label: 'CDI', description: '' },
    [TeacherContractType.CDD]: { label: 'CDD', description: '' },
    [TeacherContractType.VACATAIRE]: { label: 'Vacataire', description: '' },
    [TeacherContractType.STAGE]: { label: 'Stage', description: '' },
  },
  teacherContractStatus: {
    [TeacherContractStatus.ACTIF]: {
      label: 'Actif',
      description: 'Contrat en cours.',
    },
    [TeacherContractStatus.EXPIRE]: {
      label: 'Expiré',
      description: 'La date de fin du contrat est dépassée.',
    },
    [TeacherContractStatus.RESILIE]: {
      label: 'Résilié',
      description: 'Contrat interrompu avant son terme prévu.',
    },
  },
  teacherTrackingType: {
    [TeacherTrackingType.ABSENCE]: { label: 'Absence', description: '' },
    [TeacherTrackingType.OBSERVATION]: {
      label: 'Observation',
      description: '',
    },
    [TeacherTrackingType.EVALUATION]: { label: 'Évaluation', description: '' },
  },
  role: {
    [Role.PLATFORM_ADMIN]: {
      label: 'Administrateur plateforme',
      description: 'Gère toutes les écoles clientes de la plateforme.',
    },
    [Role.SUPER_ADMIN]: {
      label: 'Super administrateur',
      description: "Contrôle total de l'application pour cette école.",
    },
    [Role.DIRECTION]: {
      label: 'Direction',
      description: 'Pilotage pédagogique et administratif.',
    },
    [Role.SECRETARIAT]: {
      label: 'Secrétariat',
      description: 'Gestion opérationnelle des dossiers scolaires.',
    },
    [Role.COMPTABILITE]: {
      label: 'Comptabilité',
      description: 'Gestion financière et suivi des règlements.',
    },
    [Role.AUDITEUR]: {
      label: 'Auditeur',
      description: 'Consultation et contrôle sans opérations sensibles.',
    },
  },
};
