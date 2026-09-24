import { parse as csvParse } from 'csv-parse/sync';
import { bad } from './util.js';

export function readCsv(buffer) {
  let text = buffer.toString('utf8').replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delimiter = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  try {
    return csvParse(text, { columns: (h) => h.map((x) => x.trim().toLowerCase().replace(/\s+/g, '_')), delimiter, skip_empty_lines: true, trim: true, relax_column_count: true });
  } catch (e) {
    throw bad(`CSV non leggibile: ${e.message}`);
  }
}

// "1.234,56" | "1234.56" | "1234,56" -> 1234.56
export function parseAmount(v) {
  if (v == null || v === '') return NaN;
  let s = String(v).replace(/[€\s]/g, '');
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  return Math.round(Number(s) * 100) / 100;
}

// "24/09/2026" | "2026-09-24" -> "2026-09-24"
export function parseDate(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

export const pick = (row, ...keys) => { for (const k of keys) if (row[k] != null && row[k] !== '') return row[k]; return null; };
