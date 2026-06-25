import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LevelsService } from '../levels/levels.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { pickRowValue, readExcelRows } from '../common/utils/excel.util';
import { setFlash } from '../common/utils/flash.util';
import { PreparePromotionsDto } from './dto/prepare-promotions.dto';
import { ValidatePromotionsDto } from './dto/validate-promotions.dto';
import { PromotionsService } from './promotions.service';
import { Student, StudentDocument } from '../students/schemas/student.schema';

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
      levels: await this.levelsService.list(),
    };
  }

  @Post('/prepare')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  @Render('promotions/prepare')
  async prepare(@Body() dto: PreparePromotionsDto) {
    return {
      title: 'Preparation promotion',
      schoolYears: await this.schoolYearsService.list(),
      levels: await this.levelsService.list(),
      sourceSchoolYearId: dto.sourceSchoolYearId,
      targetSchoolYearId: dto.targetSchoolYearId,
      candidates: await this.promotionsService.prepare(dto.sourceSchoolYearId),
    };
  }

  @Post('/prepare-import')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  @UseInterceptors(FileInterceptor('file'))
  @Render('promotions/prepare')
  async prepareImport(
    @Body() dto: PreparePromotionsDto,
    @UploadedFile() file: any,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('Fichier Excel requis');
    }

    const [schoolYears, levels, candidates, students, rows] = await Promise.all([
      this.schoolYearsService.list(),
      this.levelsService.list(),
      this.promotionsService.prepare(dto.sourceSchoolYearId),
      this.studentModel.find().lean().exec(),
      Promise.resolve(readExcelRows(file.buffer)),
    ]);

    const levelByLabel = new Map(levels.map((item: any) => [String(item.label).toLowerCase(), item]));
    const studentByMatricule = new Map(students.map((item: any) => [String(item.matricule).toLowerCase(), item]));
    const candidateByStudentId = new Map(
      candidates.map((item: any) => [String(item.studentId?._id ?? item.studentId), item]),
    );

    const importedByEnrollmentId = new Map<string, { decision: string; targetLevelId: string }>();

    for (const row of rows) {
      const matricule = pickRowValue(row, ['matricule', 'code_eleve']).toLowerCase();
      const decision = pickRowValue(row, ['decision']);
      const targetLevel = pickRowValue(row, ['niveau_cible', 'target_level']).toLowerCase();

      const student = studentByMatricule.get(matricule);
      const candidate = student ? candidateByStudentId.get(String(student._id)) : undefined;
      const level = levelByLabel.get(targetLevel);

      if (!candidate || !level || !decision) {
        continue;
      }

      importedByEnrollmentId.set(String(candidate._id), {
        decision,
        targetLevelId: String(level._id),
      });
    }

    const enrichedCandidates = candidates.map((candidate: any) => {
      const imported = importedByEnrollmentId.get(String(candidate._id));
      return {
        ...candidate,
        importedDecision: imported?.decision,
        importedTargetLevelId: imported?.targetLevelId,
      };
    });

    return {
      title: 'Preparation promotion',
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
  async validate(@Body() dto: ValidatePromotionsDto, @Req() req: Request, @Res() res: Response) {
    await this.promotionsService.validate(dto, req.session.user?.id);
    setFlash(req, 'success', 'Promotion annuelle validee');
    return res.redirect('/promotions');
  }
}