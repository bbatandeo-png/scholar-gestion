import { Controller, Get, Redirect, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';

@Controller()
export class RootController {
  @Get()
  @Redirect('/dashboard')
  root() {
    return;
  }

  @Get('/health')
  health(@Req() req: Request, @Res() res: Response) {
    return res.json({
      ok: true,
      authenticated: Boolean(req.session?.user),
      at: new Date().toISOString(),
    });
  }
}