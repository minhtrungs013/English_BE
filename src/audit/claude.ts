import { audit } from './audit';

const URL = 'https://api.anthropic.com/v1/messages';

interface Usage { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }

/**
 * Calls Claude's Messages API like fetch() and writes an audit entry for the call: the action, model, status, time and tokens.
 * `body` is the request body (it's sent as JSON). For streamed calls the tokens are read from a copy of the stream,
 * so the caller reads the response exactly as before.
 */
export async function claudeFetch(
  action: string,
  key: string,
  body: Record<string, unknown>,
  opts: { signal?: AbortSignal; detail?: string } = {}
): Promise<Response> {
  const started = Date.now();
  const model = typeof body.model === 'string' ? body.model : '';
  const detail = (opts.detail ?? '').slice(0, 120);
  const base = { kind: 'ai', action, model, detail };
  let res: Response;
  try {
    res = await fetch(URL, {
      method: 'POST',
      signal: opts.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    const aborted = e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
    audit({ ...base, ok: false, status: 0, ms: Date.now() - started, inTokens: 0, outTokens: 0, error: aborted ? e.name : String(e).slice(0, 300) });
    throw e;
  }
  const done = (usage: Usage, error = '') => audit({
    ...base, ok: res.ok && !error, status: res.status, ms: Date.now() - started,
    inTokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    outTokens: usage.output_tokens ?? 0, error
  });

  const copy = res.clone();
  if (!res.ok) {
    void copy.text().then((t) => done({}, errorMessage(t)), () => done({}, 'HTTP ' + res.status));
  } else if (body.stream) {
    void readStreamUsage(copy).then((u) => done(u.usage, u.error), (e) => done({}, String(e).slice(0, 300)));
  } else {
    void copy.json().then((j: { usage?: Usage; stop_reason?: string }) => done(j.usage ?? {}, j.stop_reason === 'refusal' ? 'refusal' : ''), () => done({}));
  }
  return res;
}

/** Reads the usage out of a streamed answer: input tokens arrive in message_start, output tokens in message_delta. */
async function readStreamUsage(res: Response): Promise<{ usage: Usage; error: string }> {
  const usage: Usage = {};
  let error = '';
  if (!res.body) return { usage, error };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      let ev: { type?: string; message?: { usage?: Usage }; usage?: Usage; error?: { message?: string } };
      try { ev = JSON.parse(line.slice(5)); } catch { continue; }
      if (ev.type === 'message_start' && ev.message?.usage) Object.assign(usage, ev.message.usage);
      else if (ev.type === 'message_delta' && ev.usage) Object.assign(usage, ev.usage);
      else if (ev.type === 'error') error = (ev.error?.message ?? 'stream error').slice(0, 300);
    }
  }
  return { usage, error };
}

/** Claude's error message from an error body ({"error":{"type","message"}}), or the start of the body. */
function errorMessage(text: string): string {
  try {
    const e = (JSON.parse(text) as { error?: { type?: string; message?: string } }).error;
    if (e?.message) return ((e.type ? e.type + ': ' : '') + e.message).slice(0, 300);
  } catch { /* not JSON */ }
  return text.slice(0, 300);
}
