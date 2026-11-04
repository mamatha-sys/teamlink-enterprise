// ---------------------------------------------------------------------------
// QUICK FILL FOR A REQUIREMENT REQUEST (founder 2026-11-04: "req create chesetappu,
// mottham vallaey type chekuney pani lekunda, vallu oka specific keywords, keyskills
// etc... ilaaga pedithey, automatic ga inka create ayeyelaaga").
//
// A client writes a few words on the portal ("Staff nurse, ICU, BLS, 2-5 years,
// Hyderabad, 25k-35k, 5 openings, immediate") and gets the request form filled:
// title, skills, experience, location, openings, monthly salary, joining time,
// work mode and a job description. Nothing is saved here: the client checks the
// form and presses Send, which is the ordinary request (utils/requirementRequest.js)
// that reaches their BDE.
//
// fill(text, { clientName, clientLocation }) -> { fields, jobDescription, responsibilities, by }
//   by = 'rules' (always works, no AI) or 'ai' (a better description when the
//   Claude key is set up in Integrations; a slow / missing model falls back to rules).
// ---------------------------------------------------------------------------

const MAX_TEXT = 1500;
const AI_TIMEOUT_MS = Number(process.env.REQUEST_AUTOFILL_AI_MS) || 20000;

const titleCase = (s) => String(s || '').trim().replace(/\s+/g, ' ')
  .replace(/\b([a-z])([a-z]*)/g, (m, a, b) => (m.length <= 3 && /^(icu|ot|it|hr|bls|acls|gnm|bsc|msc|mba|bba|bca|mca|qa|ui|ux|sql|crm|erp|sap|bpo|kpo|cnc|plc|ccu|nicu|er)$/i.test(m) ? m.toUpperCase() : a.toUpperCase() + b));
const num = (s) => Number(String(s).replace(/,/g, ''));

// "25k" -> 25000, "25,000" -> 25000, "2.5 lakh" (a month) -> 250000
function rupeesOf(n, unit) {
  const v = num(n);
  if (!Number.isFinite(v)) return null;
  if (/^k$/i.test(unit || '')) return Math.round(v * 1000);
  if (/^(l|lakh|lakhs|lac|lacs)$/i.test(unit || '')) return Math.round(v * 100000);
  return Math.round(v);
}

// Pieces the rules recognise. Each returns { value, used: [text spans] }.
function findExperience(t) {
  if (/\bfreshers?\b/i.test(t)) return { value: '0-1', span: t.match(/\bfreshers?\b/i)[0] };
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*\+?\s*(?:yrs?|years?|yr exp|years? exp(?:erience)?)\b/i);
  if (m) return { value: `${num(m[1])}-${num(m[2])}`, span: m[0] };
  m = t.match(/(?:min(?:imum)?\s*)?(\d+(?:\.\d+)?)\s*\+?\s*(?:yrs?|years?)(?:\s*(?:of\s*)?(?:exp(?:erience)?))?/i);
  if (m) return { value: `${num(m[1])}+`, span: m[0] };
  m = t.match(/(?:exp(?:erience)?)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(?:-|–|to)?\s*(\d+(?:\.\d+)?)?/i);
  if (m) return { value: m[2] ? `${num(m[1])}-${num(m[2])}` : `${num(m[1])}+`, span: m[0] };
  return null;
}

function findSalary(t) {
  // A year's pay: "3-5 LPA", "4 lpa", "3 to 4.5 lakhs per annum", "CTC 6L"
  let m = t.match(/(?:ctc|salary|pay|package)?\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(?:l|lakh|lakhs|lac)?\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(?:lpa|l\.p\.a|lakhs?\s*(?:per\s*annum|p\.?a\.?|a\s*year)|l\s*p\.?a)\b/i)
    || t.match(/(?:ctc|salary|pay|package)?\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)()\s*(?:lpa|l\.p\.a|lakhs?\s*(?:per\s*annum|p\.?a\.?|a\s*year))\b/i);
  if (m) {
    const lo = num(m[1]) * 100000 / 12;
    const hi = m[2] ? num(m[2]) * 100000 / 12 : null;
    return { min: Math.round(lo), max: hi ? Math.round(hi) : null, span: m[0] };
  }
  // A month's pay: "25k-35k", "25,000 to 35,000", "salary 20000", "₹18k pm"
  // Every range is tried, not only the first ("2-5 years" comes before "25k-35k").
  for (const r of t.matchAll(/(?:₹|rs\.?|inr|salary|pay|ctc)?\s*[:\-]?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|l|lakh|lakhs)?\s*(?:-|–|to)\s*(?:₹|rs\.?)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|l|lakh|lakhs)?\b\s*(?:\/?\s*(?:pm|p\.m\.|per\s*month|a\s*month|monthly))?/gi)) {
    const unitB = r[4] || r[2];
    const unitA = r[2] || r[4];
    const lo = rupeesOf(r[1], unitA);
    const hi = rupeesOf(r[3], unitB);
    // Small numbers without a unit are not pay ("2-5" is years).
    if (lo >= 3000 && hi >= lo && hi <= 2000000) return { min: lo, max: hi, span: r[0].trim() };
  }
  m = t.match(/(?:₹|rs\.?|inr|salary|pay|ctc)\s*[:\-]?\s*(?:up\s*to\s*)?(\d[\d,]*(?:\.\d+)?)\s*(k)?/i) || t.match(/(\d[\d,]*(?:\.\d+)?)\s*(k)\s*(?:\/?\s*(?:pm|per\s*month|monthly|salary))?/i);
  if (m) {
    const v = rupeesOf(m[1], m[2]);
    if (v >= 3000 && v <= 2000000) return { min: /up\s*to/i.test(m[0]) ? null : v, max: /up\s*to/i.test(m[0]) ? v : null, span: m[0] };
  }
  // A bare amount ("15000"): a 4-6 digit number that is not days / years / openings.
  for (const r of t.matchAll(/(?<![\d.])(\d{4,6})(?![\d.]|\s*(?:days?|yrs?|years?|no\.?s?|openings?|positions?|people|members?))/gi)) {
    const v = Number(r[1]);
    if (v >= 5000 && v <= 500000) return { min: v, max: null, span: r[0] };
  }
  return null;
}

function findOpenings(t) {
  const m = t.match(/(\d{1,3})\s*(?:no\.?s?|openings?|positions?|posts?|vacanc(?:y|ies)|people|persons?|members?|candidates?|heads?|seats?)\b/i)
    || t.match(/(?:openings?|positions?|vacanc(?:y|ies)|need|required|requirement of)\s*[:\-]?\s*(\d{1,3})\b/i);
  if (!m) return null;
  const v = Number(m[1]);
  return v >= 1 && v <= 500 ? { value: v, span: m[0] } : null;
}

function findJoinBy(t) {
  if (/\b(immediate(?:ly)?|asap|urgent(?:ly)?|right away|this week)\b/i.test(t)) return { value: 'asap', span: t.match(/\b(immediate(?:ly)?|asap|urgent(?:ly)?|right away|this week)\b/i)[0] };
  if (/\b(15|fifteen)\s*days?\b/i.test(t)) return { value: '15', span: t.match(/(?:\b(?:within|in)\s*)?\b(15|fifteen)\s*days?\b/i)[0] };
  if (/\b(30\s*days?|one\s*month|1\s*month)\b/i.test(t)) return { value: '30', span: t.match(/(?:\b(?:within|in)\s*)?\b(30\s*days?|one\s*month|1\s*month)\b/i)[0] };
  if (/\b(no\s*hurry|60\s*days?|2\s*months?|two\s*months?)\b/i.test(t)) return { value: 'later', span: t.match(/\b(no\s*hurry|60\s*days?|2\s*months?|two\s*months?)\b/i)[0] };
  return null;
}

function findWorkMode(t) {
  if (/\b(wfh|work\s*from\s*home|remote)\b/i.test(t)) return { value: 'Work From Home', span: t.match(/\b(wfh|work\s*from\s*home|remote)\b/i)[0] };
  if (/\bhybrid\b/i.test(t)) return { value: 'Hybrid', span: 'hybrid' };
  if (/\b(wfo|work\s*from\s*office|on[\s-]?site)\b/i.test(t)) return { value: 'Work From Office', span: t.match(/\b(wfo|work\s*from\s*office|on[\s-]?site)\b/i)[0] };
  return null;
}

function findShift(t) {
  const m = t.match(/\b(night|day|rotational|general|morning|evening)\s*shifts?\b/i);
  return m ? { value: `${titleCase(m[1])} shift`, span: m[0] } : null;
}

function findEmployment(t) {
  const m = t.match(/\b(full[\s-]?time|part[\s-]?time|contract(?:ual)?|internship|temporary)\b/i);
  if (!m) return null;
  const w = m[1].toLowerCase();
  return { value: /full/.test(w) ? 'Full Time' : /part/.test(w) ? 'Part Time' : /intern/.test(w) ? 'Internship' : /temp/.test(w) ? 'Temporary' : 'Contract', span: m[0] };
}

function findGender(t) {
  const m = t.match(/\b(female|male|women|men|ladies|gents)\s*(?:only|candidates?|preferred)?\b/i);
  return m ? { value: m[0].trim(), span: m[0] } : null;
}

// The place: a known place named in the text (the shared list of places), else nothing.
function findLocation(t, places) {
  const low = ` ${t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')} `;
  const sorted = [...new Set((places || []).filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const p of sorted) {
    const k = String(p).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (k.length >= 3 && low.includes(` ${k} `)) {
      const re = new RegExp(k.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^a-z0-9]+'), 'i');
      const m = t.match(re);
      return { value: p, span: m ? m[0] : p };
    }
  }
  const m = t.match(/\b(?:location|place|at|in)\s*[:\-]\s*([A-Za-z][A-Za-z .]{2,40})/i);
  return m ? { value: titleCase(m[1]), span: m[0] } : null;
}

const NOISE = /^(and|with|for|the|a|an|of|in|at|need|needed|required|requirement|urgent|hiring|we|want|looking|candidate|candidates|staff|good|must|should|have|know|knowledge|exp|experience|salary|location|openings?|skills?|key\s*skills?)$/i;
// Words that read like a job (the role is usually the first piece).
const ROLE_WORD = /\b(nurse|nursing|doctor|physician|surgeon|technician|executive|manager|engineer|developer|analyst|accountant|assistant|associate|officer|supervisor|lead|head|consultant|specialist|coordinator|operator|driver|teacher|lecturer|professor|trainer|counsel+or|pharmacist|therapist|receptionist|clerk|agent|representative|advisor|designer|administrator|admin|intern|trainee|helper|cook|chef|guard|electrician|plumber|fitter|welder|machinist|sales|marketing|telecaller|caller|tele\s*caller|bde|hr|recruiter|cashier|storekeeper|incharge|in-charge|dietitian|radiographer|physiotherapist|optometrist|lab|mlt|dmlt|gnm|anm|staff)\b/i;

// The rules: read the text into the request form's fields.
function readRules(text, ctx = {}) {
  const t = String(text || '').slice(0, MAX_TEXT);
  const used = [];
  const take = (r) => { if (r && r.span) used.push(r.span); return r; };
  const exp = take(findExperience(t));
  const sal = take(findSalary(t));
  const open = take(findOpenings(t));
  const join = take(findJoinBy(t));
  const mode = take(findWorkMode(t));
  const shift = take(findShift(t));
  const emp = take(findEmployment(t));
  const gender = take(findGender(t));
  const loc = take(findLocation(t, ctx.places));
  // What is left: the role and the skills, in pieces split on commas, new lines, "|", ";" and " - ".
  let rest = t;
  used.sort((a, b) => b.length - a.length).forEach((s) => { rest = rest.split(s).join(' , '); });
  const pieces = rest.split(/[,\n;|/]+|\s+-\s+|\s+&\s+|\band\b|\bwith\b/i)
    .map((p) => p.replace(/^(key\s*skills?|skills?|role|position|title|job|designation)\s*[:\-]\s*/i, '').replace(/[()[\]{}:]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((p) => p && p.length >= 2 && !NOISE.test(p) && !/^\d+$/.test(p));
  let titleIdx = pieces.findIndex((p) => ROLE_WORD.test(p) && p.split(' ').length <= 6);
  if (titleIdx < 0) titleIdx = pieces.length ? 0 : -1;
  // The title runs to the last job word ("Accounts Executive"); the words after it are skills
  // ("Tally GST"), a trailing "in / at / for" is dropped and a plural job is made singular.
  let title = '';
  if (titleIdx >= 0) {
    const w = pieces[titleIdx].replace(/^((a|an|the|need|needed|hiring|looking for|we need|want|required)\s+)+/i, '').replace(/\s+(in|at|for|with|from|near)$/i, '').split(' ');
    const isRole = (x) => ROLE_WORD.test(x) || ROLE_WORD.test(x.replace(/s$/i, '')) || ROLE_WORD.test(x.replace(/es$/i, ''));
    let last = -1;
    w.forEach((x, i) => { if (isRole(x)) last = i; });
    const head = last >= 0 ? w.slice(0, last + 1) : w;
    const extra = last >= 0 ? w.slice(last + 1).join(' ') : '';
    const end = head[head.length - 1] || '';
    if (last >= 0 && /s$/i.test(end) && !ROLE_WORD.test(end)) head[head.length - 1] = ROLE_WORD.test(end.replace(/s$/i, '')) ? end.replace(/s$/i, '') : end.replace(/es$/i, '');
    title = titleCase(head.join(' '));
    if (extra) pieces.splice(titleIdx + 1, 0, ...extra.split(/\s+(?=[A-Z])|\s{2,}/).filter(Boolean));
  }
  const seen = new Set([title.toLowerCase()]);
  const skills = pieces.filter((p, i) => i !== titleIdx).map((p) => p.replace(/^(need|needed|knowledge of|good in|must know|experience in|exp in)\s+/i, '').trim())
    .filter((p) => p && p.split(' ').length <= 6 && !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()))
    .map((p) => (p === p.toLowerCase() ? titleCase(p) : p));
  const notes = [shift && shift.value, gender && gender.value].filter(Boolean).join(' · ');
  return {
    title,
    skills: skills.join(', '),
    experience: exp ? exp.value : '',
    location: loc ? loc.value : '',
    openings: open ? open.value : null,
    salaryMonthlyMin: sal && sal.min ? sal.min : '',
    salaryMonthlyMax: sal && sal.max ? sal.max : '',
    joinBy: join ? join.value : null,
    workMode: mode ? mode.value : '',
    employmentType: emp ? emp.value : '',
    notes,
  };
}

const rupeeWords = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
function salaryWords(f) {
  if (f.salaryMonthlyMin && f.salaryMonthlyMax) return `${rupeeWords(f.salaryMonthlyMin)} to ${rupeeWords(f.salaryMonthlyMax)} a month`;
  if (f.salaryMonthlyMin) return `from ${rupeeWords(f.salaryMonthlyMin)} a month`;
  if (f.salaryMonthlyMax) return `up to ${rupeeWords(f.salaryMonthlyMax)} a month`;
  return '';
}
const JOIN_WORDS = { asap: 'Immediate joining', 15: 'Joining within 15 days', 30: 'Joining within a month', later: 'Joining in 1-2 months' };

// A plain job description from the fields alone - nothing is invented beyond the
// general duties every such job has, written from the skills the client gave.
function templateJd(f, ctx = {}) {
  const role = f.title || 'the role';
  const skillList = String(f.skills || '').split(',').map((s) => s.trim()).filter(Boolean);
  const where = [ctx.clientName, f.location].filter(Boolean).join(', ');
  const responsibilities = [
    ...skillList.slice(0, 4).map((s) => `Work with ${s} as part of daily tasks`),
    'Work with the team and follow the company\'s processes and standards',
    'Keep records and report progress to the reporting manager',
  ];
  const details = [
    f.experience && `Experience: ${f.experience} years`,
    f.location && `Location: ${f.location}`,
    f.workMode && `Work mode: ${f.workMode}`,
    f.employmentType && `Employment type: ${f.employmentType}`,
    salaryWords(f) && `Salary: ${salaryWords(f)}`,
    f.openings && `Openings: ${f.openings}`,
    f.joinBy && JOIN_WORDS[f.joinBy],
    f.notes,
  ].filter(Boolean);
  const jd = [
    `We are hiring ${f.openings && f.openings > 1 ? `${f.openings} ` : 'a '}${role}${f.openings && f.openings > 1 ? 's' : ''}${where ? ` for ${where}` : ''}.`,
    skillList.length ? `The person should be good at ${skillList.join(', ')}.` : '',
    '',
    'Responsibilities',
    ...responsibilities.map((r) => `- ${r}`),
    '',
    ...(skillList.length ? ['Key skills', `- ${skillList.join('\n- ')}`, ''] : []),
    'Details',
    ...details.map((d) => `- ${d}`),
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim();
  return { jobDescription: jd, responsibilities: responsibilities.join('\n') };
}

// The AI writes the description (and may tidy the title / skills) when the Claude key is set up.
// Its answer only fills text: numbers (pay, openings, experience) stay what the rules read from the client's words.
async function aiJd(text, f, ctx) {
  const AI = require('./ai'); // eslint-disable-line global-require
  if (AI.provider() !== 'claude') return null;
  const system = [
    'You write job descriptions for an Indian recruitment consultancy. Reply with JSON only:',
    '{"title": string, "skills": [string], "summary": string, "responsibilities": [string], "requirements": [string]}',
    'Rules: use ONLY what the client wrote and what the role normally involves. Do not invent salary, location, company facts, benefits or numbers.',
    'title: the job title in Title Case. skills: 3-10 short key skills. summary: 2 plain sentences. responsibilities: 4-7 short lines. requirements: 2-5 short lines (education / experience / skills).',
  ].join('\n');
  const user = `Client: ${ctx.clientName || 'our client'}\nClient's words: ${String(text).slice(0, MAX_TEXT)}\nRead so far: ${JSON.stringify({ title: f.title, skills: f.skills, experience: f.experience, location: f.location })}`;
  const out = await Promise.race([
    AI.chatJson(system, [{ role: 'user', content: user }]),
    new Promise((resolve) => { setTimeout(() => resolve(null), AI_TIMEOUT_MS); }),
  ]);
  if (!out || typeof out !== 'object' || !Array.isArray(out.responsibilities) || !out.responsibilities.length) return null;
  const lines = (a, max) => (Array.isArray(a) ? a : []).map((s) => String(s || '').replace(/^[-•*\s]+/, '').trim().slice(0, 200)).filter(Boolean).slice(0, max);
  return {
    title: String(out.title || '').trim().slice(0, 120),
    skills: lines(out.skills, 12).join(', '),
    summary: String(out.summary || '').trim().slice(0, 600),
    responsibilities: lines(out.responsibilities, 8),
    requirements: lines(out.requirements, 6),
  };
}

async function fill(text, ctx = {}) {
  const words = String(text || '').trim();
  if (words.length < 3) return { error: 'Write a few words first: the role, key skills, experience, place.' };
  const fields = readRules(words, ctx);
  let by = 'rules';
  let jd = templateJd(fields, ctx);
  try {
    const ai = await aiJd(words, fields, ctx);
    if (ai) {
      by = 'ai';
      if (!fields.title && ai.title) fields.title = ai.title;
      if (ai.skills && fields.skills.split(',').filter(Boolean).length < 3) fields.skills = ai.skills;
      const { jobDescription: base } = templateJd(fields, ctx);
      const details = base.slice(base.indexOf('Details'));
      jd = {
        jobDescription: [
          ai.summary,
          '',
          'Responsibilities', ...ai.responsibilities.map((r) => `- ${r}`),
          ...(ai.requirements.length ? ['', 'What we look for', ...ai.requirements.map((r) => `- ${r}`)] : []),
          '',
          details,
        ].join('\n').trim(),
        responsibilities: ai.responsibilities.join('\n'),
      };
    }
  } catch { /* the AI is optional: the rules' description stands */ }
  return { fields, jobDescription: jd.jobDescription, responsibilities: jd.responsibilities, by };
}

module.exports = { fill, readRules, templateJd };
