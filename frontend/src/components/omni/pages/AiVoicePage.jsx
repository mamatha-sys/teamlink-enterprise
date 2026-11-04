import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../../api';
import { errOf } from '../omniApi.js';
import { useOmni } from '../omniContext.js';
import { Banner, Btn, Empty, Field, Kpi, Kpis, PageHead, Panel, Pill, Tabs } from '../ui.jsx';
import { fmtDateTime } from '../ui.jsx';
import AiCallDetail from '../../aicalling/AiCallDetail.jsx';

// ---------------------------------------------------------------------------
// OMNI-CHANNEL > CAMPAIGNS > AI VOICE (founder 2026-11-04). Campaigns of TeamLink's existing AI Calling: the same engine, hours, consent, DND, limits,
// retries, transcripts, outcomes and ATS timeline lines as the ATS AI Calling screen (server: calling/voiceCampaigns.js, /api/ai-calling/voice/*).
// Pick an agent, a vacancy and the candidates; one candidate is a single call, many are a bulk campaign. Counters, pause / resume / stop, retry of the
// calls that gave up, call-backs and a CSV are on the campaign. Nothing here is a mock: no number is shown that did not come from a real call row.
// ---------------------------------------------------------------------------
const STATUS_WORD = { running: ['live', 'Running'], scheduled: ['scheduled', 'Scheduled'], paused: ['warn', 'Paused'], stopped: ['draft', 'Stopped'], completed: ['warn', 'Completed'] };
const CALL_WORD = {
  queued: ['draft', 'Waiting'], calling: ['live', 'On the phone'], completed: ['live', 'Answered'], failed: ['red', 'Failed'], busy: ['red', 'Busy'], 'no-answer': ['red', 'No answer'], cancelled: ['draft', 'Cancelled'],
};
const CB_WORD = { pending: 'Waiting' };
const LANG = ['English', 'Telugu', 'Hindi'];
const callPill = (r) => {
  const [tone, w] = CALL_WORD[r.status] || ['draft', r.status];
  const retry = ['failed', 'busy', 'no-answer'].includes(r.status) && r.nextAttemptAt ? ' · trying again' : '';
  return <Pill tone={tone} dot>{w}{retry}</Pill>;
};
const short = (t, n = 70) => (t && t.length > n ? `${t.slice(0, n)}…` : (t || '—'));
const dt = (iso) => (iso ? fmtDateTime(iso) : '—');

export default function AiVoicePage() {
  const { toast } = useOmni();
  const [tab, setTab] = useState('campaigns');
  const [status, setStatus] = useState(null);
  const [ready, setReady] = useState(null); // which way a campaign rings (the AI Calling provider or the AI phone line) and in which mode
  const [data, setData] = useState(null);
  const [agents, setAgents] = useState([]);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState(null);
  const [making, setMaking] = useState(false);

  const load = useCallback(async () => {
    try {
      const [l, a] = await Promise.all([api.get('/ai-calling/voice/campaigns'), api.get('/ai-calling/voice/agents')]);
      setData(l.data); setAgents(a.data.agents || []); setErr('');
    } catch (e) { setErr(errOf(e, 'AI Voice could not be loaded.')); }
  }, []);
  useEffect(() => {
    api.get('/ai-calling/status').then((r) => setStatus(r.data)).catch(() => setStatus(null));
    api.get('/ai-calling/voice/readiness').then((r) => setReady(r.data)).catch(() => setReady(null));
    load();
  }, [load]);
  const live = !!(data && data.items.some((c) => ['running', 'scheduled'].includes(c.status)));
  useEffect(() => { if (!live) return undefined; const t = setInterval(() => { if (!document.hidden) load(); }, 6000); return () => clearInterval(t); }, [live, load]);

  const t = data && data.totals;
  return (
    <div>
      <PageHead eyebrow="Campaigns" title="AI Voice" lead="TeamLink's AI Calling as a campaign: pick an agent, a vacancy and candidates. The AI rings them, and every answer, outcome and transcript is saved on the candidate.">
        {status && status.canCall && ready && ready.path && <Btn primary onClick={() => { setMaking(true); setTab('campaigns'); setOpenId(null); }}>New AI Voice campaign</Btn>}
      </PageHead>
      {ready && !ready.path && (
        <Banner tone="warn">
          AI calling is not ready yet, so no campaign can start. An Admin finishes the setup in Administration &gt; Integrations &gt; AI Calling, or switches the AI phone line on (the same line as “Call with AI (phone)” in the ATS).
          {ready.problems.length > 0 && <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>{ready.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </Banner>
      )}
      {ready && ready.path === 'phone' && (
        <Banner tone="info">
          AI Voice rings through the <b>AI phone line</b>, the same one as “Call with AI (phone)” in the ATS.
          {ready.mode === 'Test' ? <> It is in <b>Test mode</b>: only the {ready.testNumbers} test number{ready.testNumbers === 1 ? '' : 's'} can be rung. An Admin switches it to Live when the team is ready.</> : null}
          {ready.mode === 'Off' ? <> It is switched <b>off</b>.</> : null}
        </Banner>
      )}
      {ready && ready.path === 'provider' && ready.mode === 'Test' && <Banner tone="info">AI calling is in <b>Test mode</b>: only the test numbers are rung.</Banner>}
      {ready && ready.path && status && !status.canCall && <Banner tone="warn">Your role is not allowed to place AI calls. An Admin can change this in Administration &gt; Integrations &gt; AI Calling.</Banner>}
      {err && <Banner tone="error">{err}</Banner>}
      <Kpis>
        <Kpi label="Campaigns" icon="☎" value={t ? t.campaigns : '—'} meta={t ? `${t.running} running` : ''} />
        <Kpi label="Calls initiated" icon="↗" value={t ? t.initiated : '—'} meta={t ? `${t.queued} waiting` : ''} />
        <Kpi label="Answered" icon="✓" value={t ? t.answered : '—'} />
        <Kpi label="Completed (outcome saved)" icon="◉" value={t ? t.completed : '—'} />
        <Kpi label="Failed" icon="!" value={t ? t.failed : '—'} tone={t && t.failed ? 'down' : undefined} />
        <Kpi label="Call-backs" icon="↺" value={t ? t.callbacks : '—'} />
      </Kpis>
      <Tabs value={tab} onChange={(v) => { setTab(v); setOpenId(null); setMaking(false); }} tabs={[['campaigns', 'Campaigns'], ['agents', 'AI agents', agents.length || undefined]]} />
      {tab === 'campaigns' && making && <NewCampaign agents={agents} ready={ready} onClose={() => setMaking(false)} onCreated={(id) => { setMaking(false); load(); setOpenId(id); }} toast={toast} />}
      {tab === 'campaigns' && !making && !openId && <CampaignList data={data} onOpen={setOpenId} />}
      {tab === 'campaigns' && !making && openId && <CampaignDetail id={openId} onBack={() => { setOpenId(null); load(); }} onChanged={load} toast={toast} canCall={!!(status && status.canCall)} />}
      {tab === 'agents' && <Agents agents={agents} canCall={!!(status && status.canCall)} onChanged={load} toast={toast} />}
    </div>
  );
}

// ---- the list ----------------------------------------------------------------------------------------------------------------------
function CampaignList({ data, onOpen }) {
  if (!data) return <div style={{ fontSize: 11 }}>Loading…</div>;
  if (!data.items.length) return <Empty title="No AI Voice campaign yet">Press “New AI Voice campaign”, pick an agent, a vacancy and the candidates to call.</Empty>;
  return (
    <Panel title="AI Voice campaigns" sub="Newest first. Open one to see every call, its outcome and the transcript.">
      <div className="table-scroll">
        <table className="table">
          <thead><tr><th>Campaign</th><th>Vacancy</th><th>Agent</th><th>Status</th><th>Progress</th><th>Answered</th><th>Failed</th><th>Call-backs</th><th /></tr></thead>
          <tbody>
            {data.items.map((c) => {
              const [tone, w] = STATUS_WORD[c.status] || ['draft', c.status];
              const done = c.counters.total - c.counters.queued - c.counters.calling - c.counters.retrying;
              const pct = c.counters.total ? Math.round((done / c.counters.total) * 100) : 0;
              return (
                <tr key={c.id}>
                  <td style={{ fontWeight: 800 }}>{c.name}<span className="cmp-sub">{dt(c.createdAt)} · {c.createdByName || ''}</span></td>
                  <td>{c.job ? `${c.job.title || ''}${c.job.code ? ` (${c.job.code})` : ''}` : '—'}</td>
                  <td>{c.agentName || c.purpose}<span className="cmp-sub">{c.language || 'candidate\'s language'}</span></td>
                  <td><Pill tone={tone} dot>{w}</Pill>{c.status === 'scheduled' && <span className="cmp-sub">{dt(c.scheduledAt)}</span>}</td>
                  <td style={{ minWidth: 130 }}>{done} of {c.counters.total} done<div style={{ height: 5, background: 'var(--line)', borderRadius: 4, marginTop: 4 }}><div style={{ height: 5, width: `${pct}%`, background: 'var(--green, #1a8f5a)', borderRadius: 4 }} /></div></td>
                  <td>{c.counters.answered}</td>
                  <td>{c.counters.failed}{c.counters.retrying ? <span className="cmp-sub">{c.counters.retrying} trying again</span> : null}</td>
                  <td>{c.counters.callbacks}</td>
                  <td><Btn small onClick={() => onOpen(c.id)}>Open</Btn></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---- a new campaign ----------------------------------------------------------------------------------------------------------------
function NewCampaign({ agents, ready, onClose, onCreated, toast }) {
  const [jobs, setJobs] = useState(null);
  const [f, setF] = useState({ name: '', jobId: '', agentId: '', language: '', concurrency: 2, when: 'now', at: '' });
  const [rows, setRows] = useState(null);
  const [pick, setPick] = useState({});
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const agent = agents.find((a) => a.id === f.agentId);
  useEffect(() => { api.get('/ai-calling/jobs').then((r) => setJobs(r.data.rows || [])).catch((e) => setMsg({ tone: 'error', text: errOf(e, 'The vacancies could not be loaded.') })); }, []);
  useEffect(() => {
    if (!f.jobId || !agent) { setRows(null); return; }
    setRows(null); setPick({});
    api.get('/ai-calling/voice/candidates', { params: { requirementId: f.jobId, purpose: agent.purpose } }).then((r) => setRows(r.data.rows || [])).catch((e) => setMsg({ tone: 'error', text: errOf(e, 'The candidates could not be loaded.') }));
  }, [f.jobId, agent && agent.purpose]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => (rows || []).filter((r) => !q.trim() || `${r.name} ${r.stageLabel || ''}`.toLowerCase().includes(q.trim().toLowerCase())), [rows, q]);
  const chosen = Object.keys(pick).filter((k) => pick[k]);
  const callable = (rows || []).filter((r) => r.callable);
  const max = (ready && ready.maxBulk) || 50;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function start() {
    setMsg(null);
    if (!f.agentId) { setMsg({ tone: 'error', text: 'Pick an AI agent.' }); return; }
    if (!f.jobId) { setMsg({ tone: 'error', text: 'Pick a vacancy.' }); return; }
    if (!chosen.length) { setMsg({ tone: 'error', text: 'Pick at least one candidate.' }); return; }
    if (chosen.length > max) { setMsg({ tone: 'error', text: `A campaign can have at most ${max} candidates.` }); return; }
    if (f.when === 'later' && !f.at) { setMsg({ tone: 'error', text: 'Pick the date and time to start.' }); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/ai-calling/voice/campaigns', {
        name: f.name.trim() || undefined, agentId: f.agentId, applicationIds: chosen, language: f.language || undefined, concurrency: Number(f.concurrency),
        startNow: f.when !== 'hold', scheduledAt: f.when === 'later' ? new Date(f.at).toISOString() : undefined,
      });
      toast(`AI Voice campaign ${data.status === 'running' ? 'started' : data.status === 'scheduled' ? 'scheduled' : 'saved'}: ${data.started} candidate${data.started === 1 ? '' : 's'}${data.refused ? `, ${data.refused} not allowed` : ''}`);
      onCreated(data.id);
    } catch (e) { setMsg({ tone: 'error', text: errOf(e, 'The campaign could not be started.') }); }
    setBusy(false);
  }

  return (
    <Panel title="New AI Voice campaign" sub="One candidate is a single call. Several are a bulk campaign. The AI only rings people it is allowed to: consent, do-not-call list, calling hours and daily limit are checked for every call." right={<Btn small onClick={onClose}>Cancel</Btn>}>
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12, margin: '10px 0' }}>
        <Field label="Campaign name"><input value={f.name} onChange={set('name')} placeholder="e.g. Nursing screening, Hyderabad" maxLength={80} /></Field>
        <Field label="AI agent"><select value={f.agentId} onChange={set('agentId')}><option value="">Pick an agent…</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.purpose})</option>)}</select></Field>
        <Field label="Vacancy"><select value={f.jobId} onChange={set('jobId')}><option value="">{jobs ? 'Pick a vacancy…' : 'Loading…'}</option>{(jobs || []).map((j) => <option key={j.id} value={j.id}>{j.title}{j.location ? ` · ${j.location}` : ''}</option>)}</select></Field>
        <Field label="Language" hint={agent && agent.language ? `The agent speaks ${agent.language} unless you change it.` : 'Leave empty to use each candidate\'s own language.'}><select value={f.language} onChange={set('language')}><option value="">{agent && agent.language ? `${agent.language} (the agent's)` : 'Each candidate\'s own'}</option>{LANG.map((l) => <option key={l} value={l}>{l}</option>)}</select></Field>
        <Field label="Calls at the same time" hint="How many candidates are on the phone at once."><select value={f.concurrency} onChange={set('concurrency')}>{[1, 2, 3, 4, 5, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
        <Field label="When">
          <select value={f.when} onChange={set('when')}><option value="now">Start now</option><option value="later">Start later…</option><option value="hold">Save, start it myself</option></select>
          {f.when === 'later' && <input type="datetime-local" style={{ marginTop: 6 }} value={f.at} onChange={set('at')} aria-label="Start at" />}
        </Field>
      </div>
      {agent && <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>This agent makes <b>{agent.purpose}</b> calls{agent.instructions ? <> and adds: “{agent.instructions}”</> : ''}.</div>}
      {f.jobId && agent && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0' }}>
            <input className="search" style={{ maxWidth: 260 }} placeholder="Search candidates…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search candidates" />
            <Btn small onClick={() => setPick(Object.fromEntries(callable.slice(0, max).map((r) => [r.applicationId, true])))}>Pick all who can be called ({Math.min(callable.length, max)})</Btn>
            <Btn small onClick={() => setPick({})}>Clear</Btn>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>{chosen.length} picked · {callable.length} of {(rows || []).length} can be called now</span>
          </div>
          <div className="table-scroll" style={{ maxHeight: 340, overflow: 'auto' }}>
            <table className="table cmp-table-small">
              <thead><tr><th style={{ width: 28 }} /><th>Candidate</th><th>Stage</th><th>Can be called?</th></tr></thead>
              <tbody>
                {rows === null && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: 18 }}>Loading candidates…</td></tr>}
                {shown.map((r) => (
                  <tr key={r.applicationId} style={r.callable ? undefined : { opacity: 0.6 }}>
                    <td><input type="checkbox" disabled={!r.callable} checked={!!pick[r.applicationId]} onChange={(e) => setPick({ ...pick, [r.applicationId]: e.target.checked })} aria-label={`Pick ${r.name}`} /></td>
                    <td style={{ fontWeight: 800 }}>{r.name}</td>
                    <td>{r.stageLabel || r.stage}</td>
                    <td>{r.callable ? <Pill tone="live">Yes</Pill> : <span style={{ fontSize: 10, color: 'var(--muted)' }}>{r.reason || 'No'}</span>}</td>
                  </tr>
                ))}
                {rows && !shown.length && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: 18 }}>No candidate in this vacancy.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <Btn primary disabled={busy} onClick={start}>{busy ? 'Starting…' : (f.when === 'now' ? `Start calling${chosen.length ? ` ${chosen.length}` : ''}` : (f.when === 'later' ? 'Schedule campaign' : 'Save campaign'))}</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </Panel>
  );
}

// ---- one campaign ------------------------------------------------------------------------------------------------------------------
function CampaignDetail({ id, onBack, onChanged, toast, canCall }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [call, setCall] = useState(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    try { const r = await api.get(`/ai-calling/voice/campaigns/${id}`, { params: { status: filter === 'all' ? '' : filter, page, pageSize: 25 } }); setD(r.data); setErr(''); } catch (e) { setErr(errOf(e, 'This campaign could not be opened.')); }
  }, [id, filter, page]);
  useEffect(() => { load(); }, [load]);
  const running = d && ['running', 'scheduled'].includes(d.campaign.status);
  useEffect(() => { if (!running) return undefined; const t = setInterval(() => { if (!document.hidden) load(); }, 5000); return () => clearInterval(t); }, [running, load]);

  async function act(action, words) {
    setBusy(action);
    try { await api.post(`/ai-calling/voice/campaigns/${id}/${action}`); toast(words); await load(); onChanged(); } catch (e) { toast(errOf(e, 'That did not work.')); }
    setBusy('');
  }
  async function csv() {
    try {
      const r = await api.get(`/ai-calling/voice/campaigns/${id}/export.csv`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data); const a = document.createElement('a');
      a.href = url; a.download = `ai-voice-${id}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { toast(errOf(e, 'The file could not be made.')); }
  }
  async function cb(cbId, action) {
    try { await api.post(`/ai-calling/callbacks/${cbId}/${action}`, {}); toast(action === 'call' ? 'Calling now' : 'Done'); await load(); } catch (e) { toast(errOf(e, 'That did not work.')); }
  }
  if (err) return <div><Btn small onClick={onBack}>‹ Back</Btn><Banner tone="error">{err}</Banner></div>;
  if (!d) return <div style={{ fontSize: 11 }}>Loading…</div>;
  const c = d.campaign; const k = c.counters;
  const [tone, w] = STATUS_WORD[c.status] || ['draft', c.status];
  const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' }}>
        <Btn small onClick={onBack}>‹ All campaigns</Btn>
        <b style={{ fontSize: 14 }}>{c.name}</b><Pill tone={tone} dot>{w}</Pill>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{c.agentName} · {c.job && c.job.title} · {c.concurrency} at a time</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {canCall && ['running', 'scheduled'].includes(c.status) && <Btn small disabled={busy === 'pause'} onClick={() => act('pause', 'Paused')}>Pause</Btn>}
          {canCall && c.status === 'paused' && <Btn small primary disabled={busy === 'resume'} onClick={() => act('resume', 'Resumed')}>{c.startedAt ? 'Resume' : 'Start'}</Btn>}
          {canCall && ['running', 'scheduled', 'paused'].includes(c.status) && <Btn small danger disabled={busy === 'stop'} onClick={() => { if (window.confirm('Stop this campaign? The calls still waiting are cancelled. Calls on the phone now finish.')) act('stop', 'Stopped'); }}>Stop</Btn>}
          {canCall && k.failed > 0 && <Btn small disabled={busy === 'retry-failed'} onClick={() => act('retry-failed', 'The failed calls are queued again')}>Retry {k.failed} failed</Btn>}
          <Btn small onClick={csv}>Download CSV</Btn>
          <Btn small onClick={load}>Refresh</Btn>
        </span>
      </div>
      <Kpis>
        <Kpi label="Candidates" icon="☎" value={k.total} meta={`${k.queued} waiting · ${k.calling} on the phone`} />
        <Kpi label="Initiated" icon="↗" value={k.initiated} />
        <Kpi label="Answered" icon="✓" value={k.answered} />
        <Kpi label="Completed (outcome saved)" icon="◉" value={k.completed} />
        <Kpi label="Failed" icon="!" value={k.failed} meta={k.retrying ? `${k.retrying} trying again` : ''} tone={k.failed ? 'down' : undefined} />
        <Kpi label="Call-backs" icon="↺" value={k.callbacks} />
      </Kpis>
      {d.callbacks.length > 0 && (
        <Panel title="Call-backs from this campaign" sub="Candidates who asked to be called again. The AI rings them, or you do.">
          <div className="table-scroll">
            <table className="table cmp-table-small">
              <thead><tr><th>Candidate</th><th>When they asked</th><th>Due</th><th>Status</th><th /></tr></thead>
              <tbody>{d.callbacks.map((x) => (
                <tr key={x.id}><td style={{ fontWeight: 800 }}>{x.candidateName || '—'}</td><td>{x.whenText || '—'}</td><td>{dt(x.dueAt)}</td><td>{CB_WORD[x.status] || x.status}</td>
                  <td style={{ display: 'flex', gap: 6 }}>{canCall && <><Btn small primary onClick={() => cb(x.id, 'call')}>Call now</Btn><Btn small onClick={() => cb(x.id, 'done')}>Done</Btn></>}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>
      )}
      <Panel title="Calls" sub="Open a call to read what the candidate said and the saved outcome. It is also on the candidate's timeline.">
        <Tabs value={filter} onChange={(v) => { setFilter(v); setPage(1); }} tabs={[['all', 'All', k.total], ['waiting', 'Waiting', k.queued + k.calling], ['answered', 'Answered', k.answered], ['failed', 'Failed', k.failed + k.retrying], ['cancelled', 'Cancelled', k.cancelled]]} />
        <div className="table-scroll" style={{ marginTop: 8 }}>
          <table className="table cmp-table-small">
            <thead><tr><th>Candidate</th><th>Phone</th><th>Status</th><th>Tries</th><th>Outcome</th><th>Summary</th><th>Time</th><th /></tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 800 }}>{r.candidateName || '—'}</td><td>{r.toMask || '—'}</td><td>{callPill(r)}{(r.failReason || r.waitReason) && <span className="cmp-sub">{short(r.failReason || r.waitReason, 60)}</span>}</td>
                  <td>{r.attempts}/{r.maxAttempts}</td><td>{r.outcome || '—'}{r.interest ? <span className="cmp-sub">{r.interest}</span> : null}</td><td title={r.summary || ''}>{short(r.summary)}</td>
                  <td>{r.durationSec ? `${r.durationSec}s` : '—'}{r.endedAt ? <span className="cmp-sub">{dt(r.endedAt)}</span> : null}</td>
                  <td><Btn small onClick={() => setCall(r.id)}>Open</Btn></td>
                </tr>
              ))}
              {!d.rows.length && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>Nothing here.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: 10, color: 'var(--muted)' }}>
          <span>{d.total} call{d.total === 1 ? '' : 's'}</span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button type="button" className="tiny-btn" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>Page {page} of {pages}<button type="button" className="tiny-btn" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page">›</button></span>
        </div>
      </Panel>
      {call && <AiCallDetail id={call} onClose={() => setCall(null)} onChanged={load} />}
    </div>
  );
}

// ---- agents ------------------------------------------------------------------------------------------------------------------------
function Agents({ agents, canCall, onChanged, toast }) {
  const BLANK = { name: '', purpose: 'Screening', language: '', instructions: '', includeSalary: true, includeResponsibilities: true };
  const [f, setF] = useState(BLANK);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const purposes = ['Screening', 'Shortlist Notification', 'Interview Notification', 'Interview Reminder'];
  async function save() {
    setBusy(true); setMsg(null);
    try { await api.post('/ai-calling/voice/agents', { ...f, id: edit || undefined }); toast(edit ? 'Agent saved' : 'Agent added'); setF(BLANK); setEdit(null); onChanged(); } catch (e) { setMsg(errOf(e, 'The agent could not be saved.')); }
    setBusy(false);
  }
  async function remove(a) {
    if (!window.confirm(`Remove ${a.name}? Campaigns already made with it keep working.`)) return;
    try { await api.delete(`/ai-calling/voice/agents/${a.id}`); toast('Agent removed'); onChanged(); } catch (e) { toast(errOf(e, 'That did not work.')); }
  }
  return (
    <div>
      <Panel title="AI agents" sub="An agent is what the AI calls about (its purpose), the language it speaks and any extra wording. It uses TeamLink's own AI calling voice and brain, no other service. The built-in agents are the call types of AI Calling.">
        <div className="table-scroll">
          <table className="table cmp-table-small">
            <thead><tr><th>Agent</th><th>Calls about</th><th>Language</th><th>Extra wording</th><th /></tr></thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}><td style={{ fontWeight: 800 }}>{a.name}{a.builtin && <span className="cmp-sub">built in</span>}</td><td>{a.purpose}</td><td>{a.language || 'Each candidate\'s own'}</td><td>{a.instructions || '—'}</td>
                  <td style={{ display: 'flex', gap: 6 }}>{!a.builtin && canCall && <><Btn small onClick={() => { setEdit(a.id); setF({ name: a.name, purpose: a.purpose, language: a.language || '', instructions: a.instructions || '', includeSalary: a.includeSalary, includeResponsibilities: a.includeResponsibilities }); }}>Edit</Btn><Btn small danger onClick={() => remove(a)}>Remove</Btn></>}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {canCall && (
        <Panel title={edit ? 'Edit agent' : 'Add an agent'} sub="Example: “Telugu screening” that always speaks Telugu and adds a short note." right={edit ? <Btn small onClick={() => { setEdit(null); setF(BLANK); }}>Cancel</Btn> : null}>
          {msg && <Banner tone="error">{msg}</Banner>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12, margin: '8px 0' }}>
            <Field label="Name"><input value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Calls about"><select value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })}>{purposes.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
            <Field label="Language"><select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}><option value="">Each candidate's own</option>{LANG.map((l) => <option key={l} value={l}>{l}</option>)}</select></Field>
            <Field label="Extra wording (optional)" hint="Short. Never words like selected, hired or offered."><input value={f.instructions} maxLength={200} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></Field>
          </div>
          <label style={{ fontSize: 11, marginRight: 14 }}><input type="checkbox" checked={f.includeSalary} onChange={(e) => setF({ ...f, includeSalary: e.target.checked })} /> Mention the salary</label>
          <label style={{ fontSize: 11 }}><input type="checkbox" checked={f.includeResponsibilities} onChange={(e) => setF({ ...f, includeResponsibilities: e.target.checked })} /> Mention the responsibilities</label>
          <div style={{ marginTop: 12 }}><Btn primary disabled={busy} onClick={save}>{busy ? 'Saving…' : (edit ? 'Save agent' : 'Add agent')}</Btn></div>
        </Panel>
      )}
    </div>
  );
}
