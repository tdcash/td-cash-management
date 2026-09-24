import pg from 'pg';
import { config } from './config.js';

// NUMERIC -> number (importi a 2 decimali: sicuro entro 2^53)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// DATE -> stringa ISO 'YYYY-MM-DD' (niente conversioni di fuso)
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 15 });

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;
export const many = async (text, params) => (await pool.query(text, params)).rows;

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
