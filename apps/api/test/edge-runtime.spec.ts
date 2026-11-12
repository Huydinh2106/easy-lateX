import { describe, expect, it } from 'vitest';
import { edgeDatabaseConfiguration } from '../src/edge-runtime';

describe('Edge database connection configuration', () => {
  it('keeps cloud TLS certificate verification enabled', () => {
    const configuration = edgeDatabaseConfiguration('postgresql://postgres.example:password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full');
    expect(configuration.ssl).toEqual({rejectUnauthorized: true});
    expect(new URL(configuration.connectionString).searchParams.has('sslmode')).toBe(false);
    expect(configuration.max).toBe(3);
  });

  it('rejects transaction pooling because live updates need a persistent session', () => {
    expect(() => edgeDatabaseConfiguration('postgresql://postgres.example:password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres')).toThrow('transaction pooler');
    expect(() => edgeDatabaseConfiguration('postgresql://postgres:password@db.example.supabase.co:5432/postgres?pgbouncer=true')).toThrow('transaction pooler');
  });

  it('rejects cloud URL options that disable certificate verification', () => {
    for (const mode of ['disable', 'no-verify']) {
      expect(() => edgeDatabaseConfiguration(`postgresql://postgres:password@db.example.supabase.co:5432/postgres?sslmode=${mode}`)).toThrow('certificate verification');
    }
  });

  it('upgrades platform sslmode defaults to verified TLS', () => {
    for (const mode of ['prefer', 'require']) {
      const configuration = edgeDatabaseConfiguration(`postgresql://postgres:password@db.example.supabase.co:5432/postgres?sslmode=${mode}`);
      expect(configuration.ssl).toEqual({rejectUnauthorized: true});
      expect(new URL(configuration.connectionString).searchParams.has('sslmode')).toBe(false);
    }
  });

  it('supports a local PostgreSQL fixture without TLS', () => {
    expect(edgeDatabaseConfiguration('postgresql://postgres:postgres@127.0.0.1:54322/postgres')).not.toHaveProperty('ssl');
  });

  it('accepts an explicit trusted CA while retaining peer verification', () => {
    const ca = '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----';
    const configuration = edgeDatabaseConfiguration('postgresql://postgres:password@db.example.supabase.co:5432/postgres', Buffer.from(ca).toString('base64'));
    expect(configuration.ssl).toEqual({rejectUnauthorized: true, ca});
    expect(() => edgeDatabaseConfiguration('postgresql://postgres:password@db.example.supabase.co:5432/postgres', 'invalid')).toThrow('CA certificate');
  });
});
