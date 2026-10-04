import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Skips the JWT guard (login, register, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface AuthUser { sub: string; email: string }

/** The signed-in user's id, set by the JWT guard. */
export const UserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
  return req.user.sub;
});
