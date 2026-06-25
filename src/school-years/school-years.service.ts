import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateSchoolYearDto } from './dto/create-school-year.dto';
import { UpdateSchoolYearDto } from './dto/update-school-year.dto';
import { SchoolYear, SchoolYearDocument } from './schemas/school-year.schema';
import { SchoolYearStatus } from '../common/enums/domain.enums';

@Injectable()
export class SchoolYearsService {
  constructor(
    @InjectModel(SchoolYear.name)
    private readonly schoolYearModel: Model<SchoolYearDocument>,
  ) {}

  async create(dto: CreateSchoolYearDto) {
    if (dto.status === SchoolYearStatus.OPEN) {
      await this.schoolYearModel
        .updateMany({ status: SchoolYearStatus.OPEN }, { status: SchoolYearStatus.DRAFT })
        .exec();
    }

    return this.schoolYearModel.create({
      ...dto,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
    });
  }

  async list() {
    return this.schoolYearModel.find().sort({ startDate: -1 }).lean().exec();
  }

  async findOpen() {
    return this.schoolYearModel.findOne({ status: SchoolYearStatus.OPEN }).lean().exec();
  }

  async findById(id: string) {
    return this.schoolYearModel.findById(id).lean().exec();
  }

  async updateStatus(id: string, status: string) {
    if (status === SchoolYearStatus.OPEN) {
      await this.schoolYearModel
        .updateMany({ status: SchoolYearStatus.OPEN }, { status: SchoolYearStatus.DRAFT })
        .exec();
    }

    return this.schoolYearModel.findByIdAndUpdate(id, { status }, { new: true }).exec();
  }

  async update(id: string, dto: UpdateSchoolYearDto) {
    if (dto.status === SchoolYearStatus.OPEN) {
      await this.schoolYearModel
        .updateMany({ status: SchoolYearStatus.OPEN }, { status: SchoolYearStatus.DRAFT })
        .exec();
    }

    return this.schoolYearModel
      .findByIdAndUpdate(
        id,
        {
          ...dto,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        },
        { new: true, runValidators: true },
      )
      .exec();
  }
}