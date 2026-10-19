import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface Encryption { available(): boolean; encrypt(value: string): Buffer; decrypt(value: Buffer): string; }
export class SecureSessionStorage {
  private values: Record<string,string> = {};
  private loaded = false;
  private dirty = false;
  private readonly pending = new Map<string,string|null>();
  private operations: Promise<unknown> = Promise.resolve();
  constructor(private readonly filename: string, private readonly encryption: Encryption) {}
  persistent(): boolean { return this.encryption.available(); }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.catch(() => undefined).then(operation);
    this.operations = result;
    return result;
  }
  private async load(): Promise<void> {
    // An unavailable key store must not permanently cache an empty session.
    if (this.loaded || !this.encryption.available()) return;
    try {
      const encoded = await readFile(this.filename,'utf8');
      const parsed: unknown = JSON.parse(this.encryption.decrypt(Buffer.from(encoded,'base64')));
      if (parsed && typeof parsed === 'object' && Object.values(parsed).every(v => typeof v === 'string')) this.values = parsed as Record<string,string>;
    } catch { this.values = {}; }
    // Sign-in or sign-out performed in memory takes precedence over disk.
    for (const [key,value] of this.pending) {
      if (value === null) delete this.values[key];
      else this.values[key] = value;
    }
    this.pending.clear();
    this.loaded = true;
  }
  getItem(key: string): Promise<string|null> {
    return this.serial(async () => {
      await this.load();
      if (this.dirty) await this.persist();
      return this.values[key] ?? null;
    });
  }
  setItem(key: string, value: string): Promise<void> {
    return this.serial(async () => {
      await this.load(); this.values[key] = value;
      if (!this.loaded) this.pending.set(key,value);
      this.dirty = true; await this.persist();
    });
  }
  removeItem(key: string): Promise<void> {
    return this.serial(async () => {
      await this.load(); delete this.values[key];
      if (!this.loaded) this.pending.set(key,null);
      this.dirty = true; await this.persist();
    });
  }
  clear(): Promise<void> {
    return this.serial(async () => {
      // Do not require decryption to sign out. Serialized deletion also prevents
      // an earlier encrypted write from restoring credentials after sign-out.
      this.values = {}; this.pending.clear(); this.loaded = true; this.dirty = false;
      await rm(this.filename,{force:true});
      await rm(`${this.filename}.tmp`,{force:true});
    });
  }
  private async persist(): Promise<void> {
    // Never fall back to plaintext, or overwrite unread saved values.
    if (!this.loaded || !this.encryption.available()) return;
    const content = this.encryption.encrypt(JSON.stringify(this.values)).toString('base64');
    await mkdir(path.dirname(this.filename),{recursive:true});
    await writeFile(`${this.filename}.tmp`,content,{mode:0o600});
    await rename(`${this.filename}.tmp`,this.filename);
    this.dirty = false;
  }
}
