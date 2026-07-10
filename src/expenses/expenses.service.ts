import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Expense, ExpenseDocument } from './schemas/expense.schema';
import { ExpenseCategory, ExpenseCategoryDocument } from './schemas/expense-category.schema';

@Injectable()
export class ExpensesService {
  constructor(
    @InjectModel(Expense.name) private readonly expenseModel: Model<ExpenseDocument>,
    @InjectModel(ExpenseCategory.name) private readonly categoryModel: Model<ExpenseCategoryDocument>,
  ) {}

  private generateOrderNumber() {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `${stamp}-${Math.floor(Math.random() * 9000 + 1000)}`;
  }

  async listCategories() {
    return this.categoryModel.find().sort({ name: 1 }).lean().exec();
  }

  async createCategory(dto: { name: string; description?: string }) {
    if (!dto.name?.trim()) {
      throw new BadRequestException('Le nom de la categorie est obligatoire');
    }

    return this.categoryModel.create({ name: dto.name.trim(), description: dto.description?.trim() });
  }

  async updateCategory(id: string, dto: { name: string; description?: string }) {
    const category = await this.categoryModel.findByIdAndUpdate(id, { name: dto.name.trim(), description: dto.description?.trim() }, { new: true }).exec();
    if (!category) {
      throw new NotFoundException('Categorie introuvable');
    }
    return category;
  }

  async deleteCategory(id: string) {
    const category = await this.categoryModel.findByIdAndDelete(id).exec();
    if (!category) {
      throw new NotFoundException('Categorie introuvable');
    }
    await this.expenseModel.deleteMany({ categoryId: id }).exec();
    return category;
  }

  async list(query?: string, categoryId?: string) {
    const criteria: Record<string, unknown> = {};
    if (query) {
      const regex = new RegExp(query.trim(), 'i');
      criteria.$or = [{ label: regex }, { beneficiary: regex }, { orderNumber: regex }];
    }
    if (categoryId) {
      criteria.categoryId = categoryId;
    }

    return this.expenseModel
      .find(criteria)
      .populate('categoryId')
      .sort({ expenseDate: -1, createdAt: -1 })
      .lean()
      .exec();
  }

  async create(dto: { expenseDate: string; label: string; amount: number; beneficiary: string; categoryId: string }) {
    if (!dto.label?.trim()) {
      throw new BadRequestException('Le libelle est obligatoire');
    }
    if (!dto.beneficiary?.trim()) {
      throw new BadRequestException('Le beneficiaire est obligatoire');
    }
    if (!dto.categoryId) {
      throw new BadRequestException('La categorie est obligatoire');
    }
    if (!dto.amount || Number(dto.amount) <= 0) {
      throw new BadRequestException('Le montant doit etre superieur a zero');
    }

    const category = await this.categoryModel.findById(dto.categoryId).lean().exec();
    if (!category) {
      throw new BadRequestException('Categorie inexistante');
    }

    return this.expenseModel.create({
      orderNumber: this.generateOrderNumber(),
      expenseDate: new Date(dto.expenseDate),
      label: dto.label.trim(),
      amount: Number(dto.amount),
      beneficiary: dto.beneficiary.trim(),
      categoryId: dto.categoryId,
    });
  }

  async findById(id: string) {
    const expense = await this.expenseModel.findById(id).populate('categoryId').lean().exec();
    if (!expense) {
      throw new NotFoundException('Depense introuvable');
    }
    return expense;
  }

  async findCategoryById(id: string) {
    const category = await this.categoryModel.findById(id).lean().exec();
    if (!category) {
      throw new NotFoundException('Categorie introuvable');
    }
    return category;
  }

  async update(id: string, dto: { expenseDate: string; label: string; amount: number; beneficiary: string; categoryId: string; modificationReason?: string }) {
    const updatePayload: any = {
      expenseDate: new Date(dto.expenseDate),
      label: dto.label.trim(),
      amount: Number(dto.amount),
      beneficiary: dto.beneficiary.trim(),
      categoryId: dto.categoryId,
    };

    if (dto.modificationReason) {
      updatePayload.lastModificationReason = dto.modificationReason.trim();
      updatePayload.modifiedAt = new Date();
    }

    const expense = await this.expenseModel.findByIdAndUpdate(id, updatePayload, { new: true }).exec();
    if (!expense) {
      throw new NotFoundException('Depense introuvable');
    }
    return expense;
  }

  async delete(id: string) {
    const expense = await this.expenseModel.findByIdAndDelete(id).exec();
    if (!expense) {
      throw new NotFoundException('Depense introuvable');
    }
    return expense;
  }

  async getTotals() {
    const [result] = await this.expenseModel.aggregate([
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    return { totalExpenses: result?.total ?? 0 };
  }
}
