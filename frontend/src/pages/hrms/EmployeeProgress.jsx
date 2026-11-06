// EMPLOYEE PROGRESS ON THE HRMS DASHBOARD (founder 2026-11-06: targets completed, attendance, performance & development, department wise; "only one round
// graph, all the department details"). Server: GET /hrms/dashboard/progress (utils/employeeProgress.js), so it follows the dashboard's filters and scope.
//
// ONE donut. Each slice is a department, sized by its people, because a donut shows parts of a whole and people are the whole here; the figures sit beside
// it in one list, which is also the legend, so colour never carries the meaning alone. Hovering a slice or a row lights both. Colours are the validated
// categorical palette, fixed per department so a filter never repaints one (employee-progress.css). Once the list is down to one department, the same
// donut shows who has met all their targets, and the list shows each person. "No data" is a dash, never 0%.
import { useEffect, useState } from 'react';
import api from '../../api';
import ChartCard, { useTip } from '../../components/charts/ChartCard.jsx';
import { SectionLabel, StatRow } from '../../components/proto.jsx';
import './employee-progress.css';

const show = (v) => (v == null ? '—' : `${v}%`);
const DEPARTMENT_SLOT = { Education: 1, Medical: 2, Manufacturing: 3, BDE: 4, 'R&D': 5, HR: 6, Administration: 7, Accounts: 8 };
const slotOf = (name) => DEPARTMENT_SLOT[name] || ((Array.from(String(name)).reduce((n, c) => n + c.charCodeAt(0), 0) % 8) + 1);
const COLUMNS = [
  { key: 'targetsPct', name: 'Targets', title: (r, people) => (people ? `${r.targetsMet} of ${r.targetsPeople} targets${r.joiningTarget != null ? `, ${r.joinings} of ${r.joiningTarget} joinings` : ''}` : `${r.targetsMet} of ${r.targetsPeople} people met all targets`) },
  { key: 'attendancePct', name: 'Attendance', title: (r) => `${r.daysWorked} of ${r.workingDays} working days` },
  { key: 'scorePct', name: 'Performance', title: (r, people) => (r.scorePct == null ? 'No review yet' : people ? `Review score ${r.scorePct} of 100` : `Average score of ${r.reviewed} reviewed`) },
  { key: 'trainingPct', name: 'Training', title: (r) => `${r.trainingDone} of ${r.trainingTotal} courses done` },
];

// The one round graph. A small gap between slices keeps neighbours apart.
function Donut({ slices, total, word, active, setActive }) {
  const tip = useTip();
  const size = 230;
  const width = 34;
  const r = (size - width) / 2;
  const c = 2 * Math.PI * r;
  const sum = slices.reduce((n, s) => n + s.value, 0);
  let start = 0;
  return (
    <svg className="epg-donut" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${total} ${word}: ${slices.map((s) => `${s.name} ${s.value}`).join(', ')}`}>
      <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={width} fill="none" className="epg-rail" />
      {slices.filter((s) => s.value > 0).map((s) => {
        const len = sum ? (s.value / sum) * c : 0;
        const gap = slices.filter((x) => x.value > 0).length > 1 ? 2.5 : 0;
        const el = (
          <circle key={s.key} cx={size / 2} cy={size / 2} r={r} strokeWidth={width} fill="none" className={`epg-slice epg-s${s.slot}${active && active !== s.key ? ' epg-dim' : ''}`}
            strokeDasharray={`${Math.max(len - gap, 0.5)} ${c}`} strokeDashoffset={-start} transform={`rotate(-90 ${size / 2} ${size / 2})`}
            onMouseEnter={(e) => { setActive(s.key); if (tip) tip.show(e, { title: s.name, rows: [{ name: `of ${sum} (${Math.round((s.value / sum) * 100)}%)`, value: s.value }] }); }}
            onMouseMove={(e) => tip && tip.show(e, { title: s.name, rows: [{ name: `of ${sum} (${Math.round((s.value / sum) * 100)}%)`, value: s.value }] })}
            onMouseLeave={() => { setActive(null); if (tip) tip.hide(); }} />
        );
        start += len;
        return el;
      })}
      <text x="50%" y="47%" textAnchor="middle" className="epg-big">{total}</text>
      <text x="50%" y="58%" textAnchor="middle" className="epg-word">{word}</text>
    </svg>
  );
}

function Details({ rows, people, overall, slotFor, active, setActive, onPickDept }) {
  const clickable = !people && !!onPickDept;
  return (
    <div className="epg-tablewrap">
      <table className="epg-table">
        <thead>
          <tr>
            <th>{people ? 'Employee' : 'Department'}</th>
            {!people && <th className="num">People</th>}
            {COLUMNS.map((c) => <th key={c.key} className="num">{c.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={active === r.key ? 'on' : ''} onMouseEnter={() => setActive(r.key)} onMouseLeave={() => setActive(null)}>
              <td>
                <span className="epg-who">
                  {slotFor(r) && <i className={`epg-s${slotFor(r)}`} />}
                  {clickable
                    ? <button type="button" title={`Show the people of ${r.name}`} onClick={() => onPickDept(r.key)}>{r.name}</button>
                    : <span>{r.name}</span>}
                </span>
              </td>
              {!people && <td className="num">{r.people}</td>}
              {COLUMNS.map((c) => <td key={c.key} className="num" title={c.title(r, people)}>{show(r[c.key])}</td>)}
            </tr>
          ))}
        </tbody>
        {!people && (
          <tfoot>
            <tr>
              <td>All departments</td>
              <td className="num">{overall.people}</td>
              {COLUMNS.map((c) => <td key={c.key} className="num" title={c.title(overall, false)}>{show(overall[c.key])}</td>)}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export default function EmployeeProgress({ params, onPickDept }) {
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(null);
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
  const noTargets = o.people - o.targetsPeople;
  const slices = people
    ? [
      { key: 'met', name: 'Met all targets', value: o.targetsMet, slot: 3 },
      { key: 'notYet', name: 'Not yet', value: o.targetsPeople - o.targetsMet, slot: 2 },
      { key: 'none', name: 'No target this month', value: noTargets, slot: 'n' },
    ]
    : d.rows.map((r) => ({ key: r.key, name: r.name, value: r.people, slot: slotOf(r.name) }));
  return (
    <div className="hd-epg">
      <ChartCard
        title={people ? 'Employee performance' : 'Department wise employee performance'}
        sub={`${d.label}, so far. ${people ? 'The round graph shows who has met all their targets.' : 'The round graph shows people per department. Click a department to see its people.'}`}
        isEmpty={d.rows.length === 0} empty="No employees match these filters."
      >
        <div className="epg-layout">
          <div>
            <Donut slices={slices} total={o.people} word={o.people === 1 ? 'person' : 'people'} active={people ? null : active} setActive={people ? () => {} : setActive} />
            {people && (
              <div className="epg-legend">
                {slices.map((s) => <span key={s.key}><i className={`epg-s${s.slot}`} />{s.name} {s.value}</span>)}
              </div>
            )}
          </div>
          <Details rows={d.rows} people={people} overall={o} slotFor={(r) => (people ? null : slotOf(r.name))} active={active} setActive={setActive} onPickDept={onPickDept} />
        </div>
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
      <SectionLabel>My Progress This Month</SectionLabel>
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
