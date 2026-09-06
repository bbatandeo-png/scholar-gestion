import {
  Body,
  Controller,
  Get,
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
import { Role, SubjectCategory } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { ModuleGuard } from '../common/guards/module.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { setFlash } from '../common/utils/flash.util';
import { LevelsService } from '../levels/levels.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { BulletinsService } from './bulletins.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpsertClassSubjectDto } from './dto/upsert-class-subject.dto';

// Standalone catalog/configuration screen: lets an admin proactively create
// matieres and set per-class coefficients before an import ever happens,
// instead of only being able to do so reactively while reviewing a session.
@Controller('/bulletins/matieres')
@UseGuards(AuthenticatedGuard, RolesGuard, ModuleGuard)
@Roles(Role.SUPER_ADMIN, Role.DIRECTION)
@RequireModule('BULLETINS')
export class SubjectsController {
  constructor(
    private readonly bulletinsService: BulletinsService,
    private readonly levelsService: LevelsService,
    private readonly schoolYearsService: SchoolYearsService,
  ) {}

  @Get()
  @Render('bulletins/subjects')
  async index(
    @Query('schoolYearId') schoolYearId = '',
    @Query('levelId') levelId = '',
  ) {
    const [subjects, schoolYears, levels] = await Promise.all([
      this.bulletinsService.listSubjects(),
      this.schoolYearsService.list(),
      this.levelsService.list(),
    ]);
    const classSubjects =
      schoolYearId && levelId
        ? await this.bulletinsService.listClassSubjects(schoolYearId, levelId)
        : [];

    return {
      title: 'Matieres',
      subjects,
      schoolYears,
      levels,
      classSubjects,
      selectedSchoolYearId: schoolYearId,
      selectedLevelId: levelId,
      subjectCategories: Object.values(SubjectCategory),
    };
  }

  @Post()
  async createSubject(
    @Body() dto: CreateSubjectDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      await this.bulletinsService.createSubject(dto);
      setFlash(req, 'success', 'Matiere creee');
    } catch (error) {
      setFlash(
        req,
        'error',
        error instanceof Error ? error.message : 'Echec de la creation',
      );
    }
    return res.redirect('/bulletins/matieres');
  }

  @Post('/class-subject')
  async upsertClassSubject(
    @Body() dto: UpsertClassSubjectDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.bulletinsService.upsertClassSubject(dto);
    setFlash(req, 'success', 'Configuration enregistree');
    return res.redirect(
      `/bulletins/matieres?schoolYearId=${dto.schoolYearId}&levelId=${dto.levelId}`,
    );
  }
}
