import { Body, Controller, Get, Param, Post, Render, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { buildExcelBuffer } from '../common/utils/excel.util';
import { setFlash } from '../common/utils/flash.util';
import { CreateLevelDto } from './dto/create-level.dto';
import { LevelsService } from './levels.service';

@Controller('/settings/levels')
@UseGuards(AuthenticatedGuard, RolesGuard)
export class LevelsController {
  constructor(private readonly levelsService: LevelsService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  @Render('settings/levels')
  async index() {
    return {
      title: 'Niveaux',
      levels: await this.levelsService.list(),
    };
  }

  @Get('/export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async export(@Res() res: Response) {
    const levels = await this.levelsService.list();
    const buffer = buildExcelBuffer(
      'Niveaux',
      levels.map((item: any) => ({
        code: item.code,
        libelle: item.label,
        ordre: item.sortOrder,
      })),
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="niveaux.xlsx"');
    return res.send(buffer);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async create(@Body() dto: CreateLevelDto, @Req() req: Request, @Res() res: Response) {
    await this.levelsService.create(dto);
    setFlash(req, 'success', 'Niveau enregistre');
    return res.redirect('/settings/levels');
  }

  @Get('/:id/edit')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  @Render('settings/levels')
  async edit(@Param('id') id: string) {
    const [levels, editLevel] = await Promise.all([
      this.levelsService.list(),
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
  async update(@Param('id') id: string, @Body() dto: CreateLevelDto, @Req() req: Request, @Res() res: Response) {
    await this.levelsService.update(id, dto);
    setFlash(req, 'success', 'Niveau modifié');
    return res.redirect('/settings/levels');
  }
}