import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { eur, eurShort, itDate } from '../format.js';

export const SERIES = [
  { key: 'cash', label: 'Contanti', color: '#1C505E' },
  { key: 'pos', label: 'POS', color: '#71B1BD' },
  { key: 'transfer', label: 'Bonifici', color: '#DEC0F1' },
];

function Tip({ active, payload, label, labelFmt = itDate }) {
  if (!active || !payload?.length) return null;
  const tot = payload.reduce((a, p) => a + Number(p.value || 0), 0);
  return (
    <div className="chart-tip">
      <div className="strong" style={{ marginBottom: 4 }}>{labelFmt(label)}</div>
      {payload.map((p) => <div className="r" key={p.dataKey}><span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: p.color, marginRight: 6 }} />{p.name}</span><b>{eur(p.value)}</b></div>)}
      {payload.length > 1 && <div className="r" style={{ borderTop: '1px solid var(--line)', marginTop: 4, paddingTop: 4 }}><span>Totale</span><b>{eur(tot)}</b></div>}
    </div>
  );
}

export function Legend() {
  return <div className="legend">{SERIES.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div>;
}

export function DailyStacked({ data, height = 280 }) {
  const rows = data.map((d) => ({ ...d, cash: Number(d.cash), pos: Number(d.pos), transfer: Number(d.transfer) }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="18%">
        <CartesianGrid vertical={false} stroke="#e7eef0" />
        <XAxis dataKey="date" tickFormatter={(d) => itDate(d).slice(0, 5)} tick={{ fontSize: 11, fill: '#5b6f75' }} axisLine={false} tickLine={false} minTickGap={12} />
        <YAxis tickFormatter={eurShort} tick={{ fontSize: 11, fill: '#5b6f75' }} axisLine={false} tickLine={false} width={64} />
        <Tooltip content={<Tip />} cursor={{ fill: 'rgba(113,177,189,.12)' }} />
        {SERIES.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SitesBars({ data, height }) {
  const rows = data.map((d) => ({ name: d.site_name || d.company_name, cash: Number(d.cash), pos: Number(d.pos), transfer: Number(d.transfer) }));
  return (
    <ResponsiveContainer width="100%" height={height || Math.max(160, rows.length * 38 + 30)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid horizontal={false} stroke="#e7eef0" />
        <XAxis type="number" tickFormatter={eurShort} tick={{ fontSize: 11, fill: '#5b6f75' }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 12, fill: '#0f2a33' }} axisLine={false} tickLine={false} />
        <Tooltip content={<Tip labelFmt={(x) => x} />} cursor={{ fill: 'rgba(113,177,189,.12)' }} />
        {SERIES.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} radius={i === SERIES.length - 1 ? [0, 4, 4, 0] : 0} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MixDonut({ totals, size = 180 }) {
  const data = SERIES.map((s) => ({ name: s.label, value: Number(totals[s.key] || 0), color: s.color })).filter((d) => d.value > 0);
  if (!data.length) return <div className="empty">Nessun dato</div>;
  return (
    <ResponsiveContainer width="100%" height={size}>
      <PieChart>
        <Pie data={data} dataKey="value" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none">
          {data.map((d) => <Cell key={d.name} fill={d.color} />)}
        </Pie>
        <Tooltip formatter={(v) => eur(v)} />
      </PieChart>
    </ResponsiveContainer>
  );
}
