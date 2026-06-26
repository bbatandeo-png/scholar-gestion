import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaymentAllocationRule, SettingKey } from '../common/enums/domain.enums';
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
    @InjectModel(Setting.name) private readonly settingModel: Model<SettingDocument>,
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

  async getPaymentAllocationRule() {
    const setting = await this.settingModel
      .findOne({ key: SettingKey.PAYMENT_ALLOCATION_RULE })
      .lean()
      .exec();

    return (setting?.value as PaymentAllocationRule | undefined) ?? PaymentAllocationRule.ARREARS_FIRST;
  }

  async setPaymentAllocationRule(value: PaymentAllocationRule) {
    return this.settingModel.findOneAndUpdate(
      { key: SettingKey.PAYMENT_ALLOCATION_RULE },
      { key: SettingKey.PAYMENT_ALLOCATION_RULE, value },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  async getStudentMatriculeRule() {
    const setting = await this.settingModel
      .findOne({ key: SettingKey.STUDENT_MATRICULE_RULE })
      .lean()
      .exec();

    return this.parseStudentMatriculeRule(setting?.value);
  }

  async setStudentMatriculeRule(value: StudentMatriculeRule) {
    const normalized = this.parseStudentMatriculeRule(JSON.stringify(value));

    return this.settingModel.findOneAndUpdate(
      { key: SettingKey.STUDENT_MATRICULE_RULE },
      { key: SettingKey.STUDENT_MATRICULE_RULE, value: JSON.stringify(normalized) },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  async getSchoolName() {
    const setting = await this.settingModel
      .findOne({ key: SettingKey.SCHOOL_NAME })
      .lean()
      .exec();

    return setting?.value ?? '';
  }

  async setSchoolName(value: string) {
    return this.settingModel.findOneAndUpdate(
      { key: SettingKey.SCHOOL_NAME },
      { key: SettingKey.SCHOOL_NAME, value: value.trim() },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
}