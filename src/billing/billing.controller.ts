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
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { pickRowValue, readExcelRows } from '../common/utils/excel.util';
import { setFlash } from '../common/utils/flash.util';
import { buildExcelBuffer } from '../common/utils/excel.util';
import { UpsertFeeScheduleDto } from './dto/upsert-fee-schedule.dto';
import { BillingService } from './billing.service';
import { SettingsService } from '../settings/settings.service';
import { ExpensesService } from '../expenses/expenses.service';

@Controller('/settings/fees')
@UseGuards(AuthenticatedGuard, RolesGuard)
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly schoolYearsService: SchoolYearsService,
    private readonly levelsService: LevelsService,
    private readonly settingsService: SettingsService,
    private readonly expensesService: ExpensesService,
  ) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  @Render('settings/fees')
  async index(@Query('editCategoryId') editCategoryId?: string) {
    const [matriculeRule, schoolName] = await Promise.all([
      this.settingsService.getStudentMatriculeRule(),
      this.settingsService.getSchoolName(),
    ]);
    const categories = await this.expensesService.listCategories();
    const editCategory = editCategoryId ? await this.expensesService.findCategoryById(editCategoryId) : undefined;

    return {
      title: 'Frais par niveau',
      feeSchedules: await this.billingService.listFeeSchedules(),
      schoolYears: await this.schoolYearsService.list(),
      levels: await this.levelsService.list(),
      expenseCategories: categories,
      matriculeRule,
      schoolName,
      matriculePreview: `${matriculeRule.prefix}${matriculeRule.separator}${String(matriculeRule.startAt).padStart(matriculeRule.padding, '0')}`,
      editCategory,
    };
  }

  @Post('/expense-categories')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async createExpenseCategory(@Body() dto: { name: string; description?: string }, @Req() req: Request, @Res() res: Response) {
    await this.expensesService.createCategory(dto as any);
    setFlash(req, 'success', 'Catégorie enregistrée');
    return res.redirect('/settings/fees');
  }

  @Post('/expense-categories/:id')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async updateExpenseCategory(@Param('id') id: string, @Body() dto: { name: string; description?: string }, @Req() req: Request, @Res() res: Response) {
    await this.expensesService.updateCategory(id, dto as any);
    setFlash(req, 'success', 'Catégorie modifiée');
    return res.redirect('/settings/fees');
  }

  @Get('/export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async export(@Res() res: Response) {
    const feeSchedules = await this.billingService.listFeeSchedules();
    const buffer = buildExcelBuffer(
      'Frais',
      feeSchedules.map((item: any) => ({
        annee: item.schoolYearId?.label ?? '',
        niveau: item.levelId?.label ?? '',
        frais_inscription: item.registrationFee,
        ecolage: item.tuitionFee,
      })),
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="frais.xlsx"');
    return res.send(buffer);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async upsert(@Body() dto: UpsertFeeScheduleDto, @Req() req: Request, @Res() res: Response) {
    await this.billingService.upsertFeeSchedule(dto);
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

    const [rows, schoolYears, levels] = await Promise.all([
      Promise.resolve(readExcelRows(file.buffer)),
      this.schoolYearsService.list(),
      this.levelsService.list(),
    ]);

    const yearByLabel = new Map(schoolYears.map((item: any) => [String(item.label).toLowerCase(), item]));
    const levelByLabel = new Map(levels.map((item: any) => [String(item.label).toLowerCase(), item]));

    let imported = 0;
    let skipped = 0;

    for (const row of rows) {
      const yearLabel = pickRowValue(row, ['annee', 'school_year']).toLowerCase();
      const levelLabel = pickRowValue(row, ['niveau', 'level']).toLowerCase();
      const registrationFee = Number(pickRowValue(row, ['frais_inscription', 'registration_fee']));
      const tuitionFee = Number(pickRowValue(row, ['ecolage', 'tuition_fee']));

      const year = yearByLabel.get(yearLabel);
      const level = levelByLabel.get(levelLabel);
      if (!year || !level || Number.isNaN(registrationFee) || Number.isNaN(tuitionFee)) {
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

    setFlash(req, 'success', `Import frais termine: ${imported} lignes importees, ${skipped} ignorees`);
    return res.redirect('/settings/fees');
  }

  @Get('/:id/edit')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  @Render('settings/fees')
  async edit(@Param('id') id: string) {
    const [feeSchedules, schoolYears, levels, matriculeRule, schoolName, editFee] = await Promise.all([
      this.billingService.listFeeSchedules(),
      this.schoolYearsService.list(),
      this.levelsService.list(),
      this.settingsService.getStudentMatriculeRule(),
      this.settingsService.getSchoolName(),
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
    await this.billingService.updateFeeSchedule(id, {
      registrationFee: dto.registrationFee,
      tuitionFee: dto.tuitionFee,
    });
    setFlash(req, 'success', 'Frais modifies');
    return res.redirect('/settings/fees');
  }
}