import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Render,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LevelsService } from '../levels/levels.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FinalDecision, Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { pickRowValue, readExcelRows } from '../common/utils/excel.util';
import { pickUploadedFile } from '../common/utils/multer.util';
import { setFlash } from '../common/utils/flash.util';
import { PreparePromotionsDto } from './dto/prepare-promotions.dto';
import { ValidatePromotionsDto } from './dto/validate-promotions.dto';
import { PromotionsService } from './promotions.service';
import { Student, StudentDocument } from '../students/schemas/student.schema';
import { SessionUser } from '../common/types/session-user.type';
import { toDisplayString } from '../common/utils/safe-string.util';

// Not gated here by @RequireModule('FINANCE'): the FINANCE check lives
// inside PromotionsService.validate() itself instead (see that file), since
// this controller's other routes (index, prepare) are core academic-year
// functionality with no direct financial write of their own.
// The Excel file is filled by the school in French ("Admis", "Redouble"…);
// the English codes stay accepted for files prepared before.
const DECISION_ALIASES: Record<string, FinalDecision> = {
  admis: FinalDecision.PROMOTED,
  admise: FinalDecision.PROMOTED,
  promu: FinalDecision.PROMOTED,
  passe: FinalDecision.PROMOTED,
  redouble: FinalDecision.REPEATED,
  redoublant: FinalDecision.REPEATED,
  redoublante: FinalDecision.REPEATED,
  transfere: FinalDecision.TRANSFERRED,
  transferee: FinalDecision.TRANSFERRED,
  'quitte l ecole': FinalDecision.LEFT,
  quitte: FinalDecision.LEFT,
  depart: FinalDecision.LEFT,
  archive: FinalDecision.ARCHIVED,
  archivee: FinalDecision.ARCHIVED,
};

export function parseDecision(raw: string): FinalDecision | '' {
  const key = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!key) return '';
  const code = Object.values(FinalDecision).find(
    (value) => String(value) === key,
  );
  if (code) {
    return code === FinalDecision.PENDING ? '' : code;
  }
  return DECISION_ALIASES[key] ?? '';
}

@Controller('/promotions')
@UseGuards(AuthenticatedGuard, RolesGuard)
export class PromotionsController {
  constructor(
    private readonly promotionsService: PromotionsService,
    private readonly schoolYearsService: SchoolYearsService,
    private readonly levelsService: LevelsService,
    @InjectModel(Student.name)
    private readonly studentModel: Model<StudentDocument>,
  ) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.AUDITEUR)
  @Render('promotions/index')
  async index() {
    return {
      title: 'Promotions annuelles',
      schoolYears: await this.schoolYearsService.list(),
      openSchoolYear: await this.schoolYearsService.findOpen(),
      levels: await this.levelsService.list(),
    };
  }

  @Post('/prepare')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  @Render('promotions/prepare')
  async prepare(@Body() dto: PreparePromotionsDto) {
    return {
      title: 'Préparation de la promotion',
      schoolYears: await this.schoolYearsService.list(),
      levels: await this.levelsService.list(),
      sourceSchoolYearId: dto.sourceSchoolYearId,
      targetSchoolYearId: dto.targetSchoolYearId,
      candidates: await this.promotionsService.prepare(dto.sourceSchoolYearId),
    };
  }

  @Post('/prepare-import')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  @Render('promotions/prepare')
  async prepareImport(@Body() dto: PreparePromotionsDto, @Req() req: Request) {
    const file = pickUploadedFile(req, 'file');
    if (!file?.buffer) {
      throw new BadRequestException('Fichier Excel requis');
    }

    const [schoolYears, levels, candidates, students, rows] = await Promise.all(
      [
        this.schoolYearsService.list(),
        this.levelsService.list(),
        this.promotionsService.prepare(dto.sourceSchoolYearId),
        this.studentModel.find().lean().exec(),
        Promise.resolve(readExcelRows(file.buffer)),
      ],
    );

    const levelByLabel = new Map(
      levels.map((item) => [item.label.toLowerCase(), item]),
    );
    const studentByMatricule = new Map(
      students.map((item) => [item.matricule.toLowerCase(), item]),
    );
    const candidateByStudentId = new Map(
      candidates.map((item) => [
        toDisplayString(item.studentId?._id ?? item.studentId),
        item,
      ]),
    );

    const importedByEnrollmentId = new Map<
      string,
      { decision: string; targetLevelId: string }
    >();

    for (const row of rows) {
      const matricule = pickRowValue(row, [
        'matricule',
        'code_eleve',
      ]).toLowerCase();
      const decision = parseDecision(pickRowValue(row, ['decision']));
      const targetLevel = pickRowValue(row, [
        'niveau_cible',
        'target_level',
      ]).toLowerCase();

      const student = studentByMatricule.get(matricule);
      const candidate = student
        ? candidateByStudentId.get(String(student._id))
        : undefined;
      const level = levelByLabel.get(targetLevel);

      if (!candidate || !level || !decision) {
        continue;
      }

      importedByEnrollmentId.set(toDisplayString(candidate._id), {
        decision,
        targetLevelId: String(level._id),
      });
    }

    const enrichedCandidates = candidates.map((candidate) => {
      const imported = importedByEnrollmentId.get(
        toDisplayString(candidate._id),
      );
      return {
        ...candidate,
        importedDecision: imported?.decision,
        importedTargetLevelId: imported?.targetLevelId,
      };
    });

    return {
      title: 'Préparation de la promotion',
      schoolYears,
      levels,
      sourceSchoolYearId: dto.sourceSchoolYearId,
      targetSchoolYearId: dto.targetSchoolYearId,
      candidates: enrichedCandidates,
      importedCount: importedByEnrollmentId.size,
    };
  }

  @Post('/validate')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async validate(
    @Body() dto: ValidatePromotionsDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    await this.promotionsService.validate(dto, user?.id);
    req.session.selectedSchoolYearId = dto.targetSchoolYearId;
    setFlash(req, 'success', 'Promotion terminée et nouvelle année activée');
    return res.redirect('/dashboard');
  }
}
