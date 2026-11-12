function parseDatabaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('A valid PostgreSQL connection URL is required'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new Error('A PostgreSQL URL with a host and database name is required');
  }
  return url;
}

/** Session pooling/direct connections are required; certificate verification is never disabled. */
export function createSupabasePoolConfig(value, { projectRef, ca } = {}) {
  if (!/^[a-z0-9]{20}$/.test(projectRef ?? '')) throw new Error('A valid 20-character Supabase project reference is required');
  const url = parseDatabaseUrl(value);
  const direct = url.hostname === `db.${projectRef}.supabase.co`;
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname)
    && decodeURIComponent(url.username) === `postgres.${projectRef}`;
  if (!direct && !pooler) throw new Error('Cloud database must be the selected Supabase project direct or session-pooler endpoint');
  if ((url.port || '5432') !== '5432') throw new Error('Use Supabase direct/session-pooler port 5432 for database migration');
  const mode = url.searchParams.get('sslmode');
  if (mode && !['require', 'verify-ca', 'verify-full'].includes(mode)) throw new Error('Cloud database requires verified TLS');
  for (const key of url.searchParams.keys()) {
    if ((key !== 'sslmode' && /^(ssl|uselibpqcompat)/i.test(key)) || key === 'options') throw new Error('Pass TLS options through EASY_LATEX_SUPABASE_CA_CERT, not connection URL parameters');
  }
  // pg connectionString SSL options otherwise override its ssl object.
  url.searchParams.delete('sslmode');
  return {
    connectionString: url.href,
    max: 1,
    connectionTimeoutMillis: 15_000,
    ssl: { rejectUnauthorized: true, servername: url.hostname, ...(ca ? { ca } : {}) },
  };
}
