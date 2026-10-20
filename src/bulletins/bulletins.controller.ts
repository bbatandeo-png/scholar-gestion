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
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireModule } from '../common/decorators/require-module.decorator';
import { Role, SubjectCategory } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { ModuleGuard } from '../common/guards/module.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { pickUploadedFile } from '../common/utils/multer.util';
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
      title: 'Gestion pédagogique — Bulletins',
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

  // Saisie des notes dans l'application, une matiere a la fois.
  @Get('/:id/saisie')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT)
  @Render('bulletins/grade-entry')
  async gradeEntry(
    @Param('id') id: string,
    @Query('subjectId') subjectId?: string,
  ) {
    const entry = await this.bulletinsService.getGradeEntry(id, subjectId);
    const selectedIndex = entry.subjects.findIndex(
      (subject) => subject.subjectId === entry.selected?.subjectId,
    );
    return {
      title: 'Saisie des notes',
      ...entry,
      nextSubject: entry.subjects[selectedIndex + 1] ?? null,
      periodeLabels: PERIODE_LABELS,
    };
  }

  @Post('/:id/saisie')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT)
  async saveGradeEntry(
    @Param('id') id: string,
    // Pas de DTO : le formulaire envoie un champ notes[<eleve>][i1|i2|devoir|compo]
    // par eleve, dont les cles (identifiants) ne sont pas connues a l'avance.
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const subjectId = typeof body.subjectId === 'string' ? body.subjectId : '';
    const toNote = (raw: unknown): number | null => {
      if (typeof raw !== 'string' || raw.trim() === '') {
        return null;
      }
      return Number(raw.trim().replace(',', '.'));
    };
    const rawNotes =
      body.notes && typeof body.notes === 'object'
        ? (body.notes as Record<string, Record<string, unknown>>)
        : {};
    const values = Object.fromEntries(
      Object.entries(rawNotes).map(([studentId, fields]) => [
        studentId,
        {
          i1: toNote(fields?.i1),
          i2: toNote(fields?.i2),
          devoir: toNote(fields?.devoir),
          compo: toNote(fields?.compo),
        },
      ]),
    );

    let nextSubjectId = subjectId;
    try {
      const saved = await this.bulletinsService.saveGradeEntry(
        id,
        subjectId,
        values,
      );
      setFlash(
        req,
        'success',
        `Notes de ${saved.subjectLabel} enregistrées pour ${saved.studentCount} élève(s).`,
      );
      if (typeof body.nextSubjectId === 'string' && body.nextSubjectId) {
        nextSubjectId = body.nextSubjectId;
      }
    } catch (error) {
      if (!(error instanceof BadRequestException)) {
        throw error;
      }
      setFlash(req, 'error', error.message);
    }
    return res.redirect(
      `/bulletins/${id}/saisie?subjectId=${encodeURIComponent(nextSubjectId)}`,
    );
  }

  // Modele Excel pre-rempli (eleves, matieres, coefficients, enseignants)
  // au format exact attendu par POST /:id/import ci-dessous.
  @Get('/:id/template')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT)
  async downloadTemplate(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const { buffer, fileName } =
        await this.bulletinsService.buildImportTemplate(id);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${fileName}"`,
      );
      return res.send(buffer);
    } catch (error) {
      if (!(error instanceof BadRequestException)) {
        throw error;
      }
      setFlash(req, 'error', error.message);
      return res.redirect(`/bulletins/${id}`);
    }
  }

  @Post('/:id/import')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT)
  async importFile(
    @Param('id') id: string,
    @Body() dto: ImportSessionDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const file = pickUploadedFile(req, 'file');
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
        error instanceof Error ? error.message : "Échec de l'import",
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
    // Matieres deja configurees pour la classe : pour comparer avec celles
    // du fichier, et detecter un fichier destine a une autre classe (aucune
    // matiere du fichier reconnue alors que la classe en a).
    const classSubjects = await this.bulletinsService.listClassSubjects(
      String((session.schoolYearId as unknown as { _id: unknown })._id),
      String((session.levelId as unknown as { _id: unknown })._id),
    );
    const configuredSubjects = classSubjects.map((cs) => ({
      label: (cs.subjectId as unknown as { label: string }).label,
      coefficient: cs.coefficient,
    }));
    const recognizedCount = new Set(
      rows.flatMap((row) =>
        row.notes.filter((n) => n.subjectId).map((n) => n.subjectNameRaw),
      ),
    ).size;
    return {
      title: 'Revue import — Bulletins',
      session,
      rows,
      unapprovedSubjects,
      configuredSubjects,
      looksLikeOtherClass:
        configuredSubjects.length > 0 &&
        unapprovedSubjects.length > 0 &&
        recognizedCount === 0,
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
      title: 'Données importées — Bulletins',
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

  // Approbation de toutes les matieres a approuver en une fois. Le
  // formulaire envoie subjects[i][subjectNameRaw|label|category|coefficient|
  // teacherName] (valeurs pre-remplies depuis le fichier et le catalogue,
  // modifiables) ; chaque ligne passe par la meme regle que l'approbation
  // unitaire.
  @Post('/:id/subjects/approve-all')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT)
  async approveAllSubjects(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const rawSubjects = body.subjects;
    const entries = (
      Array.isArray(rawSubjects)
        ? rawSubjects
        : rawSubjects && typeof rawSubjects === 'object'
          ? Object.values(rawSubjects)
          : []
    ) as Array<Record<string, unknown>>;
    const text = (value: unknown) =>
      typeof value === 'string' ? value.trim() : '';
    const categories = Object.values(SubjectCategory) as string[];

    const errors: string[] = [];
    let approved = 0;
    for (const entry of entries) {
      const subjectNameRaw = text(entry.subjectNameRaw);
      const coefficient = Number(text(entry.coefficient).replace(',', '.'));
      const category = text(entry.category);
      if (!subjectNameRaw) {
        continue;
      }
      if (!Number.isFinite(coefficient) || coefficient < 0) {
        errors.push(`${subjectNameRaw} : coefficient manquant ou invalide`);
        continue;
      }
      if (!categories.includes(category)) {
        errors.push(`${subjectNameRaw} : catégorie manquante`);
        continue;
      }
      try {
        await this.bulletinsService.approveSubject(id, {
          subjectNameRaw,
          label: text(entry.label) || subjectNameRaw,
          category: category as SubjectCategory,
          coefficient,
          teacherName: text(entry.teacherName) || undefined,
        });
        approved += 1;
      } catch (error) {
        errors.push(
          `${subjectNameRaw} : ${error instanceof Error ? error.message : 'échec'}`,
        );
      }
    }

    if (approved > 0) {
      setFlash(
        req,
        errors.length ? 'error' : 'success',
        errors.length
          ? `${approved} matière(s) approuvée(s). À corriger : ${errors.join(' ; ')}`
          : `${approved} matière(s) approuvée(s) et ajoutée(s) à la classe.`,
      );
    } else {
      setFlash(
        req,
        'error',
        errors.length ? errors.join(' ; ') : 'Aucune matière à approuver.',
      );
    }
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
      setFlash(req, 'success', 'Matière approuvée');
    } catch (error) {
      setFlash(
        req,
        'error',
        error instanceof Error ? error.message : "Échec de l'approbation",
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
    setFlash(req, 'success', 'Informations enregistrées');
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
      setFlash(req, 'success', 'Session validée - les notes sont enregistrées');
    } catch (error) {
      setFlash(
        req,
        'error',
        error instanceof Error ? error.message : 'Échec de la validation',
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
