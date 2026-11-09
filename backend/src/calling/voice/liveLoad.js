// ---------------------------------------------------------------------------
// LIVE CALLS COME FIRST (founder 2026-11-09: "voice struck avuthundhi, correct ga ravadam ledhu, 5 november 7 o'clock ki ochinatlu ravali").
// The voice (Piper) and the ears (Whisper) share the server's processor with the local language model that answers WhatsApp chats and makes script
// translations. While a call is going on, that model waits (up to a limit) instead of taking the processor from the voice.
// ---------------------------------------------------------------------------
let live = 0;
const enter = () => { live += 1; };
const leave = () => { live = Math.max(0, live - 1); };
const active = () => live;
/** Resolves when no AI call is going on (or after maxMs, so a chat is only delayed, never lost). */
async function whenQuiet(maxMs = 120000, pollMs = 1000) {
  const until = Date.now() + maxMs;
  while (live > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, pollMs)); // eslint-disable-line no-await-in-loop
}
module.exports = { enter, leave, active, whenQuiet };
