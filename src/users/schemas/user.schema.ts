import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { Role, UserStatus } from '../../common/enums/domain.enums';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  // Deliberately NOT scoped by ecoleScopePlugin: login resolves the user by
  // email before any tenant context exists, so email must stay globally
  // unique across the whole platform (see src/common/mongoose/ecole-scope.plugin.ts).
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ required: true, enum: Object.values(Role) })
  role: Role;

  @Prop({
    required: true,
    enum: Object.values(UserStatus),
    default: UserStatus.ACTIVE,
  })
  status: UserStatus;

  // Null for PLATFORM_ADMIN (operates across schools). Set for every
  // per-school role. Not enforced by the scoping plugin - callers thread it
  // through explicitly (see EcolesService.onboardNewEcole, UsersService).
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Ecole',
    default: null,
    index: true,
  })
  ecoleId: string | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
