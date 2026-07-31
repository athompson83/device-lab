// E2E: tap through the Device Lab WS pipeline, then trigger a crash and
// confirm the server's crash detector fires.
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:4830/ws');

let frames = 0, crashEvent = null, logcatTaps = [];

ws.on('message', (data, isBinary) => {
  if (isBinary) { frames++; return; }
  const m = JSON.parse(data.toString());
  if (m.t === 'crash') crashEvent = m;
  if (m.t === 'logcat' && m.line.includes('Tap count=')) logcatTaps.push(m.line);
});

const send = obj => ws.send(JSON.stringify(obj));
const sleep = ms => new Promise(r => setTimeout(r, ms));

ws.on('open', async () => {
  // "Tap me" button center: (540/1080, 697/2400)
  for (let i = 0; i < 3; i++) { send({ t: 'tap', x: 0.5, y: 0.2904 }); await sleep(900); }
  // type into the text field first: tap field (540/1080, 819/2400), send text
  send({ t: 'tap', x: 0.5, y: 0.3412 }); await sleep(700);
  send({ t: 'text', value: 'hello lab' }); await sleep(900);
  send({ t: 'key', name: 'back' }); await sleep(500);   // dismiss keyboard
  // crash button center: (540/1080, 1067/2400)
  send({ t: 'tap', x: 0.5, y: 0.4446 });
  await sleep(4000);
  console.log(JSON.stringify({
    framesReceived: frames,
    tapLogLines: logcatTaps.slice(0, 5),
    crashDetected: !!crashEvent,
    crashLine: crashEvent ? crashEvent.line : null,
  }, null, 2));
  process.exit(0);
});
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 30000);
