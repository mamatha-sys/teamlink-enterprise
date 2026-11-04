import { useEffect, useState } from 'react';
import api from '../../api';

// "PC ACTIVITY" ON THE ATTENDANCE SCREENS (Employee Monitoring, 2026-11-04): the first and last activity on the office PC that
// day, under the marked check-in / check-out. It is shown beside them and never changes them.
// Data: GET /api/monitoring/pc-activity?from=&to= (HR / Admin: everyone; an employee: their own days).
export function usePcActivity(from, to) {
  const [rows, setRows] = useState({});
  useEffect(() => {
    if (!from) return undefined;
    let live = true;
    api.get('/monitoring/pc-activity', { params: { from, to: to || from } })
      .then((r) => { if (live) setRows((r.data && r.data.rows) || {}); })
      .catch(() => { if (live) setRows({}); });
    return () => { live = false; };
  }, [from, to]);
  return rows;
}

const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }) : '');

// which: 'first' (under check-in) | 'last' (under check-out)
export function PcLine({ pc, which }) {
  if (!pc || !pc[which]) return null;
  return (
    <div className="small-muted" title={which === 'first' ? 'First activity on the office PC (Employee Monitoring)' : 'Last activity on the office PC (Employee Monitoring)'}>
      {`PC ${hm(pc[which])}`}
    </div>
  );
}
