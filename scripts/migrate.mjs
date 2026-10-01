// Applies db/schema.sql to the database in DATABASE_URL.
// Usage: npm run db:migrate   (reads .env.local)
import { readFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Add it to .env.local.');
  process.exit(1);
}

/**
 * Splits SQL into statements on top-level semicolons. Respects 'strings',
 * $$ dollar-quoted bodies (DO blocks) and -- line comments.
 */
export function splitSql(src) {
  const out = [];
  let cur = '';
  let inDollar = false;
  let inQuote = false;
  for (let i = 0; i < src.length; i++) {
    if (!inQuote && src.startsWith('$$', i)) { inDollar = !inDollar; cur += '$$'; i++; continue; }
    const ch = src[i];
    if (!inDollar && ch === "'") { inQuote = !inQuote; cur += ch; continue; }
    if (!inDollar && !inQuote && src.startsWith('--', i)) {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl - 1;
      continue;
    }
    if (!inDollar && !inQuote && ch === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const sql = neon(url);
const statements = splitSql(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
for (const statement of statements) {
  try {
    await sql.query(statement);
  } catch (err) {
    console.error(`Migration failed on:\n${statement.slice(0, 400)}\n`);
    throw err;
  }
}
const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`;
console.log(`Applied ${statements.length} statements. Tables: ${tables.map((t) => t.table_name).join(', ')}`);
