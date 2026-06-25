import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { GuardianDocument, Guardian } from './schemas/guardian.schema';

@Injectable()
export class GuardiansService {
  constructor(
    @InjectModel(Guardian.name)
    private readonly guardianModel: Model<GuardianDocument>,
  ) {}

  async replaceForStudent(
    studentId: string,
    guardians: Array<{
      type: string;
      lastname: string;
      firstname: string;
      phone?: string;
      address?: string;
    }>,
    session?: ClientSession,
  ) {
    await this.guardianModel.deleteMany({ studentId }).session(session ?? null);
    if (!guardians.length) {
      return [];
    }

    return this.guardianModel.insertMany(
      guardians.map((guardian) => ({ ...guardian, studentId })),
      { session, ordered: true },
    );
  }

  async findByStudentId(studentId: string) {
    return this.guardianModel.find({ studentId }).sort({ type: 1 }).lean().exec();
  }
}