import ReachButtons from './ReachButtons.jsx';
import { useReachRights } from './reachKit.js';
import './reach.css';

// ---------------------------------------------------------------------------
// THE ONE BULK BAR of the Candidates list and the Progress board (no dropdown, no "More actions"):
//
//   line 1   "4 selected"                                   Select all 7,790 · [Cancel]
//   line 2   Contact them   [Call] [WhatsApp] [SMS] [Email]      (only for logins that may contact:
//            Manage them    [Assign recruiter] [Move step] …      BDE / BDE TL / Accounts never see it)
//   line 3   Also:          [Schedule interview] [Put on hold] [Reject]
//
// Every button has an icon and a word. It sticks to the top while the list scrolls (bottom on a phone),
// and the groups stack on a narrow screen.
//   manage / also : [{ key, label, icon, onClick, danger }]
//   aiCall        : { onClick, count } - "AI call" beside Call / WhatsApp (founder 2026-11-03: bulk AI calls from this page)
// ---------------------------------------------------------------------------
export default function ReachBulkBar({
  selected, people, items, selectAll = null, onCancel, onDone, manage = [], also = [], note = null, children = null, aiCall = null,
}) {
  const rights = useReachRights();
  const btn = (b) => (
    <button key={b.key} type="button" className={`btn btn-sm rch-m${b.danger ? ' is-danger' : ''}`} onClick={b.onClick}>
      <span aria-hidden="true">{b.icon}</span> {b.label}
    </button>
  );
  return (
    <div className="rch-bar" role="region" aria-label="Selected candidates">
      <div className="rch-bar-top">
        <b className="rch-bar-count">{`${selected.toLocaleString('en-IN')} selected`}</b>
        {people && people !== selected && <span className="small-muted">{`(${people.toLocaleString('en-IN')} people)`}</span>}
        <span className="rch-bar-spacer" />
        {selectAll && <button type="button" className="link-btn" onClick={selectAll.onClick}>{selectAll.label}</button>}
        <button type="button" className="btn btn-sm rch-b-cancel" onClick={onCancel}>Cancel</button>
      </div>
      <div className="rch-groups">
        {((rights.loaded && rights.one) || aiCall) && (
          <div className="rch-group is-contact">
            <div className="rch-cap">Contact them</div>
            <div className="rch-btns">
              {rights.loaded && rights.one && <ReachButtons items={items} onDone={onDone} />}
              {aiCall && (
                <button type="button" className="btn btn-sm rch-m" onClick={aiCall.onClick} title="The AI assistant phones them from TeamLink's line, a few at a time, and records each answer">
                  <span aria-hidden="true">🤖</span> {`AI call${aiCall.count > 1 ? ` (${aiCall.count})` : ''}`}
                </button>
              )}
            </div>
          </div>
        )}
        {manage.length > 0 && (
          <div className="rch-group">
            <div className="rch-cap">Manage them</div>
            <div className="rch-btns">{manage.map(btn)}</div>
          </div>
        )}
      </div>
      {also.length > 0 && (
        <div className="rch-also">
          <span className="rch-cap">Also:</span>
          <div className="rch-btns">{also.map(btn)}</div>
        </div>
      )}
      {children}
      {note && <div className="small-muted rch-note">{note}</div>}
    </div>
  );
}
