import {
  BadRequestException,
  Body,
  Controller,
  ExceptionFilter,
  Get,
  HttpException,
  Post,
  Redirect,
  Render,
  Req,
  Res,
  UseFilters,
  UseGuards,
  Catch,
  ArgumentsHost,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { setFlash } from '../common/utils/flash.util';
import { LoginDto } from './dto/login.dto';
import { AuthService } from './auth.service';

@Catch(BadRequestException)
class LoginValidationFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    setFlash(req, 'error', 'Email ou mot de passe invalide');
    res.redirect('/login');
  }
}

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('/login')
  @Render('auth/login')
  loginPage() {
    return { title: 'Connexion' };
  }

  @Post('/login')
  @UseFilters(LoginValidationFilter)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res() res: Response) {
    try {
      const user = await this.authService.validateUser(dto.email, dto.password);
      (req.session as any).user = {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
      };
      setFlash(req, 'success', 'Connexion reussie');
      return res.redirect('/dashboard');
    } catch {
      setFlash(req, 'error', 'Email ou mot de passe invalide');
      return res.redirect('/login');
    }
  }

  @Post('/logout')
  @UseGuards(AuthenticatedGuard)
  @Redirect('/login')
  logout(@Req() req: Request) {
    req.session.destroy(() => undefined);
    return;
  }
}