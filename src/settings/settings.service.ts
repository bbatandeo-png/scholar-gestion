import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import {
  PaymentAllocationRule,
  ReceiptMode,
  SettingKey,
} from '../common/enums/domain.enums';
import { Setting, SettingDocument } from './schemas/setting.schema';

export type StudentMatriculeRule = {
  prefix: string;
  separator: string;
  padding: number;
  startAt: number;
};

const DEFAULT_STUDENT_MATRICULE_RULE: StudentMatriculeRule = {
  prefix: 'MAT',
  separator: '-',
  padding: 4,
  startAt: 1,
};

@Injectable()
export class SettingsService {
  constructor(
    @InjectModel(Setting.name)
    private readonly settingModel: Model<SettingDocument>,
  ) {}

  private parseStudentMatriculeRule(value?: string): StudentMatriculeRule {
    if (!value) {
      return DEFAULT_STUDENT_MATRICULE_RULE;
    }

    try {
      const parsed = JSON.parse(value) as Partial<StudentMatriculeRule>;
      return {
        prefix: parsed.prefix?.trim() || DEFAULT_STUDENT_MATRICULE_RULE.prefix,
        separator: parsed.separator ?? DEFAULT_STUDENT_MATRICULE_RULE.separator,
        padding: Number.isFinite(Number(parsed.padding))
          ? Math.max(1, Number(parsed.padding))
          : DEFAULT_STUDENT_MATRICULE_RULE.padding,
        startAt: Number.isFinite(Number(parsed.startAt))
          ? Math.max(1, Number(parsed.startAt))
          : DEFAULT_STUDENT_MATRICULE_RULE.startAt,
      };
    } catch {
      return DEFAULT_STUDENT_MATRICULE_RULE;
    }
  }

  async getPaymentAllocationRule(
    schoolYearId?: string,
  ): Promise<PaymentAllocationRule> {
    const setting = await this.settingModel
      .findOne({
        key: SettingKey.PAYMENT_ALLOCATION_RULE,
        schoolYearId: schoolYearId ?? null,
      })
      .lean()
      .exec();

    if (!setting && schoolYearId) {
      return this.getPaymentAllocationRule();
    }
    return (
      (setting?.value as PaymentAllocationRule | undefined) ??
      PaymentAllocationRule.ARREARS_FIRST
    );
  }

  async setPaymentAllocationRule(
    value: PaymentAllocationRule,
    schoolYearId?: string,
  ) {
    const criteria = {
      key: SettingKey.PAYMENT_ALLOCATION_RULE,
      schoolYearId: schoolYearId ?? null,
    };
    return this.settingModel.findOneAndUpdate(
      criteria,
      { ...criteria, value },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  async getStudentMatriculeRule() {
    const setting = await this.settingModel
      .findOne({ key: SettingKey.STUDENT_MATRICULE_RULE, schoolYearId: null })
      .lean()
      .exec();

    return this.parseStudentMatriculeRule(setting?.value);
  }

  // Le vrai prochain matricule (rapport A23) : apres le plus grand numero deja
  // attribue avec ce prefixe, jamais en dessous du numero de depart choisi -
  // meme calcul que la creation d'un eleve (StudentsService).
  async previewNextStudentMatricule() {
    const rule = await this.getStudentMatriculeRule();
    const basePrefix = `${rule.prefix}${rule.separator}`;
    const escaped = basePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escaped}(\\d+)$`, 'i');
    const studentModel = this.settingModel.db?.models?.Student as
      | Model<{ matricule: string }>
      | undefined;
    const existing = studentModel
      ? await studentModel
          .find({ matricule: pattern })
          .select('matricule')
          .lean()
          .exec()
      : [];
    let highest = 0;
    for (const student of existing) {
      const match = pattern.exec(String(student.matricule));
      if (match) highest = Math.max(highest, Number(match[1]));
    }
    const nextNumber = Math.max(rule.startAt, highest + 1);
    return {
      matricule: `${basePrefix}${String(nextNumber).padStart(rule.padding, '0')}`,
      highestUsed: highest,
    };
  }

  async setStudentMatriculeRule(value: StudentMatriculeRule) {
    const normalized = this.parseStudentMatriculeRule(JSON.stringify(value));
    const criteria = {
      key: SettingKey.STUDENT_MATRICULE_RULE,
      schoolYearId: null,
    };

    return this.settingModel.findOneAndUpdate(
      criteria,
      { ...criteria, value: JSON.stringify(normalized) },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  // Not year-scoped (unlike receipt mode/payment allocation) - who currently
  // heads the school is a slow-changing operational fact, not something
  // that resets each school year. Used on printed documents that need the
  // principal's name (student ID cards; bulletins currently still take this
  // per-session instead, see BulletinSession.meta.chefEtablissement).
  async getChefEtablissementNom(): Promise<string> {
    const setting = await this.settingModel
      .findOne({ key: SettingKey.CHEF_ETABLISSEMENT_NOM, schoolYearId: null })
      .lean()
      .exec();
    return setting?.value?.trim() ?? '';
  }

  async setChefEtablissementNom(value: string) {
    const criteria = {
      key: SettingKey.CHEF_ETABLISSEMENT_NOM,
      schoolYearId: null,
    };
    return this.settingModel.findOneAndUpdate(
      criteria,
      { ...criteria, value: value.trim() },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  async getReceiptMode(schoolYearId?: string): Promise<ReceiptMode> {
    const setting = await this.settingModel
      .findOne({
        key: SettingKey.RECEIPT_MODE,
        schoolYearId: schoolYearId ?? null,
      })
      .lean()
      .exec();

    if (!setting && schoolYearId) {
      return this.getReceiptMode();
    }
    return (
      (setting?.value as ReceiptMode | undefined) ?? ReceiptMode.TUITION_ONLY
    );
  }

  async setReceiptMode(value: ReceiptMode, schoolYearId?: string) {
    const criteria = {
      key: SettingKey.RECEIPT_MODE,
      schoolYearId: schoolYearId ?? null,
    };
    return this.settingModel.findOneAndUpdate(
      criteria,
      { ...criteria, value },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  // Not year-scoped - a school's policy on requiring payment at
  // registration time is an operational decision, not something tied to a
  // given school year. Seeded once from REGISTRATION_PAYMENT_REQUIRED at
  // this install's first boot (scripts/seed.ts) from the platform's own
  // per-ecole toggle (see Ecole.registrationPaymentRequired) - defaults to
  // false (optional) when never set, matching the field's historic
  // behaviour before this setting existed.
  async getRegistrationPaymentRequired(): Promise<boolean> {
    const setting = await this.settingModel
      .findOne({
        key: SettingKey.REGISTRATION_PAYMENT_REQUIRED,
        schoolYearId: null,
      })
      .lean()
      .exec();
    return setting?.value === 'true';
  }

  async setRegistrationPaymentRequired(value: boolean) {
    const criteria = {
      key: SettingKey.REGISTRATION_PAYMENT_REQUIRED,
      schoolYearId: null,
    };
    return this.settingModel.findOneAndUpdate(
      criteria,
      { ...criteria, value: value ? 'true' : 'false' },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  // Not year-scoped, same rationale as registrationPaymentRequired above -
  // but unlike that one, set by the school itself (see /settings/fees),
  // never by the platform. Off by default: bulk-importing a "deja paye"
  // amount per row bypasses the fee schedule entirely (see
  // EnrollmentsController.importPaidStudents), so a school must opt in
  // deliberately rather than have it silently available.
  async getImportPaidStudentsEnabled(): Promise<boolean> {
    const setting = await this.settingModel
      .findOne({
        key: SettingKey.IMPORT_PAID_STUDENTS_ENABLED,
        schoolYearId: null,
      })
      .lean()
      .exec();
    return setting?.value === 'true';
  }

  async setImportPaidStudentsEnabled(value: boolean) {
    const criteria = {
      key: SettingKey.IMPORT_PAID_STUDENTS_ENABLED,
      schoolYearId: null,
    };
    return this.settingModel.findOneAndUpdate(
      criteria,
      { ...criteria, value: value ? 'true' : 'false' },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  async copyAnnualSettings(
    sourceSchoolYearId: string,
    targetSchoolYearId: string,
    session?: ClientSession,
  ) {
    const annualKeys = [
      SettingKey.PAYMENT_ALLOCATION_RULE,
      SettingKey.RECEIPT_MODE,
    ];
    for (const key of annualKeys) {
      const source = await this.settingModel
        .findOne({ key, schoolYearId: sourceSchoolYearId })
        .session(session ?? null)
        .lean()
        .exec();
      const fallback =
        source ??
        (await this.settingModel
          .findOne({ key, schoolYearId: null })
          .session(session ?? null)
          .lean()
          .exec());
      if (fallback) {
        await this.settingModel.updateOne(
          { key, schoolYearId: targetSchoolYearId },
          {
            $setOnInsert: {
              key,
              schoolYearId: targetSchoolYearId,
              value: fallback.value,
            },
          },
          { upsert: true, session },
        );
      }
    }
  }
}
