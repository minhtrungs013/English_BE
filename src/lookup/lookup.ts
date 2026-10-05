import { Controller, Get, Injectable, Logger, Module, NotFoundException, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { UserId } from '../auth/auth.decorators';
import { POS_LIST, type Level } from '../common/constants';
import { LibraryModule } from '../library/library.module';
import { LibraryService } from '../library/library.service';
import { WordsModule } from '../words/words.module';
import { aiLookup } from './ai';
import { WordsService } from '../words/words.service';
import { BUILTIN_DICT } from './builtin-dict';

export interface LookupResult {
  source: 'collection' | 'library' | 'builtin' | 'ai' | 'online';
  ipa?: string; pos?: string; meaning?: string; vi?: string; ex?: string;
  syn?: string[]; ant?: string[]; level?: Level;
}

interface DictDefinition { definition?: string; example?: string; synonyms?: string[]; antonyms?: string[] }
interface DictMeaning { partOfSpeech?: string; definitions?: DictDefinition[]; synonyms?: string[]; antonyms?: string[] }
interface DictEntry { phonetic?: string; phonetics?: { text?: string }[]; meanings?: DictMeaning[] }

async function getJson<T>(url: string, ms = 8000): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

function uniq(list: string[], max: number): string[] {
  const out: string[] = [];
  for (const x of list) if (x && !out.some((o) => o.toLowerCase() === x.toLowerCase())) out.push(x);
  return out.slice(0, max);
}

export class LookupQuery {
  @IsString() @IsNotEmpty() @MaxLength(80) word: string;
}

@Injectable()
export class LookupService {
  private readonly log = new Logger('Lookup');

  constructor(
    private readonly words: WordsService,
    private readonly library: LibraryService,
    private readonly config: ConfigService
  ) {}

  /**
   * Your own words first, then the shared library and the built-in list (free and instant),
   * then OpenAI when OPENAI_API_KEY is set, then free online dictionaries.
   */
  async lookup(user: string, raw: string): Promise<LookupResult | null> {
    const word = raw.trim();
    const lw = word.toLowerCase();
    const mine = await this.words.findByWord(user, word);
    if (mine) {
      return { source: 'collection', ipa: mine.ipa, pos: mine.pos, meaning: mine.meaning, vi: mine.vi, ex: mine.ex, syn: mine.syn, ant: mine.ant, level: mine.level as Level };
    }
    const lib = await this.library.findByWord(lw);
    if (lib) return { source: 'library', ipa: lib.ipa, pos: lib.pos, meaning: lib.meaning, vi: lib.vi, ex: lib.ex, syn: lib.syn, ant: lib.ant, level: lib.level as Level };
    const b = BUILTIN_DICT[lw];
    if (b) return { source: 'builtin', ipa: b[0], pos: b[1], meaning: b[2], vi: b[3], ex: b[4], syn: b[5], ant: b[6], level: b[7] };

    const key = this.config.get<string>('OPENAI_API_KEY');
    if (key) {
      const ai = await aiLookup(word, key, this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini'));
      if (ai) return { source: 'ai', ...ai };
      this.log.warn('AI lookup gave no result for a word; using the free dictionary instead.');
    }

    const [dict, vi] = await Promise.all([this.fromDictionary(word), this.translateVi(word)]);
    if (!dict && !vi) return null;
    return { source: 'online', ...(dict ?? {}), ...(vi ? { vi } : {}) };
  }

  /** Free English dictionary: https://dictionaryapi.dev */
  private async fromDictionary(word: string): Promise<Omit<LookupResult, 'source'> | null> {
    const data = await getJson<DictEntry[]>('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word));
    if (!Array.isArray(data) || !data.length) return null;
    const e = data[0];
    const m = (e.meanings ?? [])[0];
    if (!m) return null;
    const defs = m.definitions ?? [];
    const allDefs = data.flatMap((x) => (x.meanings ?? []).flatMap((mm) => mm.definitions ?? []));
    const p = (m.partOfSpeech ?? '').toLowerCase();
    const posName = p.charAt(0).toUpperCase() + p.slice(1);
    return {
      ipa: e.phonetic || (e.phonetics ?? []).find((x) => x.text)?.text || '',
      pos: (POS_LIST as readonly string[]).includes(posName) ? posName : 'Other',
      meaning: defs[0]?.definition ?? '',
      ex: defs.find((d) => d.example)?.example ?? allDefs.find((d) => d.example)?.example ?? '',
      syn: uniq([...(m.synonyms ?? []), ...defs.flatMap((d) => d.synonyms ?? [])], 5),
      ant: uniq([...(m.antonyms ?? []), ...defs.flatMap((d) => d.antonyms ?? [])], 5)
    };
  }

  /** Free translation memory: https://mymemory.translated.net */
  private async translateVi(word: string): Promise<string> {
    const data = await getJson<{ responseData?: { translatedText?: string } }>(
      'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(word) + '&langpair=en|vi'
    );
    const t = data?.responseData?.translatedText?.trim() ?? '';
    return t && t.toLowerCase() !== word.toLowerCase() ? t : '';
  }
}

@ApiTags('lookup')
@ApiBearerAuth()
@Controller('lookup')
export class LookupController {
  constructor(private readonly lookup: LookupService) {}

  /** Auto-fill details for a word: GET /api/lookup?word=resilient (limited, since it can call a paid AI API) */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get()
  async find(@UserId() user: string, @Query() q: LookupQuery) {
    const res = await this.lookup.lookup(user, q.word);
    if (!res) throw new NotFoundException('No details found for “' + q.word.trim() + '”.');
    return res;
  }
}

@Module({
  imports: [WordsModule, LibraryModule],
  controllers: [LookupController],
  providers: [LookupService]
})
export class LookupModule {}
