import type { ProjectUpdateEvent } from '@easy-latex/shared-types';

/** Authenticated SSE lives in main; no account token crosses the preload bridge. */
export class ProjectEventStream {
  private readonly lifetime = new AbortController();
  constructor(private readonly apiUrl: string, private readonly projectId: string,
    private readonly accessToken: () => Promise<string>, private readonly notify: (event: ProjectUpdateEvent) => void) {}

  stop(): void { this.lifetime.abort(); }
  private emit(type: ProjectUpdateEvent['type'],commitSha?:string|null): void {
    if (!this.lifetime.signal.aborted) this.notify({ projectId: this.projectId, type,...(commitSha===undefined?{}:{commitSha}) });
  }
  private delay(ms: number): Promise<void> {
    if (this.lifetime.signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
      const finish = () => { clearTimeout(timer); this.lifetime.signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, ms);
      this.lifetime.signal.addEventListener('abort', finish, { once: true });
    });
  }

  async run(): Promise<void> {
    let retry = 1000;
    while (!this.lifetime.signal.aborted) {
      const connection = new AbortController();
      const abort = () => connection.abort();
      this.lifetime.signal.addEventListener('abort', abort, { once: true });
      let timeout = setTimeout(abort, 15_000);
      const resetTimeout = () => { clearTimeout(timeout); timeout = setTimeout(abort, 45_000); };
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const token = await this.accessToken();
        if (this.lifetime.signal.aborted) break;
        const response = await fetch(`${this.apiUrl.replace(/\/$/, '')}/projects/${this.projectId}/events`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal: connection.signal
        });
        if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
          await response.body?.cancel(); throw new Error('Live updates unavailable');
        }
        reader = response.body.getReader();
        resetTimeout();
        const decoder = new TextDecoder();
        let buffer = '';
        let event = '';
        let data = '';
        while (!this.lifetime.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          resetTimeout();
          buffer += decoder.decode(chunk.value, { stream: true });
          if (buffer.length + data.length > 64 * 1024) throw new Error('Invalid live update');
          let newline: number;
          while ((newline = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newline).replace(/\r$/, '');
            buffer = buffer.slice(newline + 1);
            if (!line) {
              if (data && (event === 'ready' || event === 'changed')) {
                const value: unknown = JSON.parse(data);
                if (value && typeof value === 'object' && 'projectId' in value && value.projectId === this.projectId) {
                  retry = 1000; this.emit(event === 'ready' ? 'connected' : 'changed','commitSha' in value&&(typeof value.commitSha==='string'||value.commitSha===null)?value.commitSha:undefined);
                }
              }
              event = ''; data = '';
            } else if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trimStart();
          }
        }
      } catch { /* Reconnect with a fresh session token and reload the authoritative snapshot. */ }
      finally {
        clearTimeout(timeout); connection.abort();
        await reader?.cancel().catch(() => undefined);
        this.lifetime.signal.removeEventListener('abort', abort);
      }
      if (this.lifetime.signal.aborted) break;
      this.emit('disconnected');
      await this.delay(retry);
      retry = Math.min(retry * 2, 15_000);
    }
  }
}
