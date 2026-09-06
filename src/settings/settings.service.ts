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

  async getPaymentAllocationRule(schoolYearId?: string) {
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

  async getReceiptMode(schoolYearId?: string) {
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
