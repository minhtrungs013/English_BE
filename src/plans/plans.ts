import { BadRequestException, Global, HttpException, HttpStatus, Injectable, Logger, Module, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { todayKey } from '../common/day';
import { User, UserSchema } from '../users/user.schema';

/** The daily allowances a plan sets. Counts: 0 turns the feature off. tokens: 0 means no token cap. */
export const LIMIT_KEYS = ['chat', 'autofill', 'courseAi', 'tokens'] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type Limits = Record<LimitKey, number>;

/** A plan (e.g. Standard, Pro): daily limits, edited by admins. Exactly one plan is the default for users without one. */
@Schema({ collection: 'plans', timestamps: true })
export class Plan {
  @Prop({ required: true, trim: true, maxlength: 40 }) name: string;
  @Prop({ default: false }) isDefault: boolean;
  /** Chatbot messages a day. */
  @Prop({ default: 30, min: 0 }) chat: number;
  /** Auto-fills of a new word a day (only those that go past the library to AI or online dictionaries). */
  @Prop({ default: 3, min: 0 }) autofill: number;
  /** AI course generations a day (questions, dialogues, course words). */
  @Prop({ default: 30, min: 0 }) courseAi: number;
  /** AI tokens a day (in + out, all features together); 0 = no cap. */
  @Prop({ default: 0, min: 0 }) tokens: number;
}
export const PlanSchema = SchemaFactory.createForClass(Plan);

/** AI tokens a user used on a day (app time zone). Written by the audit log after every AI call. */
@Schema({ collection: 'ai_usage', versionKey: false })
export class AiUsage {
  @Prop({ required: true }) user: string;
  @Prop({ required: true }) day: string;
  @Prop({ default: 0 }) tokens: number;
  @Prop({ default: 0 }) calls: number;
  /** For the TTL index: usage older than 120 days is deleted. */
  @Prop({ default: () => new Date() }) at: Date;
}
export const AiUsageSchema = SchemaFactory.createForClass(AiUsage);
AiUsageSchema.index({ user: 1, day: 1 }, { unique: true });
AiUsageSchema.index({ at: 1 }, { expireAfterSeconds: 120 * 86400 });

export interface PlanView extends Limits { id: string; name: string; isDefault: boolean; users: number }

/** The limits that applied before plans existed (env or built-in), used for the first "Standard" plan. */
function legacyLimit(env: string, fallback: number): number {
  const n = Number(process.env[env]);
  return process.env[env] !== undefined && Number.isFinite(n) && n >= 0 ? n : fallback;
}

@Injectable()
export class PlanService implements OnApplicationBootstrap {
  private readonly log = new Logger('Plans');
  /** user id → [plan id, read at]; a minute is short enough for plan changes to apply quickly. */
  private readonly userPlan = new Map<string, [string, number]>();

  constructor(
    @InjectModel(Plan.name) private readonly plans: Model<Plan>,
    @InjectModel(AiUsage.name) private readonly usage: Model<AiUsage>,
    @InjectModel(User.name) private readonly users: Model<User>
  ) {}

  /** First start: a default "Standard" plan with the old limits and a "Pro" plan. */
  async onApplicationBootstrap(): Promise<void> {
    if (await this.plans.exists({})) return;
    await this.plans.create([
      { name: 'Standard', isDefault: true, chat: legacyLimit('CHAT_DAILY_LIMIT', 30), autofill: legacyLimit('AUTOFILL_DAILY_LIMIT', 3), courseAi: legacyLimit('COURSE_AI_DAILY_LIMIT', 30), tokens: 50_000 },
      { name: 'Pro', isDefault: false, chat: 100, autofill: 30, courseAi: 100, tokens: 300_000 }
    ]);
    this.log.log('Created the Standard (default) and Pro plans.');
  }

  private async defaultPlan() {
    return (await this.plans.findOne({ isDefault: true }).lean()) ?? (await this.plans.findOne().sort({ createdAt: 1 }).lean());
  }

  /** The user's plan: the one assigned to them, else the default plan. */
  async planOf(user: string) {
    const hit = this.userPlan.get(user);
    let id = hit && Date.now() - hit[1] < 60_000 ? hit[0] : null;
    if (id === null) {
      const u = await this.users.findById(user, { plan: 1 }).lean().catch(() => null);
      id = (u as { plan?: string } | null)?.plan ?? '';
      this.userPlan.set(user, [id, Date.now()]);
    }
    const p = id ? await this.plans.findById(id).lean().catch(() => null) : null;
    return p ?? (await this.defaultPlan());
  }

  async limit(user: string, key: LimitKey): Promise<number> {
    const p = await this.planOf(user);
    return p ? p[key] : 0;
  }

  async tokensToday(user: string): Promise<number> {
    const u = await this.usage.findOne({ user, day: todayKey() }, { tokens: 1 }).lean();
    return u?.tokens ?? 0;
  }

  /** Throws 429 when the user has used today's AI tokens. */
  async assertTokens(user: string): Promise<void> {
    const cap = await this.limit(user, 'tokens');
    if (!cap) return;
    if ((await this.tokensToday(user)) >= cap) {
      throw new HttpException({ statusCode: 429, error: 'Daily limit reached', message: 'Bạn đã dùng hết lượt AI hôm nay. Hẹn bạn ngày mai nhé!' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** Called after every AI call. */
  async addTokens(user: string, tokens: number): Promise<void> {
    if (!user) return;
    await this.usage.updateOne({ user, day: todayKey() }, { $inc: { tokens, calls: 1 }, $setOnInsert: { at: new Date() } }, { upsert: true });
  }

  /** Today's tokens for several users (admin user list). */
  async tokensTodayFor(users: string[]): Promise<Map<string, number>> {
    const rows = await this.usage.find({ user: { $in: users }, day: todayKey() }, { user: 1, tokens: 1 }).lean();
    return new Map(rows.map((r) => [r.user, r.tokens]));
  }

  /* ---------- admin ---------- */

  async list(): Promise<PlanView[]> {
    const [plans, counts] = await Promise.all([
      this.plans.find().sort({ createdAt: 1 }).lean(),
      this.users.aggregate<{ _id: string; n: number }>([{ $group: { _id: { $ifNull: ['$plan', ''] }, n: { $sum: 1 } } }])
    ]);
    const n = new Map(counts.map((c) => [c._id, c.n]));
    const ids = new Set(plans.map((p) => String(p._id)));
    // Users with no plan, or with a plan that was deleted, are on the default plan.
    const onDefault = counts.filter((c) => !c._id || !ids.has(c._id)).reduce((s, c) => s + c.n, 0);
    return plans.map((p) => ({
      id: String(p._id), name: p.name, isDefault: p.isDefault, chat: p.chat, autofill: p.autofill, courseAi: p.courseAi, tokens: p.tokens,
      users: (n.get(String(p._id)) ?? 0) + (p.isDefault ? onDefault : 0)
    }));
  }

  async create(dto: Partial<Limits> & { name: string }): Promise<PlanView[]> {
    if (await this.plans.exists({ name: dto.name })) throw new BadRequestException('A plan with this name already exists.');
    await this.plans.create({ ...dto, isDefault: false });
    return this.list();
  }

  async update(id: string, dto: Partial<Limits> & { name?: string; isDefault?: boolean }): Promise<PlanView[]> {
    if (dto.name && (await this.plans.exists({ name: dto.name, _id: { $ne: id } }))) throw new BadRequestException('A plan with this name already exists.');
    if (dto.isDefault === false) throw new BadRequestException('Make another plan the default instead.');
    const p = await this.plans.findByIdAndUpdate(id, { $set: dto }, { new: true, runValidators: true });
    if (!p) throw new NotFoundException('Plan not found.');
    if (dto.isDefault) await this.plans.updateMany({ _id: { $ne: id } }, { $set: { isDefault: false } });
    return this.list();
  }

  /** Users on a deleted plan go back to the default plan. The default plan can't be deleted. */
  async remove(id: string): Promise<PlanView[]> {
    const p = await this.plans.findById(id);
    if (!p) throw new NotFoundException('Plan not found.');
    if (p.isDefault) throw new BadRequestException('The default plan can’t be deleted. Make another plan the default first.');
    await p.deleteOne();
    await this.users.updateMany({ plan: id }, { $set: { plan: '' } });
    this.userPlan.clear();
    return this.list();
  }

  async setUserPlan(user: string, plan: string): Promise<void> {
    if (plan && !(await this.plans.exists({ _id: plan }))) throw new NotFoundException('Plan not found.');
    const r = await this.users.updateOne({ _id: user }, { $set: { plan } });
    if (!r.matchedCount) throw new NotFoundException('User not found.');
    this.userPlan.delete(user);
  }
}

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: Plan.name, schema: PlanSchema }, { name: AiUsage.name, schema: AiUsageSchema }, { name: User.name, schema: UserSchema }])],
  providers: [PlanService],
  exports: [PlanService]
})
export class PlanModule {}
