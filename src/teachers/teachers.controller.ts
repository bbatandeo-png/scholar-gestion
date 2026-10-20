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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequireModule } from '../common/decorators/require-module.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { ModuleGuard } from '../common/guards/module.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { buildExcelBuffer } from '../common/utils/excel.util';
import { setFlash } from '../common/utils/flash.util';
import { pickUploadedFile } from '../common/utils/multer.util';
import { SessionUser } from '../common/types/session-user.type';
import { BulletinsService } from '../bulletins/bulletins.service';
import { LevelsService } from '../levels/levels.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { CreateTeacherAssignmentDto } from './dto/create-teacher-assignment.dto';
import { CreateTeacherContractDto } from './dto/create-teacher-contract.dto';
import { CreateTeacherDocumentDto } from './dto/create-teacher-document.dto';
import { CreateTeacherDto } from './dto/create-teacher.dto';
import { CreateTeacherTrackingRecordDto } from './dto/create-teacher-tracking-record.dto';
import { SearchTeachersDto } from './dto/search-teachers.dto';
import { TerminateTeacherContractDto } from './dto/terminate-teacher-contract.dto';
import { UpdateTeacherAssignmentDto } from './dto/update-teacher-assignment.dto';
import { UpdateTeacherContractDto } from './dto/update-teacher-contract.dto';
import { UpdateTeacherDocumentDto } from './dto/update-teacher-document.dto';
import { UpdateTeacherTrackingRecordDto } from './dto/update-teacher-tracking-record.dto';
import { TeachersService } from './teachers.service';

@Controller('/teachers')
@UseGuards(AuthenticatedGuard, RolesGuard, ModuleGuard)
@RequireModule('ENSEIGNANTS')
export class TeachersController {
  constructor(
    private readonly teachersService: TeachersService,
    private readonly levelsService: LevelsService,
    private readonly schoolYearsService: SchoolYearsService,
    private readonly bulletinsService: BulletinsService,
  ) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  @Render('teachers/index')
  async index(@Query() query: SearchTeachersDto) {
    const year = await this.schoolYearsService
      .resolveSelected(undefined)
      .catch(() => null);
    const schoolYearId = year ? String(year._id) : undefined;
    const [teachers, stats] = await Promise.all([
      this.teachersService.listWithAssignmentsSummary(query, schoolYearId),
      this.teachersService.getStats(schoolYearId),
    ]);
    return {
      title: 'Personnel enseignant',
      teachers,
      stats,
      filters: { q: query.q ?? '', status: query.status ?? '' },
    };
  }

  @Get('/export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  async export(@Res() res: Response) {
    const buffer = buildExcelBuffer(
      'Enseignants',
      await this.teachersService.exportRows(),
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="enseignants.xlsx"',
    );
    return res.send(buffer);
  }

  @Get('/new')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  @Render('teachers/new')
  newTeacher() {
    return { title: 'Nouvel enseignant' };
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async create(
    @Body() dto: CreateTeacherDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    const teacher = await this.teachersService.create(dto, user?.id);
    await this.teachersService.savePhoto(
      String(teacher._id),
      pickUploadedFile(req, 'photo'),
    );
    setFlash(req, 'success', 'Dossier enseignant créé');
    return res.redirect(`/teachers/${String(teacher._id)}`);
  }

  @Get('/:id')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  @Render('teachers/detail')
  async detail(@Param('id') id: string) {
    const [teacher, assignments, contracts, tracking, documents] =
      await Promise.all([
        this.teachersService.findById(id),
        this.teachersService.listAssignments(id),
        this.teachersService.listContracts(id),
        this.teachersService.listTracking(id),
        this.teachersService.listDocuments(id),
      ]);
    const openYear = await this.schoolYearsService
      .resolveSelected(undefined)
      .catch(() => null);
    const [levels, subjects] = await Promise.all([
      openYear
        ? this.levelsService.listForSchoolYear(String(openYear._id))
        : [],
      this.bulletinsService.listSubjects(),
    ]);
    return {
      title: `${teacher.firstname} ${teacher.lastname}`,
      teacher,
      assignments,
      contracts,
      tracking,
      documents,
      openSchoolYear: openYear,
      levels,
      subjects,
      today: new Date().toISOString().slice(0, 10),
    };
  }

  @Post('/:id')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async update(
    @Param('id') id: string,
    @Body() dto: CreateTeacherDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    await this.teachersService.update(id, dto, user?.id);
    await this.teachersService.savePhoto(id, pickUploadedFile(req, 'photo'));
    setFlash(req, 'success', 'Dossier enseignant mis à jour');
    return res.redirect(`/teachers/${id}`);
  }

  // Pas de selecteur d'annee sur ce formulaire : toujours l'annee OUVERTE
  // (requireOpen()), jamais choisie par le client - meme regle que
  // DisciplineController.create().
  @Post('/:id/assignments')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async createAssignment(
    @Param('id') id: string,
    @Body() dto: CreateTeacherAssignmentDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const activeYear = await this.schoolYearsService.requireOpen();
    const { created, skipped } = await this.teachersService.createAssignments(
      id,
      String(activeYear._id),
      dto,
    );
    setFlash(
      req,
      'success',
      skipped > 0
        ? `${created} affectation(s) ajoutée(s), ${skipped} déjà existante(s) ignorée(s)`
        : `${created} affectation(s) ajoutée(s)`,
    );
    return res.redirect(`/teachers/${id}`);
  }

  @Post('/:id/assignments/:assignmentId')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async updateAssignment(
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
    @Body() dto: UpdateTeacherAssignmentDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    await this.teachersService.updateAssignment(
      id,
      assignmentId,
      dto,
      user?.id,
    );
    setFlash(req, 'success', 'Affectation mise à jour');
    return res.redirect(`/teachers/${id}`);
  }

  @Post('/:id/contracts')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async createContract(
    @Param('id') id: string,
    @Body() dto: CreateTeacherContractDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    await this.teachersService.createContract(id, dto, user?.id);
    setFlash(req, 'success', 'Contrat enregistré');
    return res.redirect(`/teachers/${id}`);
  }

  @Post('/:id/contracts/:contractId/terminate')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async terminateContract(
    @Param('id') id: string,
    @Param('contractId') contractId: string,
    @Body() dto: TerminateTeacherContractDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    await this.teachersService.terminateContract(id, contractId, dto, user?.id);
    setFlash(req, 'success', 'Contrat résilié');
    return res.redirect(`/teachers/${id}`);
  }

  @Post('/:id/contracts/:contractId')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async updateContract(
    @Param('id') id: string,
    @Param('contractId') contractId: string,
    @Body() dto: UpdateTeacherContractDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    await this.teachersService.updateContract(id, contractId, dto, user?.id);
    setFlash(req, 'success', 'Contrat mis à jour');
    return res.redirect(`/teachers/${id}`);
  }

  // Pas de selecteur d'annee ici non plus : toujours l'annee OUVERTE.
  @Post('/:id/tracking')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async createTrackingRecord(
    @Param('id') id: string,
    @Body() dto: CreateTeacherTrackingRecordDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    const activeYear = await this.schoolYearsService.requireOpen();
    await this.teachersService.createTrackingRecord(
      id,
      String(activeYear._id),
      dto,
      user?.id,
    );
    setFlash(req, 'success', 'Entrée de suivi ajoutée');
    return res.redirect(`/teachers/${id}`);
  }

  @Post('/:id/tracking/:recordId')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async updateTrackingRecord(
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body() dto: UpdateTeacherTrackingRecordDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    await this.teachersService.updateTrackingRecord(
      id,
      recordId,
      dto,
      user?.id,
    );
    setFlash(req, 'success', 'Entrée de suivi mise à jour');
    return res.redirect(`/teachers/${id}`);
  }

  @Post('/:id/documents')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async addDocument(
    @Param('id') id: string,
    @Body() dto: CreateTeacherDocumentDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    await this.teachersService.addDocument(
      id,
      dto,
      pickUploadedFile(req, 'file'),
      user?.id,
    );
    setFlash(req, 'success', 'Document ajouté');
    return res.redirect(`/teachers/${id}`);
  }

  @Post('/:id/documents/:documentId')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async updateDocument(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Body() dto: UpdateTeacherDocumentDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    await this.teachersService.updateDocument(
      id,
      documentId,
      dto,
      pickUploadedFile(req, 'file'),
      user?.id,
    );
    setFlash(req, 'success', 'Document mis à jour');
    return res.redirect(`/teachers/${id}`);
  }
}
