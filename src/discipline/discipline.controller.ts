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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequireModule } from '../common/decorators/require-module.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { ModuleGuard } from '../common/guards/module.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { setFlash } from '../common/utils/flash.util';
import { SessionUser } from '../common/types/session-user.type';
import { LevelsService } from '../levels/levels.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { StudentsService } from '../students/students.service';
import { DisciplineService } from './discipline.service';
import { CreateDisciplineRecordDto } from './dto/create-discipline-record.dto';
import { SearchDisciplineRecordsDto } from './dto/search-discipline-records.dto';

@Controller('/discipline')
@UseGuards(AuthenticatedGuard, RolesGuard, ModuleGuard)
@RequireModule('DISCIPLINE')
export class DisciplineController {
  constructor(
    private readonly disciplineService: DisciplineService,
    private readonly levelsService: LevelsService,
    private readonly schoolYearsService: SchoolYearsService,
    private readonly studentsService: StudentsService,
  ) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  @Render('discipline/index')
  async index(@Req() req: Request, @Query() query: SearchDisciplineRecordsDto) {
    const year = await this.schoolYearsService
      .resolveSelected(req.session.selectedSchoolYearId)
      .catch(() => null);

    const [result, levels, schoolYears, studentDetail] = await Promise.all([
      this.disciplineService.search(query),
      year ? this.levelsService.listForSchoolYear(String(year._id)) : [],
      this.schoolYearsService.list(),
      query.studentId
        ? this.studentsService.detail(query.studentId).catch(() => null)
        : Promise.resolve(null),
    ]);
    const student = studentDetail?.student ?? null;

    return {
      title: 'Journal de discipline',
      ...result,
      levels,
      schoolYears,
      student,
      filters: {
        studentId: query.studentId ?? '',
        levelId: query.levelId ?? '',
        schoolYearId: query.schoolYearId ?? '',
        type: query.type ?? '',
      },
    };
  }

  // No year picker on this form: an entry is always recorded against the
  // school's one OPEN year (requireOpen(), not resolveSelected() - a staff
  // member browsing a past year via the header selector must not be able to
  // backdate a discipline record into it, same rule as enrolling/paying).
  @Get('/new')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  @Render('discipline/new')
  async newRecord(@Query('studentId') studentId?: string) {
    const [activeYear, studentDetail] = await Promise.all([
      this.schoolYearsService.requireOpen(),
      studentId
        ? this.studentsService.detail(studentId).catch(() => null)
        : Promise.resolve(null),
    ]);

    return {
      title: 'Nouvelle entree au journal de discipline',
      activeYear,
      student: studentDetail?.student ?? null,
      today: new Date().toISOString().slice(0, 10),
    };
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async create(
    @Req() req: Request,
    @Res() res: Response,
    @Body() dto: CreateDisciplineRecordDto,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    const activeYear = await this.schoolYearsService.requireOpen();
    await this.disciplineService.create(dto, String(activeYear._id), user?.id);
    setFlash(req, 'success', 'Entree ajoutee au journal de discipline.');
    return res.redirect(`/students/${dto.studentId}`);
  }
}
