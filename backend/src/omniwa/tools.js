// ---------------------------------------------------------------------------
// WHATSAPP AI AGENT: the tools the model may ask for. Every tool works ONLY on the person of this chat: no tool takes a candidate or job id, so nothing a
// person writes can make the model read somebody else's record. A tool never sends anything itself: links are collected here and TeamLink adds them to
// the reply in code, and the client's name, fee and phone numbers are never handed to the model.
// ---------------------------------------------------------------------------
const prisma = require('../db');
const S = require('../outreach/store');
const Cfg = require('./config');
const Portal = require('../utils/jobPortalBridge');

const TOOL_HELP = `Tools (each is {"tool":"name","args":{...}}):
- get_candidate_profile {}: skills, location, applied jobs, application status, AI interview status.
- get_job_details {}: the job they replied to.
- search_knowledge_base {"query":"..."}: company and process FAQs.
- save_candidate_data {"availability":"","expected_salary":"","notice_period":"","location":"","interested":true|false}: send only what the person told you.
- search_open_jobs {"query":"staff nurse"}: open jobs by what they want. Numbers in the answer are for select_job.
- select_job {"number":1}: this chat is now about that job.
- send_apply_link {}: adds the job's apply and registration link to your reply.
- send_interview_link {}: adds the AI interview link to your reply.
- handoff_to_recruiter {"reason":"..."}: a recruiter takes over.`;

const clean = (v, n = 120) => S.clip(String(v == null ? '' : v).replace(/\s+/g, ' '), n);
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const noClient = (title, client) => (client ? String(title || '').split(client).join('').replace(/\s{2,}/g, ' ').replace(/^[\s\-–|:]+|[\s\-–|:]+$/g, '') : String(title || ''));

async function jobFacts(requirementId) {
  if (!requirementId) return { available: false, note: 'No job is linked to this chat.' };
  const JP = require('../jobPublish/jobPayload'); // eslint-disable-line global-require
  const built = await JP.build(requirementId, 'career').catch(() => null);
  if (!built || !built.payload || built.blocked) return { available: false, note: 'The job details cannot be shared.' };
  const open = /^open$/i.test(String(built.requirement && built.requirement.status));
  if (!open) return { available: false, note: 'This job is closed.' };
  const p = built.payload;
  return {
    available: true, title: p.title, location: (p.location && p.location.text) || null, experience: (p.experience && p.experience.text) || null,
    salary: (p.salary && p.salary.text) || null, skills: Array.isArray(p.skills) ? p.skills.slice(0, 15) : null, description: clean(p.description, 900),
  };
}

// ---- open jobs -------------------------------------------------------------------------------------------------------------------------------------
const NOISE = new Set('i am im looking for a an the new job jobs position positions vacancy vacancies opening openings role roles interested intrested also want need any please hi hello yes no ok okay is are there do you have in at of to and or my me work this that one'.split(' '));
const wordsOf = (t) => [...new Set(String(t || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !NOISE.has(w)))].slice(0, 6);

// the open client jobs whose title carries the words: the same safe facts as get_job_details, the client's name never. id stays on this side.
async function searchJobs(text, limit = 5) {
  const words = wordsOf(text);
  if (!words.length) return { searched: false, jobs: [] };
  const rows = await prisma.requirement.findMany({ where: { status: 'OPEN', internal: false, OR: words.map((w) => ({ title: { contains: w } })) }, orderBy: { createdAt: 'desc' }, take: 60, select: { id: true, title: true } });
  const scored = rows.map((r) => ({ id: r.id, n: words.filter((w) => String(r.title).toLowerCase().includes(w)).length })).sort((a, b) => b.n - a.n);
  const jobs = [];
  for (const r of scored) {
    if (jobs.length >= limit) break;
    const f = await jobFacts(r.id); // eslint-disable-line no-await-in-loop
    if (f.available) jobs.push({ id: r.id, title: f.title, location: f.location, experience: f.experience, salary: f.salary });
  }
  return { searched: true, jobs };
}
// what the model sees, numbered; the ids are kept on the chat for select_job
async function offerJobs(conv, text) {
  const out = await searchJobs(text);
  const collected = JSON.parse(conv.collected || '{}');
  // "yes this one" finds nothing new: the jobs just offered stay on the table, so their numbers still mean the same
  if (!out.jobs.length && (collected.jobChoices || []).length) {
    for (const id of collected.jobChoices) {
      const f = await jobFacts(id); // eslint-disable-line no-await-in-loop
      out.jobs.push({ id, title: f.title, location: f.location, experience: f.experience, salary: f.salary });
    }
    out.searched = true;
  }
  collected.jobChoices = out.jobs.map((j) => j.id);
  conv.collected = JSON.stringify(collected);
  await S.run('UPDATE "OmniWaConv" SET collected = ? WHERE id = ?', conv.collected, conv.id);
  return { searched: out.searched, jobs: out.jobs.map(({ id, ...j }, i) => ({ number: i + 1, ...j })) };
}
async function selectJob(conv, args, ctx) {
  const id = (JSON.parse(conv.collected || '{}').jobChoices || [])[Number(args.number) - 1];
  if (!id) return { selected: false, note: 'There is no such number: use search_open_jobs first.' };
  const job = await jobFacts(id);
  if (!job.available) return { selected: false, note: job.note };
  conv.requirementId = id;
  await S.run('UPDATE "OmniWaConv" SET requirementId = ?, updatedAt = ? WHERE id = ?', id, Date.now(), conv.id);
  ctx.noJob = false;
  return { selected: true, job };
}
// what the model may read of the chat's memory
function collectedView(conv) {
  const { jobChoices, applyLinkSentAt, ...rest } = JSON.parse(conv.collected || '{}');
  return rest;
}

async function profileFacts(conv) {
  if (!conv.candidateId) return { known: false, note: 'This number is not a candidate yet.', collected: JSON.parse(conv.collected || '{}') };
  const c = await prisma.candidate.findUnique({
    where: { id: conv.candidateId },
    select: {
      name: true, skills: true, location: true, noticePeriod: true, expectedSalary: true,
      applications: { orderBy: { createdAt: 'desc' }, take: 5, select: { stage: true, aiInterviewStatus: true, aiInterviewDeadline: true, requirement: { select: { title: true, client: { select: { name: true } } } } } },
    },
  });
  if (!c) return { known: false, note: 'The record was not found.' };
  return {
    known: true, name: c.name, skills: c.skills, location: c.location, noticePeriod: c.noticePeriod, expectedSalary: c.expectedSalary,
    applications: c.applications.map((a) => ({ job: noClient(a.requirement && a.requirement.title, a.requirement && a.requirement.client && a.requirement.client.name), status: a.stage, aiInterviewStatus: a.aiInterviewStatus, aiInterviewDeadline: a.aiInterviewDeadline })),
    collected: JSON.parse(conv.collected || '{}'),
  };
}

// what the person said goes on the chat; on the candidate only into a field that is empty (the recruiter's data is never overwritten by a chat)
async function saveData(conv, args, ctx) {
  const was = JSON.parse(conv.collected || '{}');
  const next = { ...was };
  ['availability', 'expected_salary', 'notice_period', 'location'].forEach((k) => { const v = clean(args[k], 100); if (v) next[k] = v; });
  if (typeof args.interested === 'boolean') next.interested = args.interested;
  conv.collected = JSON.stringify(next);
  await S.run('UPDATE "OmniWaConv" SET collected = ?, updatedAt = ? WHERE id = ?', conv.collected, Date.now(), conv.id);
  if (conv.candidateId) {
    const cur = await prisma.candidate.findUnique({ where: { id: conv.candidateId }, select: { expectedSalary: true, location: true } });
    const data = {};
    if (cur && !cur.expectedSalary && next.expected_salary) data.expectedSalary = next.expected_salary;
    if (cur && !cur.location && next.location) data.location = next.location;
    if (Object.keys(data).length) await prisma.candidate.update({ where: { id: conv.candidateId }, data }).catch(() => {});
    if (typeof args.interested === 'boolean') await require('../utils/waChats').setIntent({ name: 'AI assistant' }, 'CANDIDATE', conv.candidateId, args.interested ? 'interested' : 'not_interested').catch(() => {}); // eslint-disable-line global-require
  }
  if (args.interested === false) ctx.notInterested = true;
  return { saved: true, collected: next };
}

async function applyLink(conv, ctx) {
  const collected = JSON.parse(conv.collected || '{}');
  if (collected.applyLinkSentAt) return { sent: false, note: 'The apply link was already sent in this chat.' };
  const job = await jobFacts(conv.requirementId);
  if (!job.available) return { sent: false, note: job.note };
  const live = await prisma.requirement.findUnique({ where: { id: conv.requirementId }, select: { portalPublished: true } }).catch(() => null);
  if (!live || !live.portalPublished) return { sent: false, note: 'This job is not on the Job Portal yet, so there is no link: use handoff_to_recruiter.' };
  const link = Portal.jobUrl(conv.requirementId, 'whatsapp', { utm_source: 'whatsapp', utm_medium: 'ai', utm_campaign: conv.campaignId || undefined });
  ctx.links.push(link);
  collected.applyLinkSentAt = Date.now();
  conv.collected = JSON.stringify(collected);
  await S.run('UPDATE "OmniWaConv" SET collected = ? WHERE id = ?', conv.collected, conv.id);
  return { sent: true, note: 'TeamLink adds the link to your reply. Do not write any link yourself. The link works while the job is open.' };
}

async function interviewLink(conv, ctx) {
  if (!conv.candidateId) return { sent: false, note: 'This number is not a candidate yet: send the apply link first.' };
  const where = { candidateId: conv.candidateId, ...(conv.requirementId ? { requirementId: conv.requirementId } : {}) };
  const app = await prisma.application.findFirst({ where, orderBy: { createdAt: 'desc' }, select: { aiInterviewStatus: true, aiInterviewDeadline: true } });
  if (!app) return { sent: false, note: 'They have not applied yet: send the apply link first.' };
  if (/complete|done|taken|pass|fail/i.test(String(app.aiInterviewStatus))) return { sent: false, note: 'The AI interview is already finished.' };
  if (app.aiInterviewDeadline && String(app.aiInterviewDeadline) < today()) return { sent: false, note: 'The AI interview time is over: hand off to a recruiter.' };
  ctx.links.push(`${Portal.portalUrl()}/#/candidate/applications`);
  return { sent: true, deadline: app.aiInterviewDeadline || null, note: `TeamLink adds the link to your reply. Do not write any link yourself.${app.aiInterviewDeadline ? ` Tell them it must be done by ${app.aiInterviewDeadline}.` : ''}` };
}

async function run(name, args, conv, ctx) {
  const a = args && typeof args === 'object' ? args : {};
  switch (name) {
    case 'get_candidate_profile': return profileFacts(conv);
    case 'get_job_details': return jobFacts(conv.requirementId);
    case 'search_knowledge_base': { const hits = await Cfg.kbSearch(a.query, 3, conv.numberId); return hits.length ? { found: hits } : { found: [], note: 'Nothing in the knowledge base: hand off to a recruiter.' }; }
    case 'search_open_jobs': ctx.noJob = false; return offerJobs(conv, a.query);
    case 'select_job': return selectJob(conv, a, ctx);
    case 'save_candidate_data': return saveData(conv, a, ctx);
    case 'send_apply_link': return applyLink(conv, ctx);
    case 'send_interview_link': return interviewLink(conv, ctx);
    case 'handoff_to_recruiter': ctx.handoff = clean(a.reason, 200) || 'The AI passed this chat to a recruiter'; return { done: true, note: 'Tell them someone from the team will contact them.' };
    default: return { error: 'There is no such tool.' };
  }
}

const NAMES = ['get_candidate_profile', 'get_job_details', 'search_open_jobs', 'select_job', 'search_knowledge_base', 'save_candidate_data', 'send_apply_link', 'send_interview_link', 'handoff_to_recruiter'];
module.exports = { run, jobFacts, searchJobs, offerJobs, collectedView, NAMES, TOOL_HELP };
