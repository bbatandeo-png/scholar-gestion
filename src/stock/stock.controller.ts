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
import { SessionUser } from '../common/types/session-user.type';
import { CreateStockItemDto } from './dto/create-stock-item.dto';
import { RecordStockMovementDto } from './dto/record-stock-movement.dto';
import { SearchStockItemsDto } from './dto/search-stock-items.dto';
import { StockService } from './stock.service';

@Controller('/stock')
@UseGuards(AuthenticatedGuard, RolesGuard, ModuleGuard)
@RequireModule('STOCK')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  @Render('stock/index')
  async index(@Query() query: SearchStockItemsDto) {
    return {
      title: 'Stocks et fournitures',
      items: await this.stockService.list(query),
      filters: { q: query.q ?? '', category: query.category ?? '' },
    };
  }

  @Get('/export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  async export(@Res() res: Response) {
    const buffer = buildExcelBuffer(
      'Stock',
      await this.stockService.exportRows(),
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="stock.xlsx"');
    return res.send(buffer);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT)
  async create(
    @Body() dto: CreateStockItemDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.stockService.create(dto);
    setFlash(req, 'success', 'Article ajouté au stock.');
    return res.redirect('/stock');
  }

  @Get('/:id')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  @Render('stock/detail')
  async detail(@Param('id') id: string) {
    const [item, movements] = await Promise.all([
      this.stockService.findById(id),
      this.stockService.listMovements(id),
    ]);
    return {
      title: item.name,
      item,
      movements,
      today: new Date().toISOString().slice(0, 10),
    };
  }

  @Post('/:id')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT)
  async update(
    @Param('id') id: string,
    @Body() dto: CreateStockItemDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.stockService.update(id, dto);
    setFlash(req, 'success', 'Article mis à jour.');
    return res.redirect(`/stock/${id}`);
  }

  @Post('/:id/movements')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT)
  async recordMovement(
    @Param('id') id: string,
    @Body() dto: RecordStockMovementDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    await this.stockService.recordMovement(id, dto, user?.id);
    setFlash(req, 'success', 'Mouvement enregistré.');
    return res.redirect(`/stock/${id}`);
  }
}
