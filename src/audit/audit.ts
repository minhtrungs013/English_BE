import { AsyncLocalStorage } from 'async_hooks';
import { CallHandler, ExecutionContext, Global, Injectable, Logger, MiddlewareConsumer, Module, NestInterceptor, NestModule, OnModuleInit } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { NextFunction, Request, Response } from 'express';
import { Model } from 'mongoose';
import type { Observable } from 'rxjs';
import type { AuthUser } from '../auth/auth.decorators';

/** Kept for 90 days, then MongoDB deletes the entry. */
const KEEP_DAYS = 90;

/** One AI call: who caused it, from which API, and what it cost. */
@Schema({ collection: 'audit_logs', versionKey: false })
export class AuditLog {
  @Prop({ required: true, index: true }) at: Date;
  /** "ai" for now; other kinds of events can be added later. */
  @Prop({ required: true }) kind: string;
  /** What the call was for: chat, lookup, lookup-family, tense-questions, dialogue. */
  @Prop({ required: true, index: true }) action: string;
  @Prop({ default: '', index: true }) userId: string;
  @Prop({ default: '' }) email: string;
  /** The app API that led to the call, e.g. "GET /api/lookup". Empty for background work. */
  @Prop({ default: '' }) route: string;
  @Prop({ default: '' }) model: string;
  @Prop({ default: true, index: true }) ok: boolean;
  /** HTTP status from the AI provider (0 when the request never got an answer). */
  @Prop({ default: 0 }) status: number;
  @Prop({ default: 0 }) ms: number;
  @Prop({ default: 0 }) inTokens: number;
  @Prop({ default: 0 }) outTokens: number;
  /** A short hint of the input, e.g. the looked-up word. Never the full prompt. */
  @Prop({ default: '' }) detail: string;
  @Prop({ default: '' }) error: string;
}
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ at: 1 }, { expireAfterSeconds: KEEP_DAYS * 86400 });

export type AuditEntry = Omit<AuditLog, 'at' | 'userId' | 'email' | 'route'> & Partial<Pick<AuditLog, 'userId' | 'email' | 'route'>>;

/** The current request (user and route), so code deep inside a service can tell who caused an AI call. */
interface RequestInfo { userId: string; email: string; route: string }
const requestInfo = new AsyncLocalStorage<RequestInfo>();

let sink: ((e: AuditEntry) => void) | null = null;

/** Records an entry for the current request. Never throws and never waits: logging must not slow down or break the app. */
export function audit(e: AuditEntry): void {
  const r = requestInfo.getStore();
  sink?.({ ...e, userId: e.userId ?? r?.userId ?? '', email: e.email ?? r?.email ?? '', route: e.route ?? r?.route ?? '' });
}

/** Starts the per-request context. Runs before the JWT guard, so the user is filled in by the interceptor below. */
function contextMiddleware(req: Request, _res: Response, next: NextFunction) {
  requestInfo.run({ userId: '', email: '', route: req.method + ' ' + req.originalUrl.split('?')[0] }, next);
}

@Injectable()
class UserContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const store = requestInfo.getStore();
    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (store && user) { store.userId = user.sub; store.email = user.email; }
    return next.handle();
  }
}

@Injectable()
export class AuditService implements OnModuleInit {
  private readonly log = new Logger('Audit');
  constructor(@InjectModel(AuditLog.name) private readonly logs: Model<AuditLog>) {}

  onModuleInit() {
    sink = (e) => { this.logs.create({ ...e, at: new Date() }).catch((err) => this.log.warn('Could not write an audit entry: ' + String(err))); };
  }
}

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: AuditLog.name, schema: AuditLogSchema }])],
  providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: UserContextInterceptor }],
  exports: [MongooseModule]
})
export class AuditModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(contextMiddleware).forRoutes('*');
  }
}
