import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateLevelDto } from './dto/create-level.dto';
import { Level, LevelDocument } from './schemas/level.schema';
import {
  SchoolYearLevel,
  SchoolYearLevelDocument,
} from './schemas/school-year-level.schema';

@Injectable()
export class LevelsService {
  constructor(
    @InjectModel(Level.name) private readonly levelModel: Model<LevelDocument>,
    @InjectModel(SchoolYearLevel.name)
    private readonly schoolYearLevelModel: Model<SchoolYearLevelDocument>,
  ) {}

  async create(dto: CreateLevelDto) {
    return this.levelModel.create(dto);
  }

  async list() {
    return this.levelModel.find().sort({ sortOrder: 1 }).lean().exec();
  }

  async listForSchoolYear(schoolYearId: string) {
    const links = await this.schoolYearLevelModel
      .find({ schoolYearId, isEnabled: true })
      .populate('levelId')
      .lean()
      .exec();
    return links
      .map((item: any) => item.levelId)
      .filter(Boolean)
      .sort((a: any, b: any) => a.sortOrder - b.sortOrder);
  }

  async enableForSchoolYear(schoolYearId: string, levelId: string) {
    return this.schoolYearLevelModel.findOneAndUpdate(
      { schoolYearId, levelId },
      { schoolYearId, levelId, isEnabled: true },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  async copyYearConfiguration(
    sourceSchoolYearId: string,
    targetSchoolYearId: string,
    session?: any,
  ) {
    const sourceLinks = await this.schoolYearLevelModel
      .find({ schoolYearId: sourceSchoolYearId, isEnabled: true })
      .session(session ?? null)
      .lean()
      .exec();
    for (const link of sourceLinks) {
      await this.schoolYearLevelModel.updateOne(
        { schoolYearId: targetSchoolYearId, levelId: link.levelId },
        {
          $setOnInsert: {
            schoolYearId: targetSchoolYearId,
            levelId: link.levelId,
            isEnabled: true,
          },
        },
        { upsert: true, session },
      );
    }
  }

  async findById(id: string) {
    return this.levelModel.findById(id).lean().exec();
  }

  async update(id: string, dto: CreateLevelDto) {
    return this.levelModel
      .findByIdAndUpdate(id, dto, { new: true })
      .lean()
      .exec();
  }

  async findNextLevel(levelId: string) {
    const level = await this.levelModel.findById(levelId).lean().exec();
    if (!level) {
      return null;
    }

    return this.levelModel
      .findOne({ sortOrder: level.sortOrder + 1 })
      .lean()
      .exec();
  }
}
