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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireModule } from '../common/decorators/require-module.decorator';
import { Role, SubjectCategory } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { ModuleGuard } from '../common/guards/module.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { setFlash } from '../common/utils/flash.util';
import { LevelsService } from '../levels/levels.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { PERIODES_BY_CYCLE, PERIODE_LABELS } from './bulletins.constants';
import { BulletinsService } from './bulletins.service';
import { ApproveSubjectDto } from './dto/approve-subject.dto';
import { CreateSessionDto } from './dto/create-session.dto';
import { ImportSessionDto } from './dto/import-session.dto';
import { ResolveRowDto } from './dto/resolve-row.dto';
import { SaveDisciplineDto } from './dto/save-discipline.dto';
import { SessionUser } from '../common/types/session-user.type';

// FileInterceptor's own upload typing needs @types/multer, not installed in
// this project (see multer.util.ts) - this is the minimal shape actually
// read from the uploaded file here.
interface UploadedExcelFile {
  buffer?: Buffer;
  originalname?: string;
}

@Controller('/bulletins')
@UseGuards(AuthenticatedGuard, RolesGuard, ModuleGuard)
@Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
@RequireModule('BULLETINS')
export class BulletinsController {
  constructor(
    private readonly bulletinsService: BulletinsService,
    private readonly levelsService: LevelsService,
    private readonly schoolYearsService: SchoolYearsService,
  ) {}

  @Get()
  @Render('bulletins/index')
  async index() {
    return {
      title: 'Gestion pedagogique — Bulletins',
      sessions: await this.bulletinsService.listSessions(),
      periodeLabels: PERIODE_LABELS,
    };
  }

  @Get('/new')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT)
  @Render('bulletins/new')
  async newSession() {
    const [schoolYears, levels] = await Promise.all([
      this.schoolYearsService.list(),
      this.levelsService.list(),
    ]);
    return {
      title: 'Nouvelle session de bulletins',
      schoolYears,
      levels,
      periodesByCycle: PERIODES_BY_CYCLE,
      periodeLabels: PERIODE_LABELS,
    };
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT)
  async create(
    @Body() dto: CreateSessionDto,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    const createdBy = user?.id;
    if (!createdBy) {
      throw new BadRequestException('Utilisateur non authentifie');
    }
    const session = await this.bulletinsService.createSession(dto, createdBy);
    return res.redirect(`/bulletins/${String(session._id)}`);
  }

  @Get('/:id')
  @Render('bulletins/session')
  async detail(@Param('id') id: string) {
    const [session, unapprovedSubjects] = await Promise.all([
      this.bulletinsService.getSession(id),
      this.bulletinsService.getUnapprovedSubjects(id),
    ]);
    return {
      title: 'Session de bulletins',
      session,
      unapprovedSubjects,
      periodeLabels: PERIODE_LABELS,
    };
  }

  @Post('/:id/import')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT)
  @UseInterceptors(FileInterceptor('file'))
  async importFile(
    @Param('id') id: string,
    @Body() dto: ImportSessionDto,
    @UploadedFile() file: UploadedExcelFile,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('Fichier Excel requis');
    }
    try {
      await this.bulletinsService.importFile(
        id,
        file.buffer,
        dto.mode,
        file.originalname,
      );
      setFlash(
        req,
        'success',
        'Fichier importe. Verifiez les correspondances ci-dessous.',
      );
    } catch (error) {
      setFlash(
        req,
        'error',
        error instanceof Error ? error.message : "Echec de l'import",
      );
    }
    return res.redirect(`/bulletins/${id}/review`);
  }

  @Get('/:id/review')
  @Render('bulletins/import-review')
  async review(@Param('id') id: string) {
    const [session, rows, unapprovedSubjects, roster] = await Promise.all([
      this.bulletinsService.getSession(id),
      this.bulletinsService.listRows(id),
      this.bulletinsService.getUnapprovedSubjects(id),
      this.bulletinsService.getRosterForSession(id),
    ]);
    return {
      title: 'Revue import — Bulletins',
      session,
      rows,
      unapprovedSubjects,
      roster,
      periodeLabels: PERIODE_LABELS,
      subjectCategories: Object.values(SubjectCategory),
    };
  }

  @Get('/:id/donnees')
  @Render('bulletins/import-data')
  async importData(@Param('id') id: string) {
    const grid = await this.bulletinsService.getImportGrid(id);
    return {
      title: 'Donnees importees — Bulletins',
      ...grid,
      periodeLabels: PERIODE_LABELS,
    };
  }

  @Post('/:id/rows/:rowId/resolve')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT)
  async resolveRow(
    @Param('id') id: string,
    @Param('rowId') rowId: string,
    @Body() dto: ResolveRowDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.bulletinsService.resolveRow(rowId, dto.studentId);
    setFlash(req, 'success', 'Ligne rapprochee');
    return res.redirect(`/bulletins/${id}/review`);
  }

  @Post('/:id/subjects/approve')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT)
  async approveSubject(
    @Param('id') id: string,
    @Body() dto: ApproveSubjectDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      await this.bulletinsService.approveSubject(id, dto);
      setFlash(req, 'success', 'Matiere approuvee');
    } catch (error) {
      setFlash(
        req,
        'error',
        error instanceof Error ? error.message : "Echec de l'approbation",
      );
    }
    return res.redirect(`/bulletins/${id}/review`);
  }

  @Get('/:id/discipline')
  @Render('bulletins/discipline')
  async discipline(@Param('id') id: string) {
    const [session, rows] = await Promise.all([
      this.bulletinsService.getSession(id),
      this.bulletinsService.getDisciplineRows(id),
    ]);
    return {
      title: 'Discipline — Bulletins',
      session,
      rows,
      periodeLabels: PERIODE_LABELS,
    };
  }

  @Post('/:id/rows/:rowId/discipline')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT)
  async saveDiscipline(
    @Param('id') id: string,
    @Param('rowId') rowId: string,
    @Body() dto: SaveDisciplineDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.bulletinsService.saveDiscipline(rowId, dto);
    setFlash(req, 'success', 'Informations enregistrees');
    return res.redirect(`/bulletins/${id}/discipline`);
  }

  @Post('/:id/validate')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async validate(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    const actorId = user?.id;
    if (!actorId) {
      throw new BadRequestException('Utilisateur non authentifie');
    }
    try {
      await this.bulletinsService.validateSession(id, actorId);
      setFlash(req, 'success', 'Session validee - les notes sont enregistrees');
    } catch (error) {
      setFlash(
        req,
        'error',
        error instanceof Error ? error.message : 'Echec de la validation',
      );
    }
    return res.redirect(`/bulletins/${id}`);
  }

  @Get('/:id/students/:studentId/pdf')
  async studentPdf(
    @Param('id') id: string,
    @Param('studentId') studentId: string,
    @Res() res: Response,
  ) {
    const pdf = await this.bulletinsService.renderBulletinPdf(id, studentId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bulletin-${studentId}.pdf"`,
    );
    return res.send(pdf);
  }

  @Get('/:id/pdf')
  async classPdf(@Param('id') id: string, @Res() res: Response) {
    const pdf = await this.bulletinsService.renderClassBulletinsPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bulletins-${id}.pdf"`,
    );
    return res.send(pdf);
  }

  @Post('/:id/students/selection/pdf')
  async selectedStudentsPdf(
    @Param('id') id: string,
    @Body('studentIds') studentIdsRaw: string | string[] | undefined,
    @Res() res: Response,
  ) {
    const studentIds = (
      Array.isArray(studentIdsRaw)
        ? studentIdsRaw
        : studentIdsRaw
          ? [studentIdsRaw]
          : []
    ).filter(Boolean);
    const pdf = await this.bulletinsService.renderSelectedBulletinsPdf(
      id,
      studentIds,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bulletins-selection-${id}.pdf"`,
    );
    return res.send(pdf);
  }
}
