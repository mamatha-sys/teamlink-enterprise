// EMPLOYEE PROGRESS ON THE HRMS DASHBOARD (founder 2026-11-06: targets completed, attendance, performance & development, department wise employee
// performance; "round graph so that it looks professional"). Server: GET /hrms/dashboard/progress (utils/employeeProgress.js), so it follows the
// dashboard's filters and the viewer's scope.
//
// Each figure is one share of a whole, so a ring fits: large rings for the whole list, then a card of four small rings per department (or per person).
// Every ring has its own 0-100 scale, its number inside and its name under it, so colour never carries the meaning alone. Colours (employee-progress.css)
// follow the measure, never the rank, and pass the palette check; light orange is under 3:1, so the numbers and Table view carry it. Hover gives the
// raw counts. "No data" is a dashed ring with a dash, never a 0%.
import { useEffect, useState } from 'react';
import api from '../../api';
import ChartCard, { DataTable, useTip } from '../../components/charts/ChartCard.jsx';
import './employee-progress.css';

const show = (v) => (v == null ? '—' : `${v}%`);
const joiningWords = (r) => (r.joiningTarget != null ? `, ${r.joinings} of ${r.joiningTarget} joinings` : '');

const MEASURES = [
  { key: 'targetsPct', name: 'Targets', slot: 'epg-t', detail: (r, people) => (people ? `${r.targetsMet} of ${r.targetsPeople} targets${joiningWords(r)}` : `${r.targetsMet} of ${r.targetsPeople} people met all targets`) },
  { key: 'attendancePct', name: 'Attendance', slot: 'epg-a', detail: (r) => `${r.daysWorked} of ${r.workingDays} working days` },
  { key: 'scorePct', name: 'Performance', slot: 'epg-p', detail: (r, people) => (r.scorePct == null ? 'No review yet' : people ? `Review score ${r.scorePct} of 100` : `Average score of ${r.reviewed} reviewed`) },
  { key: 'trainingPct', name: 'Training', slot: 'epg-d', detail: (r) => `${r.trainingDone} of ${r.trainingTotal} courses done` },
];

// One ring. The gap at the end of the arc keeps a full ring readable as a ring; the rounded ends match the rest of the charts.
function Ring({ value, slot, size, width }) {
  const r = (size - width) / 2;
  const c = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.min(Math.max(value, 0), 100);
  return (
    <svg className={`epg-ring ${slot}`} viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden>
      <circle className={`epg-rail${value == null ? ' epg-none' : ''}`} cx={size / 2} cy={size / 2} r={r} strokeWidth={width} fill="none" />
      {v > 0 && (
        <circle className="epg-arc" cx={size / 2} cy={size / 2} r={r} strokeWidth={width} fill="none" strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      )}
      <text x="50%" y="50%" dy="0.35em" textAnchor="middle" className="epg-num" style={{ fontSize: Math.round(size * 0.24) }}>{value == null ? '—' : `${value}%`}</text>
    </svg>
  );
}

function RingBlock({ row, m, people, size, width, title, showDetail = false }) {
  const tip = useTip();
  const v = row[m.key];
  const words = m.detail(row, people);
  const open = (e) => tip && tip.show(e, { title: `${title} · ${m.name}`, rows: [{ name: words, value: show(v) }] });
  return (
    <div className="epg-block" role="img" aria-label={`${title}, ${m.name}: ${show(v)}, ${words}`} tabIndex={0}
      onMouseEnter={open} onMouseMove={open} onFocus={open} onMouseLeave={() => tip && tip.hide()} onBlur={() => tip && tip.hide()}>
      <Ring value={v} slot={m.slot} size={size} width={width} />
      <span className="epg-name">{m.name}</span>
      {showDetail && <span className="epg-detail">{words}</span>}
    </div>
  );
}

function Overall({ o, label }) {
  return <div className="epg-overall">{MEASURES.map((m) => <RingBlock key={m.key} row={o} m={m} size={112} width={11} title={label} showDetail />)}</div>;
}

function Cards({ rows, people, onPickDept }) {
  const clickable = !people && !!onPickDept;
  return (
    <div className="epg-cards">
      {rows.map((r) => (
        <div key={r.key} className="epg-card">
          <div className="epg-card-head">
            {clickable
              ? <button type="button" className="epg-title" title={`Show the people of ${r.name}`} onClick={() => onPickDept(r.key)}>{r.name}</button>
              : <span className="epg-title">{r.name}</span>}
            {!people && <span className="epg-count">{r.people} {r.people === 1 ? 'person' : 'people'}</span>}
          </div>
          <div className="epg-rings">{MEASURES.map((m) => <RingBlock key={m.key} row={r} m={m} people={people} size={62} width={7} title={r.name} />)}</div>
        </div>
      ))}
    </div>
  );
}

export default function EmployeeProgress({ params, onPickDept }) {
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify(params);
  useEffect(() => {
    let live = true;
    api.get('/hrms/dashboard/progress', { params }).then((r) => { if (live) { setD(r.data); setFailed(false); } }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
    // params is a new object on every render: its contents are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (failed) return <div className="notice red">Employee progress could not be loaded.</div>;
  if (!d) return <div className="cell-muted" style={{ margin: '12px 0' }}>Loading employee progress…</div>;
  const people = d.level === 'employee';
  const table = (
    <DataTable
      headers={[people ? 'Employee' : 'Department', 'Targets', 'Attendance', 'Performance', 'Training']}
      numeric={[1, 2, 3, 4]}
      rows={d.rows.map((r) => [r.name, ...MEASURES.map((m) => `${show(r[m.key])} (${m.detail(r, people)})`)])}
    />
  );
  return (
    <div className="hd-epg">
      <ChartCard title="Employee progress" sub={`${d.label}, so far. Everybody on this list.`} isEmpty={d.rows.length === 0} empty="No employees match these filters.">
        <Overall o={d.overall} label="Everybody" />
      </ChartCard>
      <ChartCard
        title={people ? 'Employee performance' : 'Department wise employee performance'}
        sub={people ? 'Each person in this department.' : 'Click a department name to see its people.'}
        isEmpty={d.rows.length === 0} empty="No employees match these filters." table={table}
      >
        <Cards rows={d.rows} people={people} onPickDept={onPickDept} />
      </ChartCard>
    </div>
  );
}

// An employee's own month, on their dashboard.
export function MyProgress() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/hrms/dashboard/progress/mine').then((r) => setD(r.data)).catch(() => setD(null)); }, []);
  if (!d || !d.me) return null;
  return (
    <div className="hd-epg">
      <ChartCard title="My progress" sub={`${d.label}, so far.`}>
        <div className="epg-overall">{MEASURES.map((m) => <RingBlock key={m.key} row={d.me} m={m} people size={112} width={11} title="Me" showDetail />)}</div>
      </ChartCard>
    </div>
  );
}
