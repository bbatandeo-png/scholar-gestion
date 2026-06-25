import { Role } from '../enums/domain.enums';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};