import { useEffect, useRef, useState } from 'react';
import api from '../api';

// A picture or video on a notice. The API needs the login header, so the file comes as a blob: a picture opens by itself, a video on Play (it can be 50 MB).
export default function NoticeMedia({ a }) {
  const [url, setUrl] = useState('');
  const [state, setState] = useState('');
  const urlRef = useRef('');
  const load = () => {
    setState('loading');
    api.get(`/announcements/${a.id}/media`, { responseType: 'blob' })
      .then((res) => { urlRef.current = URL.createObjectURL(res.data); setUrl(urlRef.current); setState(''); })
      .catch(() => setState('failed'));
  };
  const isVideo = a.media.kind === 'video';
  useEffect(() => {
    if (!isVideo) load();
    return () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, [a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const box = { display: 'block', maxWidth: '100%', maxHeight: 360, borderRadius: 8, marginTop: 8 };
  if (state === 'failed') return <div className="small-muted" style={{ marginTop: 8 }}>The {isVideo ? 'video' : 'picture'} could not be opened. <button type="button" className="btn btn-sm" onClick={load}>Try again</button></div>;
  if (url) return isVideo ? <video src={url} controls autoPlay style={box} /> : <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={a.media.name || a.title} style={box} /></a>;
  if (isVideo) return <div style={{ marginTop: 8 }}><button type="button" className="btn btn-sm" disabled={state === 'loading'} onClick={load}>{state === 'loading' ? 'Opening…' : '▶ Play video'}</button></div>;
  return <div className="small-muted" style={{ marginTop: 8 }}>Opening the picture…</div>;
}
