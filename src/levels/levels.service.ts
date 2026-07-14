import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateLevelDto } from './dto/create-level.dto';
import { Level, LevelDocument } from './schemas/level.schema';

@Injectable()
export class LevelsService {
  constructor(@InjectModel(Level.name) private readonly levelModel: Model<LevelDocument>) {}

  async create(dto: CreateLevelDto) {
    return this.levelModel.create(dto);
  }

  async list() {
    return this.levelModel.find().sort({ sortOrder: 1 }).lean().exec();
  }

  async findById(id: string) {
    return this.levelModel.findById(id).lean().exec();
  }

  async update(id: string, dto: CreateLevelDto) {
    return this.levelModel.findByIdAndUpdate(id, dto, { new: true }).lean().exec();
  }

  async findNextLevel(levelId: string) {
    const level = await this.levelModel.findById(levelId).lean().exec();
    if (!level) {
      return null;
    }

    return this.levelModel.findOne({ sortOrder: level.sortOrder + 1 }).lean().exec();
  }
}
