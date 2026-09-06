import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { EcolesModule } from '../ecoles/ecoles.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [UsersModule, AuditModule, EcolesModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
