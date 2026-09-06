import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../app.module';
import { Role } from '../common/enums/domain.enums';
import { UsersService } from '../users/users.service';

// One-off utility to create the platform operator's own login before the
// onboarding flow exists. Idempotent (reuses the account if the email
// already exists) - PLATFORM_ADMIN accounts always have ecoleId: null.
export async function createPlatformAdmin(
  email: string,
  password: string,
  name = 'Platform Admin',
) {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const usersService = app.get(UsersService);
    const passwordHash = await bcrypt.hash(password, 10);
    return usersService.ensureAdmin({
      name,
      email,
      passwordHash,
      role: Role.PLATFORM_ADMIN,
      ecoleId: null,
    });
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  const email = process.argv[2] ?? process.env.PLATFORM_ADMIN_EMAIL;
  const password = process.argv[3] ?? process.env.PLATFORM_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error(
      'Usage: ts-node create-platform-admin.ts <email> <password> [name]',
    );
    process.exitCode = 1;
  } else {
    void createPlatformAdmin(email, password, process.argv[4])
      .then((user) => console.log('Platform admin pret :', user.email))
      .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
      });
  }
}
