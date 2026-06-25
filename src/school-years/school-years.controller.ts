import { Body, Controller, Get, Param, Post, Render, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { buildExcelBuffer } from '../common/utils/excel.util';
import { setFlash } from '../common/utils/flash.util';
import { CreateSchoolYearDto } from './dto/create-school-year.dto';
import { UpdateSchoolYearDto } from './dto/update-school-year.dto';
import { UpdateSchoolYearStatusDto } from './dto/update-school-year-status.dto';
import { SchoolYearsService } from './school-years.service';

@Controller('/settings/school-years')
@UseGuards(AuthenticatedGuard, RolesGuard)
export class SchoolYearsController {
  constructor(private readonly schoolYearsService: SchoolYearsService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  @Render('settings/school-years')
  async index() {
    return {
      title: 'Annees scolaires',
      schoolYears: await this.schoolYearsService.list(),
    };
  }

  @Get('export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async export(@Res() res: Response) {
    const schoolYears = await this.schoolYearsService.list();
    const buffer = buildExcelBuffer(
      'Annees_scolaires',
      schoolYears.map((item: any) => ({
        libelle: item.label,
        date_debut: item.startDate,
        date_fin: item.endDate,
        statut: item.status,
      })),
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="annees_scolaires.xlsx"');
    return res.send(buffer);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async create(@Body() dto: CreateSchoolYearDto, @Req() req: Request, @Res() res: Response) {
    await this.schoolYearsService.create(dto);
    setFlash(req, 'success', 'Annee scolaire enregistree');
    return res.redirect('/settings/school-years');
  }

  @Post('/:id/status')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateSchoolYearStatusDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.schoolYearsService.updateStatus(id, dto.status);
    setFlash(req, 'success', 'Statut de l\'annee mis a jour');
    return res.redirect('/settings/school-years');
  }

  @Get('/:id/edit')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  @Render('settings/school-years')
  async edit(@Param('id') id: string) {
    const schoolYears = await this.schoolYearsService.list();
    const editYear = await this.schoolYearsService.findById(id);

    return {
      title: 'Modifier annee scolaire',
      schoolYears,
      editYear,
    };
  }

  @Post('/:id')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSchoolYearDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.schoolYearsService.update(id, dto);
    setFlash(req, 'success', 'Annee scolaire modifiee');
    return res.redirect('/settings/school-years');
  }
}