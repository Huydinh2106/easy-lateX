import { Buffer } from 'node:buffer';

export type EdgeEnvironment = Record<string, string | undefined>;

/** Session mode preserves LISTEN/NOTIFY across live collaboration requests. */
export function edgeDatabaseConfiguration(connectionString: string, caBase64?: string) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.port === '6543' || url.searchParams.get('pgbouncer') === 'true') {
    throw new Error('DATABASE_URL must use a direct or session-mode PostgreSQL connection (port 5432), never a transaction pooler.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]', 'db'].includes(url.hostname);
  const sslmode = url.searchParams.get('sslmode');
  if (!local && sslmode && !['prefer', 'require', 'verify-full', 'verify-ca'].includes(sslmode)) {
    throw new Error('Use sslmode=verify-full for the cloud database; certificate verification must stay enabled.');
  }
  // pg connection-string SSL options can override the explicit TLS object.
  // Remove them after validation, then always verify remote certificates.
  for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
  let ca: string | undefined;
  if (caBase64) {
    const bytes = Buffer.from(caBase64, 'base64');
    ca = bytes.toString('utf8');
    if (bytes.toString('base64') !== caBase64 || !ca.includes('-----BEGIN CERTIFICATE-----')) {
      throw new Error('EASY_LATEX_DATABASE_CA_BASE64 must contain the database CA certificate');
    }
  }
  return {
    connectionString: url.toString(),
    max: 3,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 20_000,
    ...(local ? {} : { ssl: { rejectUnauthorized: true, ...(ca ? {ca} : {}) } }),
  };
}
