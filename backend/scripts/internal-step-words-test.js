#!/usr/bin/env node
/**
 * Internal hiring never talks about a team lead or a client manager: HR runs it start to end (founder 2026-11-03, 2026-11-06). No database.
 *   node scripts/internal-step-words-test.js
 */
const { stageMoveProblem, stageLabelFor } = require('../src/utils/atsVocab');
const { stageDetail } = require('../src/utils/pipelineView');

let failed = 0; let total = 0;
const check = (name, ok, extra) => { total += 1; if (ok) console.log(`  ok  ${name}`); else { failed += 1; console.log(`FAIL  ${name}\n      ${extra}`); } };
const clean = (s) => !/team lead|client manager|client/i.test(String(s));

const m = stageMoveProblem('TL_REVIEW', 'SELECTED', { internal: true });
check('Selected too early says book the interview, with no team lead or client manager', /book the interview first/.test(m) && clean(m), m);
const m2 = stageMoveProblem('RECRUITER_REVIEW', 'OFFER', { internal: true });
check('the same from the first HR check', /book the interview first/.test(m2) && clean(m2), m2);
check('the interview can still be booked from the HR check', stageMoveProblem('TL_REVIEW', 'INTERVIEW_SCHEDULED', { internal: true }) === null);
check('after the interview an internal hire still goes through Selected', /Selected/.test(stageMoveProblem('INTERVIEW_SCHEDULED', 'OFFER', { internal: true })));
check('"Currently" reads the HR step', stageDetail({ stage: 'TL_REVIEW' }, { internal: true }) === 'Check by HR');
check('the label agrees', stageLabelFor('TL_REVIEW', { internal: true }) === 'Check by HR');
check('a client placement keeps its own words', /client manager/.test(stageMoveProblem('TL_REVIEW', 'SELECTED', {})) && stageDetail({ stage: 'TL_REVIEW' }) === 'Check by team lead');

console.log(failed ? `\n${failed} of ${total} checks FAILED` : `\nAll ${total} checks passed`);
process.exit(failed ? 1 : 0);
