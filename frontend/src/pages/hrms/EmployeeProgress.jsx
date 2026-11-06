// EMPLOYEE PROGRESS ON THE HRMS DASHBOARD (founder 2026-11-06: targets completed, attendance, performance & development, department wise employee
// performance as a chart). Server: GET /hrms/dashboard/progress (utils/employeeProgress.js), so it follows the dashboard's filters and the viewer's scope.
//
// Four measures of one group are compared across groups, so this is small multiples: one row per department, one aligned column per measure, all on
// the same 0-100 scale, so no second axis and no legend is needed; the column heads name them. One hue, because colour carries no meaning here beyond
// "how far": #2a78d6 passes the palette check on white, the dark step is #3d8fd6. Every bar has its number in ink beside it, hover gives the raw
// counts, and Table view carries everything. "No data" is an empty track with a dash, never a 0%.
import { useEffect, useState } from 'react';
import api from '../../api';
import ChartCard, { DataTable, useTip } from '../../components/charts/ChartCard.jsx';
import { StatRow } from '../../components/proto.jsx';
import './employee-progress.css';

const show = (v) => (v == null ? '—' : `${v}%`);
const joiningWords = (r) => (r.joiningTarget != null ? `, ${r.joinings} of ${r.joiningTarget} joinings` : '');

const MEASURES = [
  { key: 'targetsPct', name: 'Targets met', detail: (r, people) => (people ? `${r.targetsMet} of ${r.targetsPeople} targets${joiningWords(r)}` : `${r.targetsMet} of ${r.targetsPeople} people met all targets`) },
  { key: 'attendancePct', name: 'Attendance', detail: (r) => `${r.daysWorked} of ${r.workingDays} working days` },
  { key: 'scorePct', name: 'Performance', detail: (r, people) => (r.scorePct == null ? 'No review yet' : people ? `Review score ${r.scorePct} of 100` : `Average score of ${r.reviewed} reviewed`) },
  { key: 'trainingPct', name: 'Training', detail: (r) => `${r.trainingDone} of ${r.trainingTotal} courses done` },
];

function Rows({ rows, people, onPickDept }) {
  const tip = useTip();
  const clickable = !people && !!onPickDept;
  return (
    <div className="epg-grid">
      <div className="epg-head" aria-hidden>
        <span>{people ? 'Employee' : 'Department'}</span>
        {MEASURES.map((m) => <span key={m.key}>{m.name}</span>)}
      </div>
      {rows.map((r) => (
        <div className="epg-row" key={r.key}>
          {clickable
            ? <button type="button" className="epg-name" title={`Show the people of ${r.name}`} onClick={() => onPickDept(r.key)}>{r.name} <small>{r.people}</small></button>
            : <span className="epg-name">{r.name}</span>}
          {MEASURES.map((m) => {
            const v = r[m.key];
            const words = m.detail(r, people);
            const open = (e) => tip && tip.show(e, { title: `${r.name} · ${m.name}`, rows: [{ name: words, value: show(v) }] });
            return (
              <div key={m.key} className="epg-cell" role="img" aria-label={`${r.name}, ${m.name}: ${show(v)}, ${words}`}
                tabIndex={0} onMouseEnter={open} onMouseMove={open} onFocus={open} onMouseLeave={() => tip && tip.hide()} onBlur={() => tip && tip.hide()}>
                <span className="epg-m">{m.name}</span>
                <span className="epg-track">{v != null && v > 0 && <i style={{ width: `${Math.min(v, 100)}%` }} />}</span>
                <b>{show(v)}</b>
              </div>
            );
          })}
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
  const o = d.overall;
  const table = (
    <DataTable
      headers={[people ? 'Employee' : 'Department', 'Targets met', 'Attendance', 'Performance', 'Training']}
      numeric={[1, 2, 3, 4]}
      rows={d.rows.map((r) => [r.name, ...MEASURES.map((m) => `${show(r[m.key])} (${m.detail(r, people)})`)])}
    />
  );
  return (
    <div className="hd-epg">
      <StatRow columns={4} cells={[
        { value: `${o.targetsMet} of ${o.targetsPeople}`, label: 'People who met all targets', to: '/performance' },
        { value: show(o.attendancePct), label: `Attendance (${o.daysWorked} of ${o.workingDays} days)`, to: '/attendance' },
        { value: o.scorePct == null ? '—' : `${o.scorePct} / 100`, label: `Performance (${o.reviewed} reviewed)`, to: '/performance?tab=reports' },
        { value: `${o.trainingDone} of ${o.trainingTotal}`, label: 'Training courses done', to: '/performance?tab=lms' },
      ]} />
      <ChartCard
        title={people ? 'Employee performance' : 'Department wise employee performance'}
        sub={`${d.label}, so far. ${people ? 'Each person in this department.' : 'Click a department to see its people.'}`}
        isEmpty={d.rows.length === 0} empty="No employees match these filters." table={table}
      >
        <Rows rows={d.rows} people={people} onPickDept={onPickDept} />
      </ChartCard>
    </div>
  );
}

// An employee's own month, on their dashboard.
export function MyProgress() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/hrms/dashboard/progress/mine').then((r) => setD(r.data)).catch(() => setD(null)); }, []);
  if (!d || !d.me) return null;
  const m = d.me;
  return (
    <>
      <StatRow columns={4} cells={[
        { value: m.targetsPeople ? `${m.targetsMet} of ${m.targetsPeople}` : '—', label: m.joiningTarget != null ? `My targets (${m.joinings} of ${m.joiningTarget} joinings)` : 'My targets done', to: '/performance' },
        { value: show(m.attendancePct), label: `My attendance (${m.daysWorked} of ${m.workingDays} days)`, to: '/attendance' },
        { value: m.scorePct == null ? '—' : `${m.scorePct} / 100`, label: 'My performance score', to: '/performance?tab=reports' },
        { value: `${m.trainingDone} of ${m.trainingTotal}`, label: 'My training done', to: '/performance?tab=lms' },
      ]} />
      <div style={{ height: 16 }} />
    </>
  );
}
