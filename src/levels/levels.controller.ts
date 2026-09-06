import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Render,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { buildExcelBuffer } from '../common/utils/excel.util';
import { setFlash } from '../common/utils/flash.util';
import { CreateLevelDto } from './dto/create-level.dto';
import { LevelsService } from './levels.service';
import { SchoolYearsService } from '../school-years/school-years.service';

@Controller('/settings/levels')
@UseGuards(AuthenticatedGuard, RolesGuard)
export class LevelsController {
  constructor(
    private readonly levelsService: LevelsService,
    private readonly schoolYearsService: SchoolYearsService,
  ) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  @Render('settings/levels')
  async index(@Req() req: Request) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    return {
      title: 'Niveaux',
      levels: await this.levelsService.listForSchoolYear(String(year._id)),
    };
  }

  @Get('/export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async export(@Req() req: Request, @Res() res: Response) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    const levels = await this.levelsService.listForSchoolYear(String(year._id));
    const buffer = buildExcelBuffer(
      'Niveaux',
      levels.map((item: any) => ({
        code: item.code,
        libelle: item.label,
        ordre: item.sortOrder,
      })),
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="niveaux.xlsx"');
    return res.send(buffer);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async create(
    @Body() dto: CreateLevelDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const year = await this.schoolYearsService.requireOpen();
    try {
      const level = await this.levelsService.create(dto);
      await this.levelsService.enableForSchoolYear(
        String(year._id),
        String(level._id),
      );
      setFlash(req, 'success', 'Niveau enregistre');
    } catch (error: any) {
      if (error?.code === 11000) {
        setFlash(
          req,
          'error',
          'Un niveau avec ce code ou cet ordre existe deja',
        );
        return res.redirect('/settings/levels');
      }
      throw error;
    }
    return res.redirect('/settings/levels');
  }

  @Get('/:id/edit')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  @Render('settings/levels')
  async edit(@Param('id') id: string, @Req() req: Request) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    const [levels, editLevel] = await Promise.all([
      this.levelsService.listForSchoolYear(String(year._id)),
      this.levelsService.findById(id),
    ]);

    return {
      title: 'Modifier niveau',
      levels,
      editLevel,
    };
  }

  @Post('/:id')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async update(
    @Param('id') id: string,
    @Body() dto: CreateLevelDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.levelsService.update(id, dto);
    setFlash(req, 'success', 'Niveau modifié');
    return res.redirect('/settings/levels');
  }
}
