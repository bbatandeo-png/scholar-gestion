import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { Role, UserStatus } from '../common/enums/domain.enums';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async findByEmail(email: string) {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async findById(id: string) {
    return this.userModel.findById(id).exec();
  }

  async list() {
    return this.userModel
      .find()
      .sort({ name: 1 })
      .select({ name: 1, email: 1, role: 1, status: 1, createdAt: 1 })
      .lean()
      .exec();
  }

  async listPaginated(payload: {
    q?: string;
    role?: Role;
    status?: UserStatus;
    page: number;
    pageSize: number;
  }) {
    const filter: Record<string, any> = {};
    const q = (payload.q ?? '').trim();

    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
      ];
    }

    if (payload.role) {
      filter.role = payload.role;
    }

    if (payload.status) {
      filter.status = payload.status;
    }

    const [items, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ name: 1 })
        .skip((payload.page - 1) * payload.pageSize)
        .limit(payload.pageSize)
        .select({ name: 1, email: 1, role: 1, status: 1, createdAt: 1 })
        .lean()
        .exec(),
      this.userModel.countDocuments(filter),
    ]);

    return { items, total };
  }

  async create(payload: {
    name: string;
    email: string;
    password: string;
    role: Role;
    status: UserStatus;
  }) {
    const passwordHash = await bcrypt.hash(payload.password, 10);
    return this.userModel.create({
      name: payload.name,
      email: payload.email.toLowerCase(),
      passwordHash,
      role: payload.role,
      status: payload.status,
    });
  }

  async updateAccess(userId: string, payload: { role: Role; status: UserStatus }) {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        {
          role: payload.role,
          status: payload.status,
        },
        { new: true, runValidators: true },
      )
      .exec();
  }

  async updatePassword(userId: string, password: string) {
    const passwordHash = await bcrypt.hash(password, 10);
    return this.userModel
      .findByIdAndUpdate(
        userId,
        { passwordHash },
        { new: true, runValidators: true },
      )
      .exec();
  }

  async ensureAdmin(payload: {
    name: string;
    email: string;
    passwordHash: string;
    role?: Role;
  }) {
    const existing = await this.findByEmail(payload.email);
    if (existing) {
      return existing;
    }

    return this.userModel.create({
      ...payload,
      role: payload.role ?? Role.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
    });
  }
}