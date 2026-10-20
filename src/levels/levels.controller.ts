import {
  BadRequestException,
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
import { LevelCycle, Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { buildExcelBuffer } from '../common/utils/excel.util';
import { setFlash } from '../common/utils/flash.util';
import { CreateLevelDto } from './dto/create-level.dto';
import { LevelsService, LevelWithStatus } from './levels.service';
import { SchoolYearsService } from '../school-years/school-years.service';

// Ecran Parametres > Niveaux : niveaux regroupes par cycle, dans l'ordre
// de la scolarite, avec le nombre de niveaux actifs pour l'annee.
const CYCLE_GROUPS: Array<{
  cycle: LevelCycle | null;
  label: string;
  periodLabel: string;
}> = [
  { cycle: LevelCycle.PRIMAIRE, label: 'Primaire', periodLabel: 'trimestres' },
  { cycle: LevelCycle.COLLEGE, label: 'Collège', periodLabel: 'trimestres' },
  { cycle: LevelCycle.LYCEE, label: 'Lycée', periodLabel: 'semestres' },
  { cycle: null, label: 'Sans cycle', periodLabel: 'aucun bulletin possible' },
];

function levelsPageModel(levels: LevelWithStatus[]) {
  const groups = CYCLE_GROUPS.map((group) => {
    const items = levels.filter((level) =>
      group.cycle === null ? !level.cycle : level.cycle === group.cycle,
    );
    return {
      ...group,
      levels: items,
      enabledCount: items.filter((level) => level.isEnabled).length,
    };
  }).filter((group) => group.levels.length > 0 || group.cycle !== null);
  return {
    groups,
    // Ordre propose par defaut pour un nouveau niveau : a la suite.
    nextSortOrder:
      levels.reduce((max, level) => Math.max(max, level.sortOrder), 0) + 1,
  };
}

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
      schoolYear: year,
      ...levelsPageModel(
        await this.levelsService.listAllForSchoolYear(String(year._id)),
      ),
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
      levels.map((item) => ({
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
      setFlash(req, 'success', 'Niveau enregistré');
    } catch (error) {
      const isDuplicateKey =
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: number }).code === 11000;
      if (isDuplicateKey) {
        setFlash(
          req,
          'error',
          'Un niveau avec ce code ou cet ordre existe déjà',
        );
        return res.redirect('/settings/levels');
      }
      throw error;
    }
    return res.redirect('/settings/levels');
  }

  // Active / desactive le niveau pour l'annee consultee.
  @Post('/:id/enabled')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async setEnabled(
    @Param('id') id: string,
    @Body() body: { enabled?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    const enabled = body.enabled === 'true';
    try {
      const level = await this.levelsService.setEnabledForSchoolYear(
        String(year._id),
        id,
        enabled,
      );
      setFlash(
        req,
        'success',
        enabled
          ? `${level.label} activé pour ${year.label}.`
          : `${level.label} désactivé pour ${year.label} : il n'est plus proposé dans les inscriptions, les frais et les bulletins de cette année.`,
      );
    } catch (error) {
      if (!(error instanceof BadRequestException)) {
        throw error;
      }
      setFlash(req, 'error', error.message);
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
      this.levelsService.listAllForSchoolYear(String(year._id)),
      this.levelsService.findById(id),
    ]);

    // Meme page que la liste, avec la fenetre de modification ouverte
    // (lien direct, ou navigateur sans JavaScript).
    return {
      title: 'Niveaux',
      schoolYear: year,
      ...levelsPageModel(levels),
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
