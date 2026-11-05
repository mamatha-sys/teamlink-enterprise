import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api';
import { useOmni } from '../omniContext.js';
import { PageHead, Panel, Field, Btn, Banner, Pill, Tabs, GsModal, ConfirmModal, Empty, fmtDateTime } from '../ui.jsx';
import { errOf } from '../omniApi.js';

// ---------------------------------------------------------------------------
// SETTINGS > WHATSAPP AI (Admin): the connection as it stands (tokens are typed in Administration > Integrations and are never shown), the AI settings, the knowledge base
// and what the AI did. Server: /api/omni-wa/settings, /connection, /knowledge, /runs. The AI is OFF until an Admin switches it on.
// ---------------------------------------------------------------------------
const BASE = '/omni-wa';
const OUTCOME = { replied: ['live', 'Replied'], not_interested: ['draft', 'Not interested'], handoff_tool: ['warn', 'Passed to a person'], handoff_asked: ['warn', 'Asked for a person'], handoff_abuse: ['red', 'Abusive message'], handoff_limit: ['warn', 'Reply limit reached'], after_hours: ['draft', 'After working hours'], blocked_by_guard: ['red', 'Draft stopped by the safety check'], model_error: ['red', 'AI failed'], send_failed: ['red', 'Could not send'], paused: ['warn', 'A person is answering'], lead: ['draft', 'New number'], error: ['red', 'Error'] };

function Connection() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get(`${BASE}/connection`).then((r) => setD(r.data)).catch((e) => setErr(errOf(e, 'The connection could not be read.'))); }, []);
  if (err) return <Banner tone="warn">{err}</Banner>;
  if (!d) return <div className="small-muted">Loading…</div>;
  return (
    <Panel title="WhatsApp connection" sub="Phone number ID, access token and webhook verify token are kept encrypted on the server and are never shown here. Change them in Administration > Integrations.">
      {d.numbers.length === 0 && <p className="small-muted">No number in the list: the single connection in Administration &gt; Integrations is used.</p>}
      {d.numbers.map((n) => (
        <div key={n.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '6px 0' }}>
          <b>{n.label}</b><span className="small-muted">{n.display}</span><span className="small-muted">Number ID {n.phoneNumberId || '—'}</span>
          <Pill tone={n.active ? 'live' : 'draft'}>{n.active ? 'On' : 'Off'}</Pill>
          <Pill tone={n.hasToken ? 'live' : 'red'}>{n.hasToken ? 'Token saved' : 'No token'}</Pill>
          <Pill tone={n.hasVerifyToken ? 'live' : 'red'}>{n.hasVerifyToken ? 'Verify token saved' : 'No verify token'}</Pill>
          <Pill tone={n.hasAppSecret ? 'live' : 'red'}>{n.hasAppSecret ? 'App secret saved' : 'No app secret'}</Pill>
        </div>
      ))}
      <p className="small-muted">{d.webhook ? `Meta last called the webhook on ${fmtDateTime(d.webhook.at)}.` : 'Meta has not called the webhook yet.'} <Link to="/admin/integrations">Open Integrations</Link></p>
    </Panel>
  );
}

function AiForm() {
  const { toast } = useOmni();
  const [c, setC] = useState(null);
  const [model, setModel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { api.get(`${BASE}/settings`).then((r) => { setC({ ...r.data.config, testNumbers: r.data.config.testNumbers.join(', ') }); setModel(r.data.model); }).catch((e) => setErr(errOf(e, 'The settings could not be read.'))); }, []);
  if (err && !c) return <Banner tone="warn">{err}</Banner>;
  if (!c) return <div className="small-muted">Loading…</div>;
  const set = (k) => (e) => setC((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async () => {
    setBusy(true); setErr('');
    try { const r = await api.put(`${BASE}/settings`, c); setC({ ...r.data, testNumbers: r.data.testNumbers.join(', ') }); toast('Saved.'); } catch (e) { setErr(errOf(e, 'The settings could not be saved.')); } finally { setBusy(false); }
  };
  return (
    <Panel title="AI assistant" sub="It answers only people who replied to a promotion, or a chat it is already in. Everyone else is left to your team.">
      {model && !model.available && <Banner tone="warn">The AI model is not ready: {model.reason || 'it does not answer'}. Until then people get the fallback message and the chat goes to a recruiter.</Banner>}
      {err && <Banner tone="warn">{err}</Banner>}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}><input type="checkbox" checked={c.enabled} onChange={set('enabled')} /><b>AI replies on WhatsApp</b></label>
      <Field label="Only these numbers (for a test)" hint="Leave empty to answer everybody. With numbers here the AI answers only them."><input className="input" value={c.testNumbers} onChange={set('testNumbers')} placeholder="919876543210" /></Field>
      <Field label="Model" hint={`Empty = the app's model${model && model.model ? ` (${model.model})` : ''}`}><input className="input" value={c.model} onChange={set('model')} /></Field>
      <Field label="System prompt" hint="Who the assistant is and how it talks. The safety rules are added by TeamLink and cannot be removed here."><textarea className="input" rows={6} value={c.systemPrompt} onChange={set('systemPrompt')} /></Field>
      <Field label="Fallback message" hint="Sent when the AI cannot answer, outside working hours and when a chat goes to a person."><textarea className="input" rows={2} value={c.fallbackMessage} onChange={set('fallbackMessage')} /></Field>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}><input type="checkbox" checked={c.hoursOn} onChange={set('hoursOn')} /><span>Answer only in working hours (India time)</span></label>
      {c.hoursOn && (
        <div style={{ display: 'flex', gap: 12 }}>
          <Field label="From"><input className="input" type="time" value={c.hoursFrom} onChange={set('hoursFrom')} /></Field>
          <Field label="To"><input className="input" type="time" value={c.hoursTo} onChange={set('hoursTo')} /></Field>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <Field label="AI replies before a person takes over"><input className="input" type="number" min="1" max="50" value={c.maxTurns} onChange={set('maxTurns')} /></Field>
        <Field label="Messages it remembers"><input className="input" type="number" min="2" max="40" value={c.memoryCount} onChange={set('memoryCount')} /></Field>
        <Field label="Wait for more messages (seconds)"><input className="input" type="number" min="2" max="120" value={c.debounceSeconds} onChange={set('debounceSeconds')} /></Field>
        <Field label="A reply counts for a promotion for (days)"><input className="input" type="number" min="1" max="30" value={c.promoDays} onChange={set('promoDays')} /></Field>
      </div>
      <Btn primary onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn>
    </Panel>
  );
}

function Knowledge() {
  const { toast } = useOmni();
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  const [gone, setGone] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api.get(`${BASE}/knowledge`).then((r) => setRows(r.data.entries)).catch((e) => setErr(errOf(e, 'The entries could not be read.'))), []);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    setErr('');
    try {
      if (edit.id) await api.put(`${BASE}/knowledge/${edit.id}`, edit); else await api.post(`${BASE}/knowledge`, edit);
      setEdit(null); toast('Saved.'); load();
    } catch (e) { setErr(errOf(e, 'This could not be saved.')); }
  };
  const remove = async () => { await api.delete(`${BASE}/knowledge/${gone.id}`).catch(() => {}); setGone(null); load(); };
  return (
    <Panel title="Knowledge base" sub="Questions about the company and the process. The AI answers only from these and the job details." right={<Btn primary small onClick={() => setEdit({ question: '', answer: '', active: true })}>New</Btn>}>
      {err && !edit && <Banner tone="warn">{err}</Banner>}
      {rows && rows.length === 0 && <Empty title="No entries yet">Add the questions candidates ask most. Without entries the AI passes those questions to a recruiter.</Empty>}
      {(rows || []).map((r) => (
        <div key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line, #e5e7eb)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><b style={{ flex: 1 }}>{r.question}</b>{!r.active && <Pill>Off</Pill>}<Btn small onClick={() => setEdit(r)}>Edit</Btn><Btn small danger onClick={() => setGone(r)}>Delete</Btn></div>
          <div className="small-muted" style={{ whiteSpace: 'pre-wrap' }}>{r.answer}</div>
        </div>
      ))}
      {edit && (
        <GsModal title={edit.id ? 'Edit entry' : 'New entry'} onClose={() => setEdit(null)} foot={<Btn primary onClick={save}>Save</Btn>}>
          {err && <Banner tone="warn">{err}</Banner>}
          <Field label="Question"><input className="input" value={edit.question} onChange={(e) => setEdit({ ...edit, question: e.target.value })} /></Field>
          <Field label="Answer"><textarea className="input" rows={5} value={edit.answer} onChange={(e) => setEdit({ ...edit, answer: e.target.value })} /></Field>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={edit.active !== false} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />In use</label>
        </GsModal>
      )}
      {gone && <ConfirmModal title="Delete this entry?" text={gone.question} yes="Delete" danger onYes={remove} onNo={() => setGone(null)} />}
    </Panel>
  );
}

// a number that wrote STOP gets nothing and the AI stays out, until an Admin takes it off the lists with a reason
function Blocked() {
  const { toast } = useOmni();
  const [number, setNumber] = useState('');
  const [reason, setReason] = useState('');
  const [state, setState] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true); setErr(''); setState(null);
    try { const r = await api.get(`${BASE}/blocked`, { params: { number } }); setState(r.data); } catch (e) { setErr(errOf(e, 'The number could not be checked.')); } finally { setBusy(false); }
  };
  const unblock = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post(`${BASE}/unblock`, { number, reason }); setState(r.data); setReason(''); toast('Unblocked.'); } catch (e) { setErr(errOf(e, 'The number could not be unblocked.')); } finally { setBusy(false); }
  };
  return (
    <Panel title="Blocked numbers" sub="A number that wrote STOP gets no messages and no AI replies. Unblock it only if the person asked to hear from you again.">
      {err && <Banner tone="warn">{err}</Banner>}
      <Field label="Mobile number"><input className="input" value={number} onChange={(e) => { setNumber(e.target.value); setState(null); }} placeholder="9876543210" /></Field>
      <Btn onClick={check} disabled={busy || !number.trim()}>Check</Btn>
      {state && !state.blocked && <p style={{ marginTop: 10 }}><Pill tone="live">Not blocked</Pill></p>}
      {state && state.blocked && (
        <div style={{ marginTop: 10 }}>
          <p><Pill tone="red">Blocked</Pill> {state.since ? <span className="small-muted">since {fmtDateTime(state.since)}</span> : null}</p>
          <Field label="Why may they be messaged again?"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Btn primary onClick={unblock} disabled={busy || reason.trim().length < 5}>Unblock</Btn>
        </div>
      )}
    </Panel>
  );
}

function Runs() {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get(`${BASE}/runs`).then((r) => setRows(r.data.runs)).catch((e) => setErr(errOf(e, 'The log could not be read.'))); }, []);
  if (err) return <Banner tone="warn">{err}</Banner>;
  return (
    <Panel title="What the AI did" sub="The newest 100 runs: what came in, the tools it used, what it answered and any error.">
      {rows && rows.length === 0 && <Empty title="Nothing yet">The AI has not answered anybody.</Empty>}
      {(rows || []).map((r) => {
        const [tone, word] = OUTCOME[r.outcome] || ['draft', r.outcome];
        return (
          <div key={r.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line, #e5e7eb)' }}>
            <button type="button" className="tiny-btn" style={{ width: '100%', textAlign: 'left', display: 'flex', gap: 8, alignItems: 'center' }} aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
              <Pill tone={tone}>{word}</Pill><span>{r.name || 'Unknown'}</span><span className="small-muted" style={{ marginLeft: 'auto' }}>{fmtDateTime(r.at)}{r.ms ? ` · ${(r.ms / 1000).toFixed(1)} s` : ''}</span>
            </button>
            {open === r.id && (
              <div className="small-muted" style={{ whiteSpace: 'pre-wrap', padding: 6 }}>
                <div><b>In:</b> {r.input}</div>
                {r.toolCalls.map((t, i) => <div key={i}><b>Tool:</b> {t.tool} {JSON.stringify(t.args)}</div>)} {/* eslint-disable-line react/no-array-index-key */}
                {r.output && <div><b>Out:</b> {r.output}</div>}
                {r.error && <div><b>Problem:</b> {r.error}</div>}
              </div>
            )}
          </div>
        );
      })}
    </Panel>
  );
}

export default function WaAiSettingsPage() {
  const [tab, setTab] = useState('ai');
  return (
    <>
      <PageHead title="WhatsApp AI" lead="The AI assistant that answers replies to your promotions." />
      <Tabs tabs={[['ai', 'AI settings'], ['kb', 'Knowledge base'], ['runs', 'What the AI did'], ['blocked', 'Blocked numbers'], ['conn', 'Connection']]} value={tab} onChange={setTab} />
      {tab === 'ai' && <AiForm />}
      {tab === 'kb' && <Knowledge />}
      {tab === 'runs' && <Runs />}
      {tab === 'blocked' && <Blocked />}
      {tab === 'conn' && <Connection />}
    </>
  );
}
