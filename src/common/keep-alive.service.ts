import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Keeps a free Render instance awake: Render stops a service after 15 minutes without incoming requests, and the
 * next visitor waits for it to start again. Every few minutes this calls the app's own public /api/health, which
 * goes through Render's proxy and counts as traffic.
 *
 * URL: KEEP_ALIVE_URL, else RENDER_EXTERNAL_URL (set by Render) + /api/health. Off when neither is set (local dev)
 * or KEEP_ALIVE_MINUTES=0.
 */
@Injectable()
export class KeepAliveService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(KeepAliveService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly config: ConfigService) {}

  onApplicationBootstrap(): void {
    const base = this.config.get<string>('RENDER_EXTERNAL_URL');
    const url = this.config.get<string>('KEEP_ALIVE_URL') || (base ? base.replace(/\/+$/, '') + '/api/health' : '');
    const minutes = Number(this.config.get('KEEP_ALIVE_MINUTES', 10));
    if (!url || !(minutes > 0)) return;
    this.timer = setInterval(() => void this.ping(url), minutes * 60_000);
    this.timer.unref();
    this.log.log('Pinging ' + url + ' every ' + minutes + ' minutes.');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async ping(url: string): Promise<void> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) this.log.warn('Keep-alive got ' + res.status);
    } catch (e) {
      this.log.warn('Keep-alive failed: ' + (e as Error).message);
    }
  }
}
