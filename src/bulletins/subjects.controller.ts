import {
  Body,
  Controller,
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
import {
  LevelCycle,
  Role,
  SchoolYearStatus,
  SubjectCategory,
} from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { ModuleGuard } from '../common/guards/module.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { setFlash } from '../common/utils/flash.util';
import { LevelsService } from '../levels/levels.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { BulletinsService } from './bulletins.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpsertClassSubjectDto } from './dto/upsert-class-subject.dto';

const CYCLE_GROUPS: Array<{ cycle: LevelCycle | null; label: string }> = [
  { cycle: LevelCycle.PRIMAIRE, label: 'Primaire' },
  { cycle: LevelCycle.COLLEGE, label: 'Collège' },
  { cycle: LevelCycle.LYCEE, label: 'Lycée' },
  { cycle: null, label: 'Sans cycle' },
];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

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

  // The page opens directly on something useful: the open school year (else
  // the most recent one) and its first enabled class, so the coefficients are
  // visible without having to pick and submit filters first.
  @Get()
  @Render('bulletins/subjects')
  async index(
    @Query('schoolYearId') schoolYearId = '',
    @Query('levelId') levelId = '',
  ) {
    const [subjects, schoolYears] = await Promise.all([
      this.bulletinsService.listSubjects(),
      this.schoolYearsService.list(),
    ]);
    const openYear = schoolYears.find(
      (year) => year.status === SchoolYearStatus.OPEN,
    );
    const selectedYear =
      schoolYears.find((year) => String(year._id) === schoolYearId) ??
      openYear ??
      schoolYears[0];
    const selectedSchoolYearId = selectedYear ? String(selectedYear._id) : '';

    const levels = selectedSchoolYearId
      ? (
          await this.levelsService.listAllForSchoolYear(selectedSchoolYearId)
        ).filter((level) => level.isEnabled)
      : [];
    const selectedLevel =
      levels.find((level) => String(level._id) === levelId) ?? levels[0];
    const selectedLevelId = selectedLevel ? String(selectedLevel._id) : '';
    const levelGroups = CYCLE_GROUPS.map((group) => ({
      label: group.label,
      items: levels.filter((level) =>
        group.cycle === null ? !level.cycle : level.cycle === group.cycle,
      ),
    })).filter((group) => group.items.length > 0);

    const [classSubjects, usageBySubject] = selectedSchoolYearId
      ? await Promise.all([
          selectedLevelId
            ? this.bulletinsService.listClassSubjects(
                selectedSchoolYearId,
                selectedLevelId,
              )
            : Promise.resolve([]),
          this.bulletinsService.countClassSubjectsBySubject(
            selectedSchoolYearId,
          ),
        ])
      : [[], {} as Record<string, number>];

    const configuredIds = new Set(
      classSubjects.map((cs) =>
        String((cs.subjectId as unknown as { _id: string })._id),
      ),
    );
    const availableSubjects = subjects.filter(
      (subject) => !configuredIds.has(String(subject._id)),
    );
    const totalCoefficient = classSubjects.reduce(
      (sum, cs) => sum + (cs.coefficient ?? 0),
      0,
    );

    return {
      title: 'Matières et coefficients',
      subjects,
      usageBySubject,
      schoolYears,
      levelGroups,
      classSubjects,
      availableSubjects,
      totalCoefficient,
      selectedSchoolYearId,
      selectedLevelId,
      selectedLevelLabel: selectedLevel?.label ?? '',
      selectedYearLabel: selectedYear?.label ?? '',
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
      setFlash(req, 'success', `Matière « ${dto.label} » créée`);
    } catch (error) {
      setFlash(req, 'error', errorMessage(error, 'Échec de la création'));
    }
    const back = req.get('referer');
    return res.redirect(
      back && back.includes('/bulletins/matieres')
        ? back
        : '/bulletins/matieres',
    );
  }

  @Post('/class-subject')
  async upsertClassSubject(
    @Body() dto: UpsertClassSubjectDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      await this.bulletinsService.upsertClassSubject(dto);
      setFlash(req, 'success', 'Coefficient enregistré');
    } catch (error) {
      setFlash(req, 'error', errorMessage(error, "Échec de l'enregistrement"));
    }
    return res.redirect(
      `/bulletins/matieres?schoolYearId=${dto.schoolYearId}&levelId=${dto.levelId}`,
    );
  }

  @Post('/class-subject/:id/delete')
  async removeClassSubject(
    @Param('id') id: string,
    @Body() body: { schoolYearId?: string; levelId?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    let schoolYearId = body.schoolYearId ?? '';
    let levelId = body.levelId ?? '';
    try {
      const removed = await this.bulletinsService.removeClassSubject(id);
      schoolYearId = String(removed.schoolYearId);
      levelId = String(removed.levelId);
      setFlash(req, 'success', 'Matière retirée de la classe');
    } catch (error) {
      setFlash(req, 'error', errorMessage(error, 'Échec du retrait'));
    }
    return res.redirect(
      `/bulletins/matieres?schoolYearId=${encodeURIComponent(schoolYearId)}&levelId=${encodeURIComponent(levelId)}`,
    );
  }
}
