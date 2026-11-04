import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHead, Btn, Kpi, Kpis, Panel, Pill, DataTable, Banner, fmtNum } from '../ui.jsx';
import { useOmni } from '../omniContext.js';
import omni, { errOf } from '../omniApi.js';

// CAMPAIGNS > Credits & joinings (founder 2026-11-04): how many credits each department and each person used this month, how many joinings they gave
// for them, and whether the credits were useful or wasted. Every login sees its own scope (the server decides): a Recruiter sees only their own numbers,
// a Team Lead their team, a Department Head their department, an Admin everyone. A department picked in the top bar narrows the list.
// Server: GET /api/outreach/insights/credit-use (+ .csv).
const thisMonth = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 7);
const TONE = { useful: 'live', some: 'warn', wasted: 'red', none: 'draft' };
const Verdict = ({ r }) => <Pill tone={TONE[r.verdict] || 'draft'} dot>{r.verdictWords}{r.costly ? ' (costly)' : ''}</Pill>;
const perJ = (v) => (v == null ? '—' : fmtNum(v));

export default function CreditUsePage() {
  const { dept, toast } = useOmni();
  const [month, setMonth] = useState(thisMonth());
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [dl, setDl] = useState(false);

  const load = useCallback(() => {
    setBusy(true); setErr('');
    omni.get('/insights/credit-use', { month }).then((r) => setD(r)).catch((e) => { setD(null); setErr(errOf(e, 'The numbers could not be loaded.')); }).finally(() => setBusy(false));
  }, [month, dept]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const download = async () => {
    setDl(true);
    try {
      const blob = await omni.blob('/insights/credit-use.csv', { month });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `omni-credits-joinings-${month}.csv`; a.click();
    } catch (e) { if (toast) toast('The file could not be made.'); } finally { setDl(false); }
  };

  const personCols = useMemo(() => [
    { id: 'name', label: 'Name', render: (r) => <span><b>{r.name}</b><div style={{ fontSize: 10, color: 'var(--muted)' }}>{r.code}</div></span>, sort: (r) => r.name, search: (r) => `${r.name} ${r.code || ''} ${r.department}` },
    { id: 'department', label: 'Department', sort: (r) => r.department },
    { id: 'credits', label: 'Credits used', className: 'num', render: (r) => fmtNum(r.credits), sort: (r) => r.credits },
    { id: 'sent', label: 'Messages', className: 'num', render: (r) => fmtNum(r.sent), sort: (r) => r.sent, hide: true },
    { id: 'replies', label: 'Replies', className: 'num', render: (r) => fmtNum(r.replies), sort: (r) => r.replies },
    { id: 'interviews', label: 'Interviews', className: 'num', render: (r) => fmtNum(r.interviews), sort: (r) => r.interviews },
    { id: 'joinings', label: 'Joinings', className: 'num', render: (r) => fmtNum(r.joinings), sort: (r) => r.joinings },
    { id: 'perJoining', label: 'Credits per joining', className: 'num', render: (r) => perJ(r.perJoining), sort: (r) => (r.perJoining == null ? Infinity : r.perJoining) },
    { id: 'verdict', label: 'Result', render: (r) => <span title={r.why}><Verdict r={r} /></span>, sort: (r) => r.verdictWords, search: (r) => r.verdictWords },
    { id: 'why', label: 'Why', render: (r) => <span style={{ fontSize: 11, color: 'var(--muted)' }}>{r.why}</span>, hide: true },
  ], []);
  const deptCols = useMemo(() => [
    { id: 'name', label: 'Department', render: (r) => <b>{r.name}</b>, sort: (r) => r.name },
    { id: 'people', label: 'People', className: 'num', render: (r) => fmtNum(r.people), sort: (r) => r.people },
    { id: 'credits', label: 'Credits used', className: 'num', render: (r) => fmtNum(r.credits), sort: (r) => r.credits },
    { id: 'replies', label: 'Replies', className: 'num', render: (r) => fmtNum(r.replies), sort: (r) => r.replies },
    { id: 'interviews', label: 'Interviews', className: 'num', render: (r) => fmtNum(r.interviews), sort: (r) => r.interviews },
    { id: 'joinings', label: 'Joinings', className: 'num', render: (r) => fmtNum(r.joinings), sort: (r) => r.joinings },
    { id: 'perJoining', label: 'Credits per joining', className: 'num', render: (r) => perJ(r.perJoining), sort: (r) => (r.perJoining == null ? Infinity : r.perJoining) },
    { id: 'split', label: 'People: useful / wasted', render: (r) => `${r.useful} / ${r.wasted}` },
    { id: 'verdict', label: 'Result', render: (r) => <span title={r.why}><Verdict r={r} /></span>, sort: (r) => r.verdictWords },
  ], []);

  const me = d && d.scope === 'me';
  const mine = me ? d.persons[0] : null;
  const t = d ? d.totals : null;
  return (
    <div>
      <PageHead
        eyebrow="Campaign center"
        title="Credits & joinings"
        lead={me ? 'The credits you used this month, the joinings you gave, and whether the credits were useful or wasted.' : 'Credits used by each department and each person, the joinings they gave for them, and whether the credits were useful or wasted.'}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>Month <input className="select" type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
        <Btn disabled={dl || !d} onClick={download}>{dl ? 'Making the file…' : 'Export'}</Btn>
      </PageHead>
      {err && <Banner tone="error">{err} <button type="button" className="ov-banner-link" onClick={load}>Try again</button></Banner>}
      {!d && !err && <div className="card panel" style={{ fontSize: 11, color: 'var(--muted)' }}>{busy ? 'Loading the numbers…' : ' '}</div>}
      {d && (
        <>
          <Kpis>
            <Kpi label={me ? 'Credits you used' : 'Credits used'} icon="₹" value={fmtNum(t.credits)} meta={mine && mine.given != null ? `${fmtNum(mine.left)} left of ${fmtNum(mine.given)}` : `${fmtNum(t.sent)} messages sent`} />
            <Kpi label={me ? 'Joinings you gave' : 'Joinings given'} icon="✓" value={fmtNum(t.joinings)} meta={`${fmtNum(t.interviews)} interviews, ${fmtNum(t.replies)} replies`} />
            <Kpi label="Credits per joining" icon="÷" value={perJ(t.perJoining)} meta={d.companyPerJoining ? `Company: ${fmtNum(d.companyPerJoining)}` : 'No joining yet this month'} />
            {me
              ? <Kpi label="Result" icon="◎" value={mine ? mine.verdictWords : '—'} meta={mine ? mine.why : 'Your login is not linked to an employee record.'} tone={mine && mine.verdict === 'wasted' ? 'down' : 'flat'} />
              : <Kpi label="Wasted credits" icon="✕" value={fmtNum(t.wastedCredits)} meta={`${fmtNum(t.wastedPeople)} people wasted, ${fmtNum(t.usefulPeople)} useful`} tone={t.wastedCredits > 0 ? 'down' : 'flat'} />}
          </Kpis>
          {!me && (
            <Panel title="By department" sub={`${d.scopeWords}. A department is Useful when its credits brought at least one joining.`}>
              <DataTable columns={deptCols} rows={d.departments} rowKey={(r) => r.name} compact pageSizes={[20, 50]} searchPlaceholder="Search departments…" emptyText="Nobody to show." defaultSort={{ id: 'credits', dir: 'desc' }} />
            </Panel>
          )}
          {!me && (
            <Panel title="By person" sub="Point at a result to see why.">
              <DataTable columns={personCols} rows={d.persons} rowKey={(r) => r.userId} persistKey="credituse" pageSizes={[20, 50, 100]} searchPlaceholder="Search name, code, department or result…" emptyText="Nobody to show." defaultSort={{ id: 'credits', dir: 'desc' }} />
            </Panel>
          )}
          {me && mine && (
            <Panel title="Your month" sub={mine.department}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                <Verdict r={mine} /><span>{mine.why}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                Messages sent: {fmtNum(mine.email)} email, {fmtNum(mine.whatsapp)} WhatsApp, {fmtNum(mine.sms)} SMS.{mine.testSent ? ` ${fmtNum(mine.testSent)} Test-mode messages used no credits.` : ''}
              </div>
            </Panel>
          )}
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 10, lineHeight: 1.6 }}>{d.notes.map((n) => <div key={n}>{n}</div>)}</div>
        </>
      )}
    </div>
  );
}
