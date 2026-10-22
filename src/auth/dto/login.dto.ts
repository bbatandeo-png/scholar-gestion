import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  // Page demandee avant la redirection vers la connexion (session expiree).
  @IsOptional()
  @IsString()
  next?: string;
}
