// Live calls come first (founder 2026-11-09): voice made for several calls at once, and the local language model waits while a call is going.
// node scripts/ai-voice-load-test.js
process.env.AI_VOICE_TTS_WORKERS = '3';
process.env.AI_VOICE_CACHE_DIR = require('path').join(require('os').tmpdir(), `tl-load-test-${process.pid}`);
const assert = require('assert');
const G = require('../src/calling/voice/gateway');
const LL = require('../src/calling/voice/liveLoad');

let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ''}`); };

(async () => {
  // 1. the voice: three sentences of one language are made at the same time, not one after another
  let running = 0; let peak = 0; let made = 0;
  const pcm = Buffer.alloc(1600); for (let i = 0; i < 800; i += 1) pcm.writeInt16LE(Math.round(Math.sin(i / 5) * 3000), i * 2);
  const engines = { name: `fake-${process.pid}-${Date.now()}`, tts: async () => { running += 1; peak = Math.max(peak, running); made += 1; await new Promise((r) => setTimeout(r, 120)); running -= 1; return pcm; } };
  const t0 = Date.now();
  await Promise.all([1, 2, 3, 4, 5, 6].map((n) => G.prepare(engines, [`Sentence number ${n} for a call.`], 'English')));
  const took = Date.now() - t0;
  check('six sentences of six calls are made three at a time (not in one line)', made === 6 && peak === 3 && took < 6 * 120 - 150, { made, peak, took });

  // 2. a live call is counted, and the language model waits for it (and only up to the limit)
  check('no live call: the model does not wait', LL.active() === 0 && await (async () => { const a = Date.now(); await LL.whenQuiet(2000, 20); return Date.now() - a < 100; })());
  LL.enter(); LL.enter();
  check('two live calls are counted', LL.active() === 2);
  const w0 = Date.now(); const waiting = LL.whenQuiet(5000, 20);
  setTimeout(() => LL.leave(), 100); setTimeout(() => LL.leave(), 200);
  await waiting;
  const waited = Date.now() - w0;
  check('the model waits until the last call ends', waited >= 180 && waited < 1500 && LL.active() === 0, { waited, active: LL.active() });
  LL.enter();
  const l0 = Date.now(); await LL.whenQuiet(250, 20);
  check('a chat is only delayed, never lost: the wait has a limit', Date.now() - l0 >= 240 && Date.now() - l0 < 1000);
  LL.leave();
  assert.strictEqual(LL.active(), 0);

  try { require('fs').rmSync(process.env.AI_VOICE_CACHE_DIR, { recursive: true, force: true }); } catch { /* none */ }
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})();
