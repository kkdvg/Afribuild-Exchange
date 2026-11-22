import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';

dotenv.config();
dotenv.config({ path: resolve(process.cwd(),'../../.env') });
export const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 12,
      ssl: process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true' }
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
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
