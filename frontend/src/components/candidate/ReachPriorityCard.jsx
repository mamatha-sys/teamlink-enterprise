// BEST WAY TO REACH (founder 2026-11-04): AI call, phone, WhatsApp, SMS and Email ranked by how
// this person really answers - from the calls and messages already on record.
// Data: GET /candidates/:id/reach-priority (utils/reachPriority.js).
import { useEffect, useState } from 'react';
import api from '../../api';

const TONE = (c) => (c.score === null ? 'var(--muted, #667085)' : c.responded ? 'var(--green, #067647)' : 'var(--red, #b42318)');
const when = (iso) => {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

export default function ReachPriorityCard({ candidateId }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setData(null);
    setFailed(false);
    api.get(`/candidates/${candidateId}/reach-priority`).then((r) => { if (live) setData(r.data); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [candidateId]);
  if (failed) return null;
  return (
    <section className="pfl-card">
      <div className="pfl-label">Best way to reach</div>
      {!data ? <div className="small-muted">Checking…</div> : (
        <>
          <div style={{ fontSize: 13, marginBottom: 6 }}>
            {data.best ? <>Try <b>{data.best}</b> first. {data.basis}.</> : <span className="small-muted">{data.basis}.</span>}
            {data.preferred && <div className="small-muted">Marked by the team as preferred: {data.preferred}</div>}
          </div>
          <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            {data.channels.map((c) => (
              <li key={c.key}>
                <b>{c.key}</b>
                {' '}
                <span style={{ color: TONE(c), fontSize: 13 }}>{c.words}</span>
                {c.lastResponseAt && <span className="small-muted" style={{ fontSize: 12 }}> · last answer {when(c.lastResponseAt)}</span>}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
