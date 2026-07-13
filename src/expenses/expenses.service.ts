import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import PDFDocument from 'pdfkit';
import { Expense, ExpenseDocument } from './schemas/expense.schema';
import { ExpenseCategory, ExpenseCategoryDocument } from './schemas/expense-category.schema';
import { SettingsService } from '../settings/settings.service';
import { SchoolYear, SchoolYearDocument } from '../school-years/schemas/school-year.schema';
import { SchoolYearStatus } from '../common/enums/domain.enums';

type PdfDocumentInstance = InstanceType<typeof PDFDocument>;

@Injectable()
export class ExpensesService {
  constructor(
    @InjectModel(Expense.name) private readonly expenseModel: Model<ExpenseDocument>,
    @InjectModel(ExpenseCategory.name) private readonly categoryModel: Model<ExpenseCategoryDocument>,
    @InjectModel(SchoolYear.name) private readonly schoolYearModel: Model<SchoolYearDocument>,
    private readonly settingsService: SettingsService,
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

  private async findOpenSchoolYearLabel() {
    const schoolYear = await this.schoolYearModel.findOne({ status: SchoolYearStatus.OPEN }).lean().exec();
    if (!schoolYear) {
      return undefined;
    }

    return schoolYear.label ?? `${new Date(schoolYear.startDate).getFullYear()} – ${new Date(schoolYear.endDate).getFullYear()}`;
  }

  private renderPdfHeader(doc: PdfDocumentInstance, schoolName: string, schoolYearLabel?: string) {
    const trimmedName = schoolName.trim();
    const [firstWord, ...restWords] = trimmedName.split(' ');
    const secondLine = restWords.join(' ');

    if (firstWord) {
      doc.font('Times-Bold').fontSize(20).text(firstWord.toUpperCase(), { align: 'center' });
    }
    if (secondLine) {
      doc.font('Times-Bold').fontSize(20).text(secondLine.toUpperCase(), { align: 'center' });
    }

    if (schoolYearLabel) {
      doc.moveDown(0.2);
      doc.font('Times-Roman').fontSize(10).text(`Année scolaire : ${schoolYearLabel}`, { align: 'center' });
    }

    doc.moveDown(1);
  }

  async renderPdf(expenses: any[], categoryName?: string) {
    const schoolName = await this.settingsService.getSchoolName();
    const schoolYearLabel = await this.findOpenSchoolYearLabel();
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

    return await new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      this.renderPdfHeader(doc, schoolName, schoolYearLabel);
      doc.font('Times-Bold').fontSize(18).text('Dépenses', { align: 'center' });
      doc.moveDown(0.5);
      if (categoryName) {
        doc.font('Times-Roman').fontSize(10).text(`Catégorie : ${categoryName}`, { align: 'left' });
      }
      doc.font('Times-Roman').fontSize(10).text(`Date : ${new Date().toLocaleDateString('fr-FR')}`, { align: 'right' });
      doc.moveDown(1);

      const headers = ['N°', 'Date', 'Libellé', 'Montant', 'Bénéficiaire', 'Catégorie'];
      const columnWidths = [60, 60, 170, 70, 100, 55];
      const rowHeight = 20;
      const startX = doc.page.margins.left;
      const bottomLimit = doc.page.height - doc.page.margins.bottom;

      const drawHeader = () => {
        const y = doc.y;
        let x = startX;

        doc.font('Times-Bold').fontSize(10).fillColor('#000');
        headers.forEach((header, index) => {
          doc.rect(x, y, columnWidths[index], rowHeight).fillAndStroke('#F0F0F0', '#000000');
          doc.fillColor('#000').text(header, x + 4, y + 5, {
            width: columnWidths[index] - 8,
            align: index >= 3 ? 'right' : 'left',
          });
          x += columnWidths[index];
        });

        doc.y = y + rowHeight;
        doc.x = startX;
      };

      const drawRow = (values: any[]) => {
        const y = doc.y;
        let x = startX;

        values.forEach((value, index) => {
          doc.rect(x, y, columnWidths[index], rowHeight).stroke('#000000');
          doc.text(String(value), x + 4, y + 5, {
            width: columnWidths[index] - 8,
            align: index >= 3 ? 'right' : 'left',
            ellipsis: true,
          });
          x += columnWidths[index];
        });

        doc.y = y + rowHeight;
        doc.x = startX;
      };

      drawHeader();
      let totalAmount = 0;

      expenses.forEach((item: any) => {
        if (doc.y + rowHeight > bottomLimit) {
          doc.addPage();
          this.renderPdfHeader(doc, schoolName, schoolYearLabel);
          drawHeader();
        }

        const values = [
          item.orderNumber ?? '',
          new Date(item.expenseDate).toLocaleDateString('fr-FR'),
          item.label ?? '',
          (Number(item.amount) ?? 0).toFixed(2),
          item.beneficiary ?? '',
          item.categoryId?.name ?? '',
        ];

        drawRow(values);
        totalAmount += Number(item.amount ?? 0);
      });

      doc.moveDown(0.5);
      doc.font('Times-Bold').fontSize(10).text(`Total des dépenses : ${totalAmount.toFixed(2)} FCFA`, { align: 'right' });
      doc.end();
    });
  }

  async getTotals() {
    const [result] = await this.expenseModel.aggregate([
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    return { totalExpenses: result?.total ?? 0 };
  }
}
