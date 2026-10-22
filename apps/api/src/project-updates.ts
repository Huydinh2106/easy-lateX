import type { Notification, Pool, PoolClient } from 'pg';

const CHANNEL = 'easy_latex_project_changed';
interface Listener { changed(): void; disconnected(): void; }

/** One LISTEN connection per API instance; database commit is the publication boundary. */
export class ProjectUpdates {
  private client: PoolClient | null = null;
  private connecting: Promise<void> | null = null;
  private closed = false;
  private disconnect: (() => void) | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();
  constructor(private readonly pool: Pool) {}

  async start(): Promise<void> {
    if (this.closed) throw new Error('Updates are closed');
    if (this.client) return;
    if (!this.connecting) this.connecting = this.connect().finally(() => { this.connecting = null; });
    await this.connecting;
  }

  private async connect(): Promise<void> {
    const client = await this.pool.connect();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (this.client === client) { this.client = null; this.disconnect = null; }
      client.release(true);
      for (const group of [...this.listeners.values()]) for (const listener of [...group]) listener.disconnected();
    };
    client.on('error', release);
    client.on('end', release);
    client.on('notification', (event: Notification) => {
      if (event.channel !== CHANNEL || !event.payload) return;
      for (const listener of [...(this.listeners.get(event.payload) ?? [])]) listener.changed();
    });
    try {
      await client.query(`LISTEN ${CHANNEL}`);
      if (this.closed || released) throw new Error('Updates are closed');
      this.client = client;
      this.disconnect = release;
    } catch (error) { release(); throw error; }
  }

  subscribe(projectId: string, listener: Listener): () => void {
    const group = this.listeners.get(projectId) ?? new Set<Listener>();
    group.add(listener); this.listeners.set(projectId, group);
    return () => { group.delete(listener); if (!group.size) this.listeners.delete(projectId); };
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.connecting?.catch(() => undefined);
    for (const group of [...this.listeners.values()]) for (const listener of [...group]) listener.disconnected();
    this.listeners.clear();
    this.disconnect?.();
  }
}
