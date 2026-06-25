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
import { Role, UserStatus } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { setFlash } from '../common/utils/flash.util';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserAccessDto } from './dto/update-user-access.dto';
import { UpdateUserPasswordDto } from './dto/update-user-password.dto';
import { UsersService } from './users.service';

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

@Controller('/users')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Render('users/index')
  async index(
    @Query('q') q = '',
    @Query('role') role = '',
    @Query('status') status = '',
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
  ) {
    const page = parsePositiveInt(pageRaw, 1);
    const pageSize = Math.min(parsePositiveInt(pageSizeRaw, 10), 100);

    const roleValues = Object.values(Role);
    const statusValues = Object.values(UserStatus);

    const selectedRole = roleValues.includes(role as Role) ? (role as Role) : '';
    const selectedStatus = statusValues.includes(status as UserStatus) ? (status as UserStatus) : '';

    const { items, total } = await this.usersService.listPaginated({
      q,
      role: selectedRole || undefined,
      status: selectedStatus || undefined,
      page,
      pageSize,
    });

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return {
      title: 'Utilisateurs',
      users: items,
      roleOptions: roleValues,
      statusOptions: statusValues,
      query: q,
      selectedRole,
      selectedStatus,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
        prevPage: Math.max(1, page - 1),
        nextPage: Math.min(totalPages, page + 1),
      },
    };
  }

  @Post()
  async create(@Body() dto: CreateUserDto, @Req() req: Request, @Res() res: Response) {
    try {
      await this.usersService.create(dto);
      setFlash(req, 'success', 'Utilisateur cree avec succes');
    } catch (error: any) {
      if (error?.code === 11000) {
        setFlash(req, 'error', 'Cet email est deja utilise');
        return res.redirect('/users');
      }
      throw error;
    }

    return res.redirect('/users');
  }

  @Post('/:id/access')
  async updateAccess(
    @Param('id') id: string,
    @Body() dto: UpdateUserAccessDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const currentUserId = (req.session as any)?.user?.id;
    if (currentUserId === id && dto.status === UserStatus.DISABLED) {
      setFlash(req, 'error', 'Impossible de desactiver votre propre compte');
      return res.redirect('/users');
    }

    const updated = await this.usersService.updateAccess(id, dto);
    if (!updated) {
      setFlash(req, 'error', 'Utilisateur introuvable');
      return res.redirect('/users');
    }

    setFlash(req, 'success', 'Acces utilisateur mis a jour');
    return res.redirect('/users');
  }

  @Post('/:id/password')
  async updatePassword(
    @Param('id') id: string,
    @Body() dto: UpdateUserPasswordDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const updated = await this.usersService.updatePassword(id, dto.password);
    if (!updated) {
      setFlash(req, 'error', 'Utilisateur introuvable');
      return res.redirect('/users');
    }

    setFlash(req, 'success', 'Mot de passe mis a jour');
    return res.redirect('/users');
  }
}
