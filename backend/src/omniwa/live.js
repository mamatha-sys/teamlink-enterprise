// ---------------------------------------------------------------------------
// WHATSAPP INBOX, REAL TIME: "something changed" is pushed to every open inbox (Server-Sent Events, routes/omniWa.js /stream). The push carries NO names and no
// words: each screen then asks the list again through the normal route, which applies that login's own visibility.
// ---------------------------------------------------------------------------
const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(0);
const changed = () => bus.emit('change');
const subscribe = (fn) => { bus.on('change', fn); return () => bus.off('change', fn); };

module.exports = { changed, subscribe };
