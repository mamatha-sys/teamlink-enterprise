import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { viewAsToken } from '../../../api';
import Combo from '../../Combo.jsx';
import WaChatPane from '../../messaging/WaChatPane.jsx';
import { listTime, tickOf } from '../../messaging/waChatLogic.js';
import '../../messaging/conversation.css';
import '../../messaging/messaging.css';
import '../../messaging/waChats.css';
import { useOmni } from '../omniContext.js';
import { PageHead, Pill, Tabs, Btn, Banner, DataTable, fmtDateTime } from '../ui.jsx';
import { errOf } from '../omniApi.js';

// ---------------------------------------------------------------------------
// INBOX & REPLIES > WHATSAPP (founder 2026-11-05): the WhatsApp chats with the AI agent's state on top, and the promotion log. The chat itself is the app's existing chat pane
// (same bubbles, ticks, 24-hour rule and templates); a lead (a number with no candidate) has a small chat of its own here. The server decides what each login sees.
// New messages arrive by themselves: GET /api/omni-wa/stream says "something changed", then the list is read again through the normal route.
// ---------------------------------------------------------------------------
const BASE = '/omni-wa';
const FILTERS = [['all', 'All', 'all'], ['unread', 'Unread', 'unread'], ['ai', 'AI handled', 'ai'], ['human', 'Needs human', 'human']];
const TONE = { ai: 'live', needs_human: 'red', paused: 'warn', stopped: 'draft', not_interested: 'draft', human: 'draft' };
const STATUS_TONE = { sent: 'draft', delivered: 'scheduled', read: 'live', failed: 'red' };
const COLLECTED = { availability: 'Availability', expected_salary: 'Expected salary', notice_period: 'Notice period', location: 'Location', interested: 'Interested' };
const initials = (n) => String(n || '?').replace(/ZZTEST|\(.*\)/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';

// "something changed" from the server; a lost connection comes back by itself
function useLive(onChange) {
  const ref = useRef(onChange);
  ref.current = onChange;
  useEffect(() => {
    let stop = false;
    const ctrl = new AbortController();
    (async () => {
      while (!stop) {
        try {
          const token = viewAsToken() || localStorage.getItem('tl_token');
          // eslint-disable-next-line no-await-in-loop
          const res = await fetch(`/api${BASE}/stream`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
          if (!res.ok || !res.body) throw new Error('no stream');
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          for (;;) {
            // eslint-disable-next-line no-await-in-loop
            const { value, done } = await reader.read();
            if (done) break;
            if (dec.decode(value).includes('event: change')) ref.current();
          }
        } catch { /* wait and connect again */ }
        // eslint-disable-next-line no-await-in-loop
        if (!stop) await new Promise((r) => { setTimeout(r, 5000); });
      }
    })();
    return () => { stop = true; ctrl.abort(); };
  }, []);
}

function Row({ r, on, onPick }) {
  const tick = r.last.direction === 'out' ? tickOf(r.last.state) : null;
  return (
    <button type="button" className={`wc-row${r.unread > 0 ? ' unread' : ''}${on ? ' on' : ''}`} onClick={() => onPick(r)} aria-current={on ? 'true' : undefined}>
      <span className="wc-avatar" aria-hidden="true">{initials(r.name)}</span>
      <span className="wc-rowmain">
        <span className="wc-rowtop"><b className="wc-name">{r.name}</b><small className="wc-time">{listTime(r.last.at)}</small></span>
        {r.phoneHint && <span className="wc-req">{r.phoneHint}</span>}
        <span className="wc-prev">
          {tick && <span className={`wc-tick ${tick.tone}`} aria-label={tick.word}>{tick.glyph}</span>}
          <span className="wc-prevtext">{r.last.text || '(no words)'}</span>
          {r.unread > 0 && <span className="wc-badge" aria-label={`${r.unread} new`}>{r.unread}</span>}
        </span>
        <span className="wc-chips">
          <Pill tone={TONE[r.ai.badge] || 'draft'}>{r.ai.word}</Pill>
          {r.personType === 'LEAD' && <span className="wc-chip amber">New lead</span>}
          {r.requirement && <span className="wc-chip blue">{r.requirement.title || 'Requirement'}</span>}
          {r.ownerName && <span className="wc-chip grey">{r.ownerName}</span>}
        </span>
      </span>
    </button>
  );
}

// above the chat: who is answering, the 24-hour window, "already contacted", what the AI collected
function AiStrip({ chatKey, tick, onChanged }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    api.get(`${BASE}/conversations/${encodeURIComponent(chatKey)}`).then((r) => { if (alive) { setD(r.data); setErr(''); } }).catch((e) => { if (alive) setErr(errOf(e, 'The AI state could not be read.')); });
    return () => { alive = false; };
  }, [chatKey, tick]);
  const act = async (what) => {
    setBusy(true); setErr('');
    try { const r = await api.post(`${BASE}/conversations/${encodeURIComponent(chatKey)}/${what}`); setD(r.data); onChanged(); } catch (e) { setErr(errOf(e, 'That did not work. Try again.')); } finally { setBusy(false); }
  };
  if (err) return <div style={{ padding: '6px 10px' }}><Banner tone="warn">{err}</Banner></div>;
  if (!d) return null;
  const facts = Object.entries(d.collected || {}).filter(([k]) => COLLECTED[k]);
  const left = d.window.closesAt ? Math.max(0, d.window.closesAt - Date.now()) : 0;
  const hours = Math.floor(left / 3600000); const mins = Math.floor((left % 3600000) / 60000);
  return (
    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line, #e5e7eb)', display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Pill tone={TONE[d.ai.badge] || 'draft'} dot>{d.ai.word}</Pill>
        {d.window.open ? <Pill tone="live">24-hour window: {hours} h {mins} min left</Pill> : <Pill tone="warn">24-hour window closed: only an approved template</Pill>}
        {d.stopped && <Pill tone="red">Asked us to stop</Pill>}
        {d.ai.canPause && <Btn small onClick={() => act('pause')} disabled={busy}>Pause AI</Btn>}
        {d.ai.canResume && !d.stopped && <Btn small primary onClick={() => act('resume')} disabled={busy}>Give back to AI</Btn>}
      </div>
      {d.ai.reason && <div className="small-muted">Why a person is needed: {d.ai.reason}</div>}
      {d.ai.pausedBy && <div className="small-muted">AI paused by {d.ai.pausedBy}</div>}
      {d.alreadyContacted && <Banner tone="warn">Already contacted: {d.alreadyContacted.byName} reached this candidate on {d.alreadyContacted.channel}, {fmtDateTime(d.alreadyContacted.at)}.</Banner>}
      {facts.length > 0 && <div className="small-muted">The candidate told the AI: {facts.map(([k, v]) => `${COLLECTED[k]}: ${v === true ? 'Yes' : v === false ? 'No' : v}`).join(' · ')}</div>}
    </div>
  );
}

// a number with no candidate yet
function LeadChat({ row, tick, onChanged, onBack }) {
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const url = `${BASE}/conversations/${encodeURIComponent(row.key)}`;
  const load = useCallback(() => api.get(`${url}/messages`).then((r) => setMsgs(r.data.messages)).catch((e) => setErr(errOf(e, 'This chat could not be opened.'))), [url]);
  useEffect(() => { load(); }, [load, tick]);
  const send = async () => {
    setBusy(true); setErr('');
    try { await api.post(`${url}/send`, { text }); setText(''); await load(); onChanged(); } catch (e) { setErr(errOf(e, 'The message could not be sent.')); } finally { setBusy(false); }
  };
  return (
    <div className="wc-pane">
      <div style={{ padding: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Btn small ghost onClick={onBack}>Back</Btn><b>{row.name}</b><span className="small-muted">{row.phoneHint}</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'grid', gap: 6, alignContent: 'start' }}>
        {msgs === null && !err && <div className="small-muted">Loading…</div>}
        {(msgs || []).map((m) => (
          <div key={m.id} style={{ justifySelf: m.direction === 'IN' ? 'start' : 'end', maxWidth: '78%', background: m.direction === 'IN' ? 'var(--surface-2, #f3f4f6)' : 'var(--green-soft, #dcfce7)', borderRadius: 10, padding: '6px 10px', whiteSpace: 'pre-wrap' }}>
            {m.text}
            <div className="small-muted" style={{ fontSize: 11 }}>{m.ai ? 'AI · ' : (m.by ? `${m.by} · ` : '')}{fmtDateTime(m.at)}</div>
          </div>
        ))}
      </div>
      {err && <div style={{ padding: '0 10px' }}><Banner tone="warn">{err}</Banner></div>}
      <div style={{ padding: 10, display: 'flex', gap: 8 }}>
        <textarea className="input" rows={2} style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a reply" aria-label="Reply" />
        <Btn primary onClick={send} disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send'}</Btn>
      </div>
    </div>
  );
}

function Chats() {
  const [f, setF] = useState({ filter: 'all', q: '', owner: '', requirementId: '', campaign: '' });
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => api.get(`${BASE}/conversations`, { params: f }).then((r) => { setData(r.data); setErr(''); }).catch((e) => setErr(errOf(e, 'The chats could not be loaded.'))), [f]);
  useEffect(() => { const t = setTimeout(load, f.q ? 300 : 0); return () => clearTimeout(t); }, [load, f.q]);
  useEffect(() => { api.get('/wa-chats/config').then((r) => setCfg(r.data)).catch(() => setCfg(false)); }, []);
  const refresh = useCallback(() => { load(); setTick((n) => n + 1); }, [load]);
  useLive(refresh);
  useEffect(() => { const t = setInterval(refresh, 30000); return () => clearInterval(t); }, [refresh]); // the push may be cut by a proxy: this keeps the list true

  const selRow = useMemo(() => (sel && data ? data.rows.find((r) => r.key === sel.key) || sel : sel), [sel, data]);
  const pick = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div className="wc-wrap">
      <div className="wc-shell">
        <aside className="wc-list" aria-label="WhatsApp chats">
          <div className="wc-filters">
            <input className="input" value={f.q} onChange={pick('q')} placeholder="Search a name or number" aria-label="Search chats" />
            <div className="msg-filter" role="group" aria-label="Show">
              {FILTERS.map(([id, word, cnt]) => <button key={id} type="button" className={`msg-chip${f.filter === id ? ' on' : ''}`} onClick={() => setF((x) => ({ ...x, filter: id }))}>{word}{data ? ` (${data.counts[cnt]})` : ''}</button>)}
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {data && data.owners.length > 1 && (
                <Combo value={f.owner} onChange={pick('owner')} emptyText="No such recruiter" aria-label="Recruiter">
                  <option value="">All recruiters</option>
                  {data.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Combo>
              )}
              {data && data.requirements.length > 1 && (
                <Combo value={f.requirementId} onChange={pick('requirementId')} emptyText="No such job" aria-label="Job">
                  <option value="">All jobs</option>
                  {data.requirements.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                </Combo>
              )}
              {data && data.campaigns.length > 0 && (
                <Combo value={f.campaign} onChange={pick('campaign')} emptyText="No such campaign" aria-label="Campaign">
                  <option value="">All campaigns</option>
                  {data.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Combo>
              )}
            </div>
          </div>
          <div className="wc-rows">
            {err && <div className="msg-box red">{err} <button type="button" className="btn btn-sm" onClick={load}>Try again</button></div>}
            {!data && !err && <div className="wc-skel-list" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="wc-skel wc-skel-row" />)}</div>}
            {data && data.rows.length === 0 && <div className="wc-empty">No chats here. When someone writes on WhatsApp, the chat appears by itself.</div>}
            {data && data.rows.map((r) => <Row key={r.key} r={r} on={!!sel && sel.key === r.key} onPick={setSel} />)}
          </div>
        </aside>
        <section className="wc-chatcol" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {!sel && <div className="wc-pane wc-none">Pick a chat on the left to read it and answer.</div>}
          {sel && <AiStrip key={`s${sel.key}`} chatKey={sel.key} tick={tick} onChanged={refresh} />}
          {sel && sel.personType === 'LEAD' && <LeadChat key={sel.key} row={selRow} tick={tick} onChanged={refresh} onBack={() => setSel(null)} />}
          {sel && sel.personType !== 'LEAD' && cfg && <WaChatPane key={sel.key} audience={sel.audience} personId={sel.personId} row={selRow} cfg={cfg} nudge={tick} onBack={() => setSel(null)} onRead={load} onChanged={load} />}
        </section>
      </div>
    </div>
  );
}

function Promotions() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api.get(`${BASE}/promotions`).then((r) => setD(r.data)).catch((e) => setErr(errOf(e, 'The promotions could not be loaded.'))), []);
  useEffect(() => { load(); }, [load]);
  useLive(load);
  const columns = [
    { key: 'at', label: 'Sent', render: (r) => fmtDateTime(r.at) },
    { key: 'candidateName', label: 'Candidate' },
    { key: 'jobTitle', label: 'Job', render: (r) => r.jobTitle || '—' },
    { key: 'campaignName', label: 'Campaign', render: (r) => r.campaignName || '—' },
    { key: 'template', label: 'Template', render: (r) => r.template || '—' },
    { key: 'senderName', label: 'Recruiter', render: (r) => r.senderName || '—' },
    { key: 'status', label: 'Status', render: (r) => <span title={r.statusDetail || ''}><Pill tone={STATUS_TONE[r.status] || 'draft'}>{r.status}</Pill></span> },
  ];
  if (err) return <Banner tone="warn">{err}</Banner>;
  return (
    <>
      {d && <p className="small-muted">{d.counts.sent} sent · {d.counts.delivered} delivered · {d.counts.read} read · {d.counts.failed} failed. Send a promotion from the candidate list: tick the candidates, then WhatsApp.</p>}
      <DataTable columns={columns} rows={d ? d.rows : []} loading={!d} emptyText="No promotions yet. Tick candidates in the candidate list and press WhatsApp." />
    </>
  );
}

export default function WhatsAppPage() {
  useOmni();
  const [tab, setTab] = useState('chats');
  return (
    <>
      <PageHead title="WhatsApp" lead="Chats with the AI assistant and your recruiters, and every promotion you sent." />
      <Tabs tabs={[['chats', 'Chats'], ['promotions', 'Promotions']]} value={tab} onChange={setTab} />
      {tab === 'chats' ? <Chats /> : <Promotions />}
    </>
  );
}
