// node scripts/exit-checklist-test.js - the offboarding checklist's rules (no database).
const assert = require('assert');
const C = require('../src/utils/exitChecklist');

const base = { status: 'Notice Period', lastWorkingDate: '2026-12-01', today: '2026-11-06', employmentStatus: 'Notice Period', loginStatus: 'Active', resignationDate: '2026-10-01' };
const by = (steps, key) => steps.find((s) => s.key === key);

// someone on notice with a laptop, nothing paid
let f = C.autoFacts({ ...base, assets: ['Laptop'] });
let s = C.stepsFrom(f, []);
assert.deepStrictEqual(['submitted', 'approved', 'assets', 'lwd', 'access', 'relieved', 'fnf'].map((k) => by(s, k).done), [true, true, false, false, false, false, false]);
assert.match(by(s, 'assets').note, /Laptop/);
assert.strictEqual(by(s, 'fnf').note, 'Not started in Payroll');

// waiting for approval is not approved
assert.strictEqual(C.autoFacts({ ...base, status: 'Pending Approval' }).approved.done, false);

// nothing with them = returned, by itself
f = C.autoFacts({ ...base, assets: [] });
s = C.stepsFrom(f, []);
assert.deepStrictEqual([by(s, 'assets').done, by(s, 'assets').how, by(s, 'assets').canTick], [true, 'auto', false], 'an automatic tick cannot be undone by hand');

// the rest of the automatic ones
f = C.autoFacts({ ...base, status: 'Relieved', employmentStatus: 'Relieved', loginStatus: 'Inactive', fnf: { status: 'Processed', settlementAmount: 45000 } });
s = C.stepsFrom(f, []);
assert.deepStrictEqual(['lwd', 'access', 'relieved', 'fnf'].map((k) => [by(s, k).done, by(s, k).how]), [[true, 'auto'], [true, 'auto'], [true, 'auto'], [true, 'auto']]);
assert.match(by(s, 'fnf').note, /45,000/);
assert.strictEqual(C.autoFacts({ ...base, fnf: { status: 'Pending' } }).fnf.note, 'Waiting in Payroll');
assert.strictEqual(C.autoFacts({ ...base, loginStatus: null }).access.done, true, 'no login at all is closed');
assert.strictEqual(C.autoFacts({ ...base, lastWorkingDate: '2026-11-06' }).lwd.done, true, 'the last day counts on the day');

// stages only the system can tick
assert.deepStrictEqual(C.STEPS.filter((x) => x.mode === 'auto').map((x) => x.key), ['submitted', 'approved', 'lwd', 'relieved']);
s = C.stepsFrom(C.autoFacts({ ...base, status: 'Pending Approval', assets: ['Laptop'] }), []);
assert.deepStrictEqual(['submitted', 'approved', 'lwd', 'relieved'].map((k) => by(s, k).canTick), [false, false, false, false]);
assert.deepStrictEqual(['handover', 'interview', 'assets', 'access', 'fnf', 'letter'].map((k) => by(s, k).canTick), [true, true, true, true, true, true]);

// HR's tick stands, and says who
f = C.autoFacts({ ...base, assets: ['Laptop'] });
const hr = [{ task: 'Assets returned', completed: true, by: 'Divya', at: '2026-11-06T10:00:00Z' }, { task: 'Work handover done', completed: true, by: 'Divya' }];
s = C.stepsFrom(f, hr);
assert.deepStrictEqual([by(s, 'assets').done, by(s, 'assets').how, by(s, 'assets').by, by(s, 'assets').canTick], [true, 'hr', 'Divya', true]);
assert.strictEqual(by(s, 'handover').done, true);

// the old five-task list of an employee record is read as it is
s = C.stepsFrom(f, [{ task: 'Exit interview scheduled', completed: true }, { task: 'Experience letter issued', completed: true }]);
assert.deepStrictEqual([by(s, 'interview').done, by(s, 'letter').done], [true, true]);

// what the system saw is written down, and taken back if the system stops seeing it
let t = C.tasksAfter(C.stepsFrom(C.autoFacts({ ...base, assets: [] }), []), []);
assert.deepStrictEqual(t.find((x) => x.task === 'Assets returned'), { task: 'Assets returned', completed: true, auto: true });
assert.strictEqual(t.length, 6, 'every task that can be ticked is on the saved list');
t = C.tasksAfter(C.stepsFrom(C.autoFacts({ ...base, assets: ['Phone'] }), t), t);
assert.strictEqual(t.find((x) => x.task === 'Assets returned').completed, false, 'an asset given back to them un-ticks it');
assert.strictEqual(by(C.stepsFrom(C.autoFacts({ ...base, assets: ['Phone'] }), t), 'assets').done, false);

// a person's own extra task stays
t = C.tasksAfter(C.stepsFrom(f, [{ task: 'Hand over keys', completed: false }]), [{ task: 'Hand over keys', completed: false }]);
assert.ok(t.some((x) => x.task === 'Hand over keys'));

// cleared only when everything is done
const emp = { offboardingStatus: 'Serving Notice' };
assert.strictEqual(C.statusAfter(emp, [{ completed: true }, { completed: true }]), 'Cleared');
assert.strictEqual(C.statusAfter(emp, [{ completed: true }, { completed: false }]), 'Serving Notice');
assert.strictEqual(C.statusAfter({ offboardingStatus: 'Cleared' }, [{ completed: false }]), 'Serving Notice');

console.log('exit checklist: all passed');
