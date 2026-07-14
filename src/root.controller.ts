import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Redirect,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Controller()
export class RootController {
  @Get('/.well-known/appspecific/com.chrome.devtools.json')
  @HttpCode(HttpStatus.NO_CONTENT)
  chromeDevToolsDiscovery(): void {
    // Chrome probes this optional endpoint whenever DevTools is opened.
  }

  @Get()
  @Redirect('/dashboard')
  root() {
    return;
  }

  @Get(['/health', '/scholar', '/scholar/'])
  health(@Req() req: Request, @Res() res: Response) {
    return res.json({
      ok: true,
      authenticated: Boolean(req.session?.user),
      at: new Date().toISOString(),
    });
  }
}
