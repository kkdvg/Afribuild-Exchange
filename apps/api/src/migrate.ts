import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pool } from './db';

async function main() {
  if (!pool) throw new Error('Définissez DATABASE_URL avant la migration.');
  const candidates = [resolve(process.cwd(),'migrations'),resolve(process.cwd(),'apps/api/migrations')];
  let directory: string | undefined;
  for (const candidate of candidates) { try { await readdir(candidate); directory=candidate; break; } catch { /* try the other workspace root */ } }
  if (!directory) throw new Error('Répertoire de migrations introuvable.');
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  for (const name of (await readdir(directory)).filter(n=>n.endsWith('.sql')).sort()) {
    const done=await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1',[name]);
    if(done.rowCount)continue;
    const client=await pool.connect();
    try { await client.query('BEGIN'); await client.query(await readFile(resolve(directory,name),'utf8')); await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]); await client.query('COMMIT'); console.log(`Migration appliquée : ${name}`); }
    catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  }
  await pool.end();
}
void main();
