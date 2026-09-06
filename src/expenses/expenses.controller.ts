import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Render,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { RequireModule } from '../common/decorators/require-module.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { ModuleGuard } from '../common/guards/module.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { setFlash } from '../common/utils/flash.util';
import { buildExcelBuffer } from '../common/utils/excel.util';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ExpensesService } from './expenses.service';
import { SchoolYearsService } from '../school-years/school-years.service';

@Controller('/expenses')
@UseGuards(AuthenticatedGuard, RolesGuard, ModuleGuard)
@RequireModule('FINANCE')
export class ExpensesController {
  constructor(
    private readonly expensesService: ExpensesService,
    private readonly schoolYearsService: SchoolYearsService,
  ) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE)
  @Render('expenses/index')
  async index(
    @Req() req: Request,
    @Query('query') query?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    const [expenses, categories] = await Promise.all([
      this.expensesService.list(String(year._id), query, categoryId),
      this.expensesService.listCategories(),
    ]);

    return {
      title: 'Dépenses',
      expenses,
      categories,
      query: query || '',
      categoryId: categoryId || '',
    };
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE)
  async create(
    @Body() dto: CreateExpenseDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const year = await this.schoolYearsService.requireOpen();
    const body = req.body || {};
    const payload = {
      expenseDate: dto.expenseDate ?? body.expenseDate,
      label: dto.label ?? body.label ?? body.libelle ?? body.Libellé,
      amount: dto.amount ?? body.amount,
      beneficiary: dto.beneficiary ?? body.beneficiary,
      categoryId: dto.categoryId ?? body.categoryId,
    } as any;

    try {
      await this.expensesService.create(String(year._id), payload);
      setFlash(req, 'success', 'Dépense enregistrée');
      return res.redirect('/expenses');
    } catch (err) {
      console.error(
        'Failed to create expense, body:',
        body,
        'dto:',
        dto,
        'error:',
        (err as any)?.message ?? err,
      );
      throw err;
    }
  }

  @Get('/categories')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE)
  @Render('expenses/categories')
  async categories() {
    return {
      title: 'Catégories de dépenses',
      categories: await this.expensesService.listCategories(),
    };
  }

  @Get('/categories/:id/json')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE)
  async categoryJson(@Param('id') id: string) {
    const cat = await this.expensesService.findCategoryById(id);
    return { id: cat._id, name: cat.name, description: cat.description };
  }

  @Post('/categories')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE)
  async createCategory(
    @Body() dto: CreateExpenseCategoryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.expensesService.createCategory(dto);
    setFlash(req, 'success', 'Catégorie enregistrée');
    return res.redirect('/expenses/categories');
  }

  @Post('/categories/:id')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE)
  async updateCategory(
    @Param('id') id: string,
    @Body() dto: CreateExpenseCategoryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.expensesService.updateCategory(id, dto);
    setFlash(req, 'success', 'Catégorie mise à jour');
    return res.redirect('/expenses/categories');
  }

  @Delete('/categories/:id')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE)
  async removeCategory(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.expensesService.deleteCategory(id);
    setFlash(req, 'success', 'Catégorie supprimée');
    return res.redirect('/expenses/categories');
  }

  @Get('/pdf')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE)
  async pdf(
    @Req() req: Request,
    @Res() res: Response,
    @Query('categoryId') categoryId?: string,
  ) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    const [expenses, categories] = await Promise.all([
      this.expensesService.list(String(year._id), '', categoryId),
      this.expensesService.listCategories(),
    ]);
    const category = categoryId
      ? categories.find((item: any) => String(item._id) === String(categoryId))
      : undefined;
    const pdf = await this.expensesService.renderPdf(
      expenses,
      category?.name,
      year.label,
    );
    const fileName = `depenses${category?.name ? `-${category.name.replace(/[^a-zA-Z0-9_-]/g, '_')}` : ''}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(pdf);
  }

  @Get('/export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE)
  async export(
    @Req() req: Request,
    @Res() res: Response,
    @Query('categoryId') categoryId?: string,
  ) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    const expenses = await this.expensesService.list(
      String(year._id),
      '',
      categoryId,
    );
    const buffer = buildExcelBuffer(
      'Depenses',
      expenses.map((item: any) => ({
        numero: item.orderNumber,
        date: new Date(item.expenseDate).toLocaleDateString('fr-FR'),
        libelle: item.label,
        montant: item.amount,
        beneficiaire: item.beneficiary,
        categorie: item.categoryId?.name ?? '',
      })),
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="depenses.xlsx"',
    );
    return res.send(buffer);
  }

  @Post('/:id')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE)
  async update(
    @Param('id') id: string,
    @Body() dto: CreateExpenseDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const year = await this.schoolYearsService.requireOpen();
    const body = req.body || {};
    const payload = {
      expenseDate: dto.expenseDate ?? body.expenseDate,
      label: dto.label ?? body.label ?? body.libelle ?? body.Libellé,
      amount: dto.amount ?? body.amount,
      beneficiary: dto.beneficiary ?? body.beneficiary,
      categoryId: dto.categoryId ?? body.categoryId,
    } as any;

    try {
      // require modification reason
      const reason = (
        body.modificationReason ??
        body.modification_reason ??
        body.reason ??
        ''
      ).trim();
      if (!reason) {
        throw new BadRequestException(
          'Le motif de modification est obligatoire',
        );
      }
      payload.modificationReason = reason;
      await this.expensesService.update(String(year._id), id, payload);
      setFlash(req, 'success', 'Dépense mise à jour');
      return res.redirect('/expenses');
    } catch (err) {
      console.error(
        'Failed to update expense, id:',
        id,
        'body:',
        body,
        'dto:',
        dto,
        'error:',
        (err as any)?.message ?? err,
      );
      throw err;
    }
  }

  @Get('/:id/edit')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE)
  @Render('expenses/index')
  async edit(
    @Param('id') id: string,
    @Req() req: Request,
    @Query('query') query?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    const [expenses, categories] = await Promise.all([
      this.expensesService.list(String(year._id), query, categoryId),
      this.expensesService.listCategories(),
    ]);
    const editExpense = await this.expensesService.findById(
      id,
      String(year._id),
    );

    return {
      title: 'Modifier dépense',
      expenses,
      categories,
      query: query || '',
      categoryId: categoryId || '',
      editExpense,
    };
  }

  @Get('/:id')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE)
  @Render('expenses/detail')
  async detail(@Param('id') id: string, @Req() req: Request) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    const expense = await this.expensesService.findById(id, String(year._id));
    return {
      title: 'Détail de la dépense',
      expense,
    };
  }

  @Delete('/:id')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE)
  async remove(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const year = await this.schoolYearsService.requireOpen();
    await this.expensesService.delete(
      String(year._id),
      id,
      String(req.body?.reason ?? 'Annulation demandee'),
    );
    setFlash(req, 'success', 'Dépense supprimée');
    return res.redirect('/expenses');
  }
}
