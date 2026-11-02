import { useRef } from 'react';
import api from '../../api';
import './CourseFiles.css';

// ---------------------------------------------------------------------------
// COURSE FILES — the "Add document" / "Add video" picker used by the New
// Course form (files are queued, then uploaded once the course exists) and by
// the course's Materials panel (uploaded straight away).
//
// The types and sizes here MIRROR backend/src/utils/lmsMedia.js, which is the
// real gate: it checks the extension AND the declared type, reads the first
// bytes of the file, stores it under a random server-made name and refuses
// anything over the cap with a 413. This side only says no earlier, in the
// same words, so nobody waits for a big upload that was never going to fit.
// ---------------------------------------------------------------------------

const MB = 1024 * 1024;
export const LIMITS = {
  Video: { max: 10 * 1024 * MB, ext: ['mp4', 'webm', 'mov', 'm4v', 'ogv'] },
  Document: { max: 25 * MB, ext: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'png', 'jpg', 'jpeg', 'webp'] },
};
export const LIMITS_TEXT = 'Videos: MP4, WebM or MOV, up to 10 GB (a big video is sent in small pieces - keep the window open). Documents: PDF, Word, PowerPoint, Excel, text or a picture, up to 25 MB (Word / PowerPoint / Excel open as PDF inside the app).';

const ACCEPT = {
  Video: '.mp4,.webm,.mov,.m4v,.ogv,video/mp4,video/webm,video/quicktime',
  Document: '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.webp',
};

const extOf = (name) => {
  const s = String(name || '');
  const i = s.lastIndexOf('.');
  return i > 0 ? s.slice(i + 1).toLowerCase() : '';
};

export function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

// '' when the file may go up as this kind, or the reason it may not.
export function checkFile(file, kind) {
  const ext = extOf(file.name);
  const other = kind === 'Video' ? 'Document' : 'Video';
  if (!LIMITS[kind].ext.includes(ext)) {
    if (LIMITS[other].ext.includes(ext)) {
      return kind === 'Video' ? 'This is a document, not a video — use "Add document".' : 'This is a video — use "Add video".';
    }
    return kind === 'Video'
      ? 'This kind of video can\'t be added. Use MP4, WebM or MOV.'
      : 'This kind of file can\'t be added. Use PDF, Word, PowerPoint, Excel, text or a picture.';
  }
  if (!file.size) return 'This file is empty.';
  if (file.size > LIMITS[kind].max) {
    return kind === 'Video' ? 'This video is bigger than 10 GB.' : 'This document is bigger than 25 MB.';
  }
  return '';
}

// Uploads one file against a course. STREAMED: the request body is the file
// itself, so a long video is written to disk as it arrives. Resolves to the
// material, or rejects with a human sentence.
// BIG FILES GO IN PIECES (founder 2026-11-02: "video kuda ekkuva GBs tho upload chestaru thisukovali"): anything over 900 KB is sent as
// 8 MB pieces (900 KB ones when the web server in front refuses bigger bodies - the live site's nginx took about 1 MB on 2-Nov) (POST upload-start -> PUT per piece -> POST upload-finish), each piece tried up to 4 times, so a slow line or a short
// network drop does not lose a long upload. The server tells the next offset when a piece arrives twice.
const PIECES_FROM = 900 * 1024;
const SMALL_PIECE = 900 * 1024;
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
async function uploadInPieces(courseId, { file, kind, required }, onPct) {
  const title = file.name.replace(/\.[^.]+$/, '') || file.name;
  const start = await api.post(`/lms/courses/${courseId}/materials/upload-start`, { fileName: file.name, size: file.size, contentType: file.type || '' });
  const { uploadId } = start.data;
  let { chunkSize } = start.data;
  let offset = 0;
  while (offset < file.size) {
    const piece = file.slice(offset, Math.min(offset + chunkSize, file.size));
    let sent = false;
    for (let tryNo = 1; tryNo <= 4 && !sent; tryNo += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await api.put(`/lms/material-uploads/${uploadId}`, piece, {
          params: { offset },
          headers: { 'Content-Type': 'application/octet-stream' },
          onUploadProgress: (p) => { if (onPct) onPct(Math.min(99, Math.round(((offset + (p.loaded || 0)) / file.size) * 100))); },
        });
        offset = r.data.received;
        sent = true;
      } catch (err) {
        const d = err.response?.data || {};
        if (d.code === 'WRONG_OFFSET' && Number.isFinite(d.received)) { offset = d.received; sent = true; break; }
        // 413 from the web server in front (not from TeamLink, which answers with a code): it takes only small bodies, so the
        // pieces become 900 KB and this one is sent again (live 2026-11-02: nginx took about 1 MB).
        if (err.response?.status === 413 && !d.code && chunkSize > SMALL_PIECE) { chunkSize = SMALL_PIECE; break; }
        if (err.response && err.response.status < 500 && err.response.status !== 408) throw err;
        if (tryNo === 4) throw err;
        // eslint-disable-next-line no-await-in-loop
        await wait(1500 * tryNo);
      }
    }
  }
  const done = await api.post(`/lms/courses/${courseId}/materials/upload-finish`, { uploadId, title, kind, required });
  if (onPct) onPct(100);
  return done.data;
}

export async function uploadMaterial(courseId, { file, kind, required = true }, onPct) {
  try {
    if (file.size > PIECES_FROM) return await uploadInPieces(courseId, { file, kind, required }, onPct);
    const res = await api.post(`/lms/courses/${courseId}/materials`, file, {
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
      params: { title: file.name.replace(/\.[^.]+$/, '') || file.name, kind, required },
      onUploadProgress: (p) => { if (onPct && p.total) onPct(Math.round((p.loaded / p.total) * 100)); },
    });
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.error;
    if (msg) throw new Error(msg);
    if (status === 413) throw new Error(kind === 'Video' ? 'This video is bigger than 10 GB.' : 'This document is bigger than 25 MB.');
    if (status === 403) throw new Error('You are not allowed to add files to this course.');
    throw new Error('The upload stopped before it finished. Check your internet and try again.');
  }
}

let seq = 0;
// A picked file as the list holds it.
export function newItem(file, kind) {
  seq += 1;
  const error = checkFile(file, kind);
  return { key: `f${seq}`, file, kind, status: error ? 'failed' : 'waiting', pct: 0, error };
}

const STATUS_TEXT = { waiting: 'Ready', uploading: 'Uploading', done: 'Added', failed: 'Not added' };

// Two plain buttons and the list of picked files. `onPick(items)` gets the new
// items; `onRemove(key)` drops one (only offered while it is not uploading).
export default function CourseFilesPicker({ items, onPick, onRemove, disabled, hint = true, buttons = true }) {
  const docRef = useRef(null);
  const vidRef = useRef(null);

  function picked(e, kind) {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // the same file can be picked again after a remove
    if (files.length) onPick(files.map((f) => newItem(f, kind)));
  }

  return (
    <div className="cfiles">
      {buttons && (
        <div className="cfiles-btns">
          <button type="button" className="btn" disabled={disabled} onClick={() => docRef.current?.click()}>
            <span aria-hidden="true">📄</span> Add document
          </button>
          <button type="button" className="btn" disabled={disabled} onClick={() => vidRef.current?.click()}>
            <span aria-hidden="true">🎬</span> Add video
          </button>
          <input ref={docRef} type="file" multiple hidden accept={ACCEPT.Document} onChange={(e) => picked(e, 'Document')} />
          <input ref={vidRef} type="file" multiple hidden accept={ACCEPT.Video} onChange={(e) => picked(e, 'Video')} />
        </div>
      )}
      {hint && <div className="cfiles-hint">{LIMITS_TEXT}</div>}
      {items.length > 0 && (
        <ul className="cfiles-list">
          {items.map((it) => (
            <li key={it.key} className={`cfiles-item is-${it.status}`}>
              <span className="cfiles-icon" aria-hidden="true">{it.kind === 'Video' ? '🎬' : '📄'}</span>
              <span className="cfiles-name">
                <span className="cfiles-file">{it.file.name}</span>
                <span className="cfiles-meta">
                  {fmtSize(it.file.size)}
                  {' · '}
                  <b className="cfiles-state">{it.status === 'uploading' ? `Uploading ${it.pct}%` : STATUS_TEXT[it.status]}</b>
                  {it.error ? <> — {it.error}</> : null}
                </span>
                {it.status === 'uploading' && (
                  <span className="cfiles-bar" aria-hidden="true"><span style={{ width: `${it.pct}%` }} /></span>
                )}
              </span>
              {it.status !== 'uploading' && it.status !== 'done' && onRemove && (
                <button type="button" className="cfiles-x" aria-label={`Remove ${it.file.name}`} title="Remove" onClick={() => onRemove(it.key)}>×</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
