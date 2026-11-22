import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';

dotenv.config();
dotenv.config({ path: resolve(process.cwd(), '../../.env') });

const isRemoteDb = Boolean(
  process.env.DATABASE_URL &&
  !process.env.DATABASE_URL.includes('localhost') &&
  !process.env.DATABASE_URL.includes('127.0.0.1')
);

export const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      ssl: (process.env.DATABASE_SSL === 'true' || isRemoteDb)
        ? { rejectUnauthorized: false }
        : undefined,
    })
  : null;

export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
  if (!pool) throw new Error('DATABASE_URL non configurée');
  return pool.query<T>(sql, params);
}

export async function transaction<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  if (!pool) throw new Error('DATABASE_URL non configurée');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
