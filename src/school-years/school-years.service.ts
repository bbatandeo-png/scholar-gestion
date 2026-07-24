import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { CreateSchoolYearDto } from './dto/create-school-year.dto';
import { UpdateSchoolYearDto } from './dto/update-school-year.dto';
import { SchoolYear, SchoolYearDocument } from './schemas/school-year.schema';
import { SchoolYearStatus } from '../common/enums/domain.enums';
import { runWithMongoTransactionFallback } from '../common/utils/mongo-transaction.util';

@Injectable()
export class SchoolYearsService {
  constructor(
    @InjectModel(SchoolYear.name)
    private readonly schoolYearModel: Model<SchoolYearDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(dto: CreateSchoolYearDto) {
    const created = await this.schoolYearModel.create({
      ...dto,
      status:
        dto.status === SchoolYearStatus.OPEN
          ? SchoolYearStatus.DRAFT
          : dto.status,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
    });
    if (dto.status === SchoolYearStatus.OPEN) {
      return this.updateStatus(String(created._id), SchoolYearStatus.OPEN);
    }
    return created;
  }

  async list() {
    return this.schoolYearModel.find().sort({ startDate: -1 }).lean().exec();
  }

  async findOpen() {
    return this.schoolYearModel
      .findOne({ status: SchoolYearStatus.OPEN })
      .lean()
      .exec();
  }

  async requireOpen() {
    const year = await this.findOpen();
    if (!year) {
      throw new BadRequestException('Aucune annee scolaire ouverte');
    }
    return year;
  }

  async resolveSelected(selectedSchoolYearId?: string) {
    if (selectedSchoolYearId) {
      const selected = await this.findById(selectedSchoolYearId);
      if (selected) {
        return selected;
      }
    }
    return this.requireOpen();
  }

  async assertWritable(schoolYearId: string) {
    const open = await this.requireOpen();
    if (String(open._id) !== String(schoolYearId)) {
      throw new BadRequestException(
        'Une annee historique est disponible en lecture seule',
      );
    }
    return open;
  }

  async findById(id: string) {
    return this.schoolYearModel.findById(id).lean().exec();
  }

  async updateStatus(id: string, status: string) {
    if (status === SchoolYearStatus.OPEN) {
      return runWithMongoTransactionFallback(
        this.connection,
        async (session) => {
          const target = await this.schoolYearModel
            .findById(id)
            .session(session ?? null)
            .exec();
          if (!target) {
            throw new NotFoundException('Annee scolaire introuvable');
          }
          const currentOpen = await this.schoolYearModel
            .findOne({
              status: SchoolYearStatus.OPEN,
              _id: { $ne: target._id },
            })
            .session(session ?? null)
            .exec();
          if (currentOpen) {
            throw new BadRequestException(
              `Cloturez d abord l annee ${currentOpen.label} avant d activer une autre annee`,
            );
          }
          target.status = SchoolYearStatus.OPEN;
          return target.save({ session });
        },
      );
    }

    const target = await this.schoolYearModel.findById(id).exec();
    if (!target) {
      throw new NotFoundException('Annee scolaire introuvable');
    }
    target.status = status as SchoolYearStatus;
    return target.save();
  }

  async update(id: string, dto: UpdateSchoolYearDto) {
    const updated = await this.schoolYearModel
      .findByIdAndUpdate(
        id,
        {
          ...dto,
          status: dto.status === SchoolYearStatus.OPEN ? undefined : dto.status,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        },
        { new: true, runValidators: true },
      )
      .exec();
    if (dto.status === SchoolYearStatus.OPEN) {
      return this.updateStatus(id, SchoolYearStatus.OPEN);
    }
    return updated;
  }
}
