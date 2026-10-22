import { BadRequestException, Body, Controller, Get, HttpException, HttpStatus, Injectable, Logger, Module, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, MaxLength, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { UserId } from '../auth/auth.decorators';
import type { Level } from '../common/constants';
import type { FamilyMember } from '../common/family';
import { LibraryModule } from '../library/library.module';
import { LibraryService } from '../library/library.service';
import { LookupModule, LookupService } from '../lookup/lookup';
import { ProfileModule } from '../profile/profile.module';
import { ProfileService } from '../profile/profile.service';
import { WordsModule } from '../words/words.module';
import { WordsService } from '../words/words.service';
import { AiError, aiRound, aiStream, CHAT_LESSONS, SYSTEM, type ChatMessage, type ToolCall } from './chat.ai';
import { fakePlan, fakeText } from './chat.fake';

/** Longest question the user may send; earlier turns may be longer (the bot's answers). */
const MAX_QUESTION = 500;
/** Turns of history sent to the model (user + assistant messages). */
const HISTORY = 6;
/** The bot's earlier answers are cut to this many characters: the gist is enough for context. */
const OLD_ANSWER = 600;
const MAX_CARDS = 3;

export class ChatMessageDto {
  @IsIn(['user', 'assistant']) role: 'user' | 'assistant';
  @IsString() @MaxLength(3000) content: string;
}

export class ChatDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => ChatMessageDto)
  messages: ChatMessageDto[];
}

/**
 * A word card. Its data and status come from the server (library / the user's words / dictionary),
 * never from the model's text. `id` is my word's id (status "mine") or the library word's id ("library").
 */
export interface WordCard {
  word: string; ipa: string; pos: string; meaning: string; vi: string; ex: string; level: Level | ''; family: FamilyMember[];
  status: 'mine' | 'library' | 'new'; id?: string;
}

/** Events sent to the client, one per SSE `data:` line. */
type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'word'; card: WordCard }
  | { type: 'notfound'; word: string }
  | { type: 'grammar'; lesson: { id: string; name: string; vi: string } }
  | { type: 'done'; quota: { used: number; limit: number } }
  | { type: 'error'; message: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class ChatService {
  private readonly log = new Logger('Chat');

  constructor(
    private readonly config: ConfigService,
    private readonly profile: ProfileService,
    private readonly words: WordsService,
    private readonly library: LibraryService,
    private readonly lookup: LookupService
  ) {}

  /** Test mode: CHAT_FAKE=1, or no OpenAI key at all. */
  get fake(): boolean {
    // return this.config.get<string>('CHAT_FAKE') === '1' || !this.config.get<string>('OPENAI_API_KEY');
    return this.config.get<string>('CHAT_FAKE') === '1' || !this.config.get<string>('ANTHROPIC_API_KEY');
  }

  status(user: string) {
    return this.profile.dailyStatus(user, 'chat').then((q) => ({ ...q, fake: this.fake }));
  }

  /** The user's words, then the library, then the dictionary (AI or free online). Null when nothing is found. */
  async findWord(user: string, raw: string): Promise<WordCard | null> {
    const word = raw.trim().slice(0, 60);
    if (!word) return null;
    const mine = await this.words.findByWord(user, word);
    if (mine) {
      return { word: mine.word, ipa: mine.ipa, pos: mine.pos, meaning: mine.meaning, vi: mine.vi, ex: mine.ex, level: mine.level as Level, family: mine.toObject().family ?? [], status: 'mine', id: String(mine._id) };
    }
    const lib = await this.library.findByWord(word.toLowerCase());
    if (lib) {
      return { word: lib.word, ipa: lib.ipa, pos: lib.pos, meaning: lib.meaning, vi: lib.vi, ex: lib.ex, level: lib.level as Level, family: lib.toObject().family ?? [], status: 'library', id: String(lib._id) };
    }
    // In test mode, skip OpenAI (the key may be out of credit) and use the free dictionaries.
    const ext = this.fake ? await this.lookup.external(word, { noAi: true }) : await this.lookup.external(word);
    if (!ext?.meaning && !ext?.vi) return null;
    return { word, ipa: ext.ipa ?? '', pos: ext.pos ?? '', meaning: ext.meaning ?? '', vi: ext.vi ?? '', ex: ext.ex ?? '', level: ext.level ?? '', family: ext.family ?? [], status: 'new' };
  }

  /** Runs one tool for the model: sends its card/button to the client and returns what the model gets to read. */
  private async runTool(user: string, call: { name: string; args: string }, send: (e: ChatEvent) => void, cards: { n: number }): Promise<string> {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(call.args || '{}') as Record<string, unknown>; } catch { return JSON.stringify({ error: 'bad arguments' }); }
    if (call.name === 'lookup_word') {
      const word = typeof args.word === 'string' ? args.word : '';
      if (cards.n >= MAX_CARDS) return JSON.stringify({ error: 'too many words in one answer' });
      cards.n++;
      const card = await this.findWord(user, word);
      if (!card) { send({ type: 'notfound', word: word.slice(0, 60) }); return JSON.stringify({ found: false }); }
      send({ type: 'word', card });
      return JSON.stringify({ found: true, word: card.word, pos: card.pos, meaning: card.meaning, vi: card.vi, level: card.level, in_my_vocab: card.status === 'mine', in_library: card.status !== 'new' });
    }
    if (call.name === 'open_grammar') {
      const l = CHAT_LESSONS.find((x) => x.id === args.lesson);
      if (!l) return JSON.stringify({ error: 'unknown lesson' });
      send({ type: 'grammar', lesson: l });
      return JSON.stringify({ shown: true, lesson: l.name });
    }
    return JSON.stringify({ error: 'unknown tool' });
  }

  async chat(user: string, input: ChatMessage[], send: (e: ChatEvent) => void, signal: AbortSignal): Promise<void> {
    const last = input[input.length - 1];
    if (last.role !== 'user' || !last.content.trim()) throw new BadRequestException('The last message must be your question.');
    if (last.content.length > MAX_QUESTION) throw new BadRequestException('Please keep your question under ' + MAX_QUESTION + ' characters.');
    if (!(await this.profile.useDaily(user, 'chat'))) {
      const { limit } = await this.profile.dailyStatus(user, 'chat');
      throw new HttpException({ statusCode: 429, error: 'Daily limit reached', message: limit ? 'Bạn đã dùng hết ' + limit + ' tin nhắn hôm nay. Hẹn bạn ngày mai nhé!' : 'Gói của bạn chưa bao gồm trợ lý AI.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const history = input.slice(-HISTORY).map((m) => ({ role: m.role, content: m.content.slice(0, m.role === 'assistant' ? OLD_ANSWER : 3000) }));
    const cards = { n: 0 };

    if (this.fake) {
      const plan = fakePlan(last.content);
      const found: WordCard[] = [];
      for (const w of plan.words) {
        const c = await this.findWord(user, w);
        if (c) { found.push(c); send({ type: 'word', card: c }); } else send({ type: 'notfound', word: w });
      }
      const lesson = plan.lesson ? CHAT_LESSONS.find((l) => l.id === plan.lesson) ?? null : null;
      if (lesson) send({ type: 'grammar', lesson });
      // Stream the canned text a few words at a time, like the real thing.
      const pieces = fakeText(found, lesson).match(/\S+\s*/g) ?? [];
      for (let i = 0; i < pieces.length && !signal.aborted; i += 3) { send({ type: 'text', text: pieces.slice(i, i + 3).join('') }); await sleep(40); }
      return;
    }

    // const key = this.config.get<string>('OPENAI_API_KEY')!;
    const key = this.config.get<string>('ANTHROPIC_API_KEY')!;
    // const model = this.config.get<string>('CHAT_MODEL') || this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini');
    const model = this.config.get<string>('CHAT_MODEL') || this.config.get<string>('ANTHROPIC_MODEL', 'claude-haiku-4-5');
    const messages: { role: string; content?: string | null; tool_calls?: unknown; tool_call_id?: string }[] = [{ role: 'system', content: SYSTEM }, ...history];
    try {
      // Up to two rounds of tool calls, then the streamed answer.
      for (let round = 0; round < 2; round++) {
        const r = await aiRound(messages, key, model, signal);
        if (!r.calls.length) {
          // Answered without tools: send it in pieces so it still appears gradually.
          for (const p of r.content.match(/\S+\s*/g) ?? []) send({ type: 'text', text: p });
          return;
        }
        messages.push(r.message);
        for (const c of r.calls.slice(0, 4) as ToolCall[]) {
          messages.push({ role: 'tool', tool_call_id: c.id, content: await this.runTool(user, c, send, cards) });
        }
        for (const c of r.calls.slice(4) as ToolCall[]) messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify({ error: 'skipped' }) });
      }
      await aiStream(messages, key, model, signal, (text) => send({ type: 'text', text }));
    } catch (e) {
      if (signal.aborted) return;
      this.log.warn(e instanceof AiError ? e.message : 'Chat failed: ' + String(e));
      send({ type: 'error', message: e instanceof AiError && e.status === 429 ? 'Trợ lý AI đang quá tải hoặc hết hạn mức. Bạn thử lại sau nhé.' : 'Không kết nối được trợ lý AI. Bạn thử lại sau nhé.' });
    }
  }
}

@ApiTags('chat')
@ApiBearerAuth()
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** Today's message count and limit: GET /api/chat */
  @Get()
  status(@UserId() user: string) {
    return this.chat.status(user);
  }

  /**
   * Ask the assistant: POST /api/chat with the recent messages. The answer streams back as server-sent events
   * (`data: {"type":"text"|"word"|"notfound"|"grammar"|"done"|"error", ...}`). Limit and validation errors are plain JSON.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  async ask(@UserId() user: string, @Body() dto: ChatDto, @Res() res: Response) {
    const abort = new AbortController();
    let started = false;
    const send = (e: ChatEvent) => {
      if (!started) {
        started = true;
        res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
      }
      res.write('data: ' + JSON.stringify(e) + '\n\n');
    };
    res.on('close', () => { if (!res.writableFinished) abort.abort(); });
    try {
      await this.chat.chat(user, dto.messages, send, abort.signal);
    } catch (e) {
      if (!started) {
        const status = e instanceof HttpException ? e.getStatus() : 500;
        const body = e instanceof HttpException ? e.getResponse() : { statusCode: 500, message: 'Something went wrong.' };
        res.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
        return;
      }
      send({ type: 'error', message: 'Đã có lỗi. Bạn thử lại sau nhé.' });
    }
    const { used, limit } = await this.chat.status(user);
    send({ type: 'done', quota: { used, limit } });
    res.end();
  }
}

@Module({
  imports: [ProfileModule, WordsModule, LibraryModule, LookupModule],
  controllers: [ChatController],
  providers: [ChatService]
})
export class ChatModule {}
