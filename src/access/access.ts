import { CanActivate, ExecutionContext, ForbiddenException, Global, Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { AuthUser } from '../auth/auth.decorators';
import { User, UserSchema } from '../users/user.schema';

/**
 * Who may manage the app. Admins create and manage every course, the users, the sentence bank and the library.
 * Roles live in the database (users.role) and are managed in the admin page. ADMIN_EMAILS (comma separated, optional) is only
 * for the very first admin: it is used at start-up when no account is admin yet, and ignored once one exists.
 */
@Injectable()
export class AccessService implements OnApplicationBootstrap {
  private readonly log = new Logger('Access');
  /** user id → [isAdmin, checked at]; a minute is short enough for role changes to apply quickly. */
  private readonly cache = new Map<string, [boolean, number]>();

  constructor(@InjectModel(User.name) private readonly users: Model<User>, private readonly config: ConfigService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (await this.users.exists({ role: 'admin' }).catch(() => null)) return;
    const emails = (this.config.get<string>('ADMIN_EMAILS') ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (!emails.length) { this.log.warn('No admin account yet. Set ADMIN_EMAILS to an existing account’s email and restart to make the first admin.'); return; }
    const r = await this.users.updateMany({ email: { $in: emails } }, { $set: { role: 'admin' } }).catch(() => null);
    this.log.log(r?.modifiedCount ? 'Made ' + r.modifiedCount + ' account(s) the first admin from ADMIN_EMAILS.' : 'ADMIN_EMAILS matches no account yet; sign up with that email, then restart.');
  }

  async isAdmin(user: string): Promise<boolean> {
    const hit = this.cache.get(user);
    if (hit && Date.now() - hit[1] < 60_000) return hit[0];
    const u = await this.users.findById(user, { role: 1 }).lean().catch(() => null);
    const admin = u?.role === 'admin';
    this.cache.set(user, [admin, Date.now()]);
    return admin;
  }

  /** Throws unless the user is an admin. */
  async requireAdmin(user: string, message = 'Only an admin can do this.'): Promise<void> {
    if (!(await this.isAdmin(user))) throw new ForbiddenException(message);
  }

  /** After a role change, so it applies straight away. */
  forget(user: string): void {
    this.cache.delete(user);
  }
}

/** Guard for admin-only controllers: @UseGuards(AdminGuard). */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly access: AccessService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!req.user) return false;
    await this.access.requireAdmin(req.user.sub);
    return true;
  }
}

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  providers: [AccessService, AdminGuard],
  exports: [AccessService, AdminGuard]
})
export class AccessModule {}
