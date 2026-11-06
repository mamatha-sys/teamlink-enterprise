// node scripts/employee-progress-test.js - the figures behind the HRMS dashboard's employee progress (no database).
const assert = require('assert');
const P = require('../src/utils/employeeProgress');

const e = (id, department) => ({ id, name: `Person ${id}`, department });

// a recruiter on 1 of 4 joinings, with one Monthly Target done
let p = P.personFigures({
  employee: e('a', 'Education'), joining: { target: 4, joinings: 1 }, targets: [{ status: 'Achieved' }],
  attendance: { worked: 3.5, days: 4 }, score: 80, courses: [{ completed: true }, { completed: false }],
});
assert.deepStrictEqual([p.targetItems, p.targetsDone, p.targetMet], [2, 1, false], 'one of two targets is not met');
assert.strictEqual(p.joinings, 1);

// a target met by its numbers, even if nobody moved the status
assert.strictEqual(P.targetDone({ status: 'In Progress', amount: 5, achieved: 5 }), true);
assert.strictEqual(P.targetDone({ status: 'In Progress', amount: 5, achieved: 4 }), false);
assert.strictEqual(P.targetDone({ status: 'In Progress', amount: 0, achieved: 0 }), false, 'no target is not a met target');

const met = P.personFigures({ employee: e('b', 'Education'), joining: { target: 4, joinings: 4 }, attendance: { worked: 4, days: 4 }, score: 60 });
assert.strictEqual(met.targetMet, true);

// somebody with nothing to measure counts as nothing, never as zero
const blank = P.personFigures({ employee: e('c', 'Medical') });
assert.deepStrictEqual([blank.targetMet, blank.score, blank.workingDays], [false, null, 0]);

const g = P.groupFigures('x', 'x', [p, met, blank]);
assert.deepStrictEqual([g.people, g.targetsPeople, g.targetsMet, g.targetsPct], [3, 2, 1, 50], 'blank is out of the target figure');
assert.strictEqual(g.attendancePct, 94, '7.5 of 8 days');
assert.deepStrictEqual([g.reviewed, g.scorePct], [2, 70], 'average of the two reviewed, not of three');
assert.deepStrictEqual([g.trainingDone, g.trainingTotal, g.trainingPct], [1, 2, 50]);

const none = P.groupFigures('m', 'm', [blank]);
assert.deepStrictEqual([none.targetsPct, none.attendancePct, none.scorePct, none.trainingPct], [null, null, null, null], 'no data is empty, not 0%');

const rows = P.rowsFor([p, met, blank], 'department');
assert.deepStrictEqual(rows.map((r) => [r.name, r.people]), [['Education', 2], ['Medical', 1]], 'biggest department first');
const people = P.rowsFor([met, p], 'employee');
assert.deepStrictEqual(people.map((r) => r.key), ['a', 'b'], 'people by name');
assert.deepStrictEqual([people[0].targetsMet, people[0].targetsPeople, people[0].joinings, people[0].joiningTarget], [1, 2, 1, 4]);

const noDept = P.personFigures({ employee: e('d', null) });
assert.strictEqual(noDept.department, 'No department');

console.log('employee progress: all passed');
