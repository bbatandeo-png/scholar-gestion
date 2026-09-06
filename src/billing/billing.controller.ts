import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Render,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { SchoolYearsService } from '../school-years/school-years.service';
import { LevelsService } from '../levels/levels.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequireModule } from '../common/decorators/require-module.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { ModuleGuard } from '../common/guards/module.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { pickRowValue, readExcelRows } from '../common/utils/excel.util';
import { setFlash } from '../common/utils/flash.util';
import { buildExcelBuffer } from '../common/utils/excel.util';
import { UpsertFeeScheduleDto } from './dto/upsert-fee-schedule.dto';
import { BillingService } from './billing.service';
import { SettingsService } from '../settings/settings.service';
import { ExpensesService } from '../expenses/expenses.service';
import { EcolesService } from '../ecoles/ecoles.service';

@Controller('/settings/fees')
@UseGuards(AuthenticatedGuard, RolesGuard, ModuleGuard)
@RequireModule('FINANCE')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly schoolYearsService: SchoolYearsService,
    private readonly levelsService: LevelsService,
    private readonly settingsService: SettingsService,
    private readonly expensesService: ExpensesService,
    private readonly ecolesService: EcolesService,
  ) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  @Render('settings/fees')
  async index(
    @Req() req: Request,
    @Query('editCategoryId') editCategoryId?: string,
  ) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    const schoolYearId = String(year._id);
    const [
      matriculeRule,
      schoolName,
      receiptMode,
      paymentAllocationRule,
      chefEtablissementNom,
    ] = await Promise.all([
      this.settingsService.getStudentMatriculeRule(),
      this.ecolesService.getCurrentSchoolName(),
      this.settingsService.getReceiptMode(schoolYearId),
      this.settingsService.getPaymentAllocationRule(schoolYearId),
      this.settingsService.getChefEtablissementNom(),
    ]);
    const categories = await this.expensesService.listCategories();
    const editCategory = editCategoryId
      ? await this.expensesService.findCategoryById(editCategoryId)
      : undefined;

    return {
      title: 'Frais par niveau',
      feeSchedules: await this.billingService.listFeeSchedules(schoolYearId),
      schoolYears: [year],
      levels: await this.levelsService.listForSchoolYear(schoolYearId),
      expenseCategories: categories,
      matriculeRule,
      schoolName,
      receiptMode,
      paymentAllocationRule,
      chefEtablissementNom,
      matriculePreview: `${matriculeRule.prefix}${matriculeRule.separator}${String(matriculeRule.startAt).padStart(matriculeRule.padding, '0')}`,
      editCategory,
    };
  }

  @Post('/expense-categories')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async createExpenseCategory(
    @Body() dto: { name: string; description?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.expensesService.createCategory(dto);
    setFlash(req, 'success', 'Catégorie enregistrée');
    return res.redirect('/settings/fees');
  }

  @Post('/expense-categories/:id')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async updateExpenseCategory(
    @Param('id') id: string,
    @Body() dto: { name: string; description?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.expensesService.updateCategory(id, dto);
    setFlash(req, 'success', 'Catégorie modifiée');
    return res.redirect('/settings/fees');
  }

  @Get('/export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async export(@Req() req: Request, @Res() res: Response) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    const feeSchedules = await this.billingService.listFeeSchedules(
      String(year._id),
    );
    const buffer = buildExcelBuffer(
      'Frais',
      feeSchedules.map((item: any) => ({
        annee: item.schoolYearId?.label ?? '',
        niveau: item.levelId?.label ?? '',
        frais_inscription: item.registrationFee,
        ecolage: item.tuitionFee,
      })),
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="frais.xlsx"');
    return res.send(buffer);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async upsert(
    @Body() dto: UpsertFeeScheduleDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const year = await this.schoolYearsService.requireOpen();
    await this.billingService.upsertFeeSchedule({
      ...dto,
      schoolYearId: String(year._id),
    });
    await this.levelsService.enableForSchoolYear(String(year._id), dto.levelId);
    setFlash(req, 'success', 'Frais enregistres');
    return res.redirect('/settings/fees');
  }

  @Post('/import')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  @UseInterceptors(FileInterceptor('file'))
  async importFees(
    @UploadedFile() file: any,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('Fichier Excel requis');
    }

    const openYear = await this.schoolYearsService.requireOpen();
    const [rows, levels] = await Promise.all([
      Promise.resolve(readExcelRows(file.buffer)),
      this.levelsService.listForSchoolYear(String(openYear._id)),
    ]);

    const levelByLabel = new Map(
      levels.map((item: any) => [String(item.label).toLowerCase(), item]),
    );

    let imported = 0;
    let skipped = 0;

    for (const row of rows) {
      const yearLabel = pickRowValue(row, [
        'annee',
        'school_year',
      ]).toLowerCase();
      const levelLabel = pickRowValue(row, ['niveau', 'level']).toLowerCase();
      const registrationFee = Number(
        pickRowValue(row, ['frais_inscription', 'registration_fee']),
      );
      const tuitionFee = Number(pickRowValue(row, ['ecolage', 'tuition_fee']));

      const year =
        yearLabel === String(openYear.label).toLowerCase()
          ? openYear
          : undefined;
      const level = levelByLabel.get(levelLabel);
      if (
        !year ||
        !level ||
        Number.isNaN(registrationFee) ||
        Number.isNaN(tuitionFee)
      ) {
        skipped += 1;
        continue;
      }

      await this.billingService.upsertFeeSchedule({
        schoolYearId: String(year._id),
        levelId: String(level._id),
        registrationFee,
        tuitionFee,
      });
      imported += 1;
    }

    setFlash(
      req,
      'success',
      `Import frais termine: ${imported} lignes importees, ${skipped} ignorees`,
    );
    return res.redirect('/settings/fees');
  }

  @Get('/:id/edit')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  @Render('settings/fees')
  async edit(@Param('id') id: string, @Req() req: Request) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    const schoolYearId = String(year._id);
    const [
      feeSchedules,
      schoolYears,
      levels,
      matriculeRule,
      schoolName,
      receiptMode,
      paymentAllocationRule,
      chefEtablissementNom,
      editFee,
    ] = await Promise.all([
      this.billingService.listFeeSchedules(schoolYearId),
      Promise.resolve([year]),
      this.levelsService.listForSchoolYear(schoolYearId),
      this.settingsService.getStudentMatriculeRule(),
      this.ecolesService.getCurrentSchoolName(),
      this.settingsService.getReceiptMode(schoolYearId),
      this.settingsService.getPaymentAllocationRule(schoolYearId),
      this.settingsService.getChefEtablissementNom(),
      this.billingService.findFeeScheduleById(id),
    ]);

    return {
      title: 'Modifier frais',
      feeSchedules,
      schoolYears,
      levels,
      editFee,
      matriculeRule,
      schoolName,
      receiptMode,
      paymentAllocationRule,
      chefEtablissementNom,
      matriculePreview: `${matriculeRule.prefix}${matriculeRule.separator}${String(matriculeRule.startAt).padStart(matriculeRule.padding, '0')}`,
    };
  }

  @Post('/:id')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async update(
    @Param('id') id: string,
    @Body() dto: UpsertFeeScheduleDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const year = await this.schoolYearsService.requireOpen();
    await this.billingService.updateFeeSchedule(id, {
      schoolYearId: String(year._id),
      registrationFee: dto.registrationFee,
      tuitionFee: dto.tuitionFee,
    });
    setFlash(req, 'success', 'Frais modifies');
    return res.redirect('/settings/fees');
  }
}
