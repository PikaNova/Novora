const fs = require('fs');
const { decode } = require('turbo-stream');
for (const n of [1,2,3]) {
  const txt = fs.readFileSync(`share${n}.router.txt`, 'utf8');
  // The router context enqueues a JSON string. The parsed value is the flat array.
  // turbo-stream decode expects a string in its own format. Let me check what decode accepts.
  // Actually the flat array we have may itself be the "encoded" value that decode can process.
  const flat = JSON.parse(txt);
  console.log(n, 'flat length', flat.length, 'type', typeof flat, Array.isArray(flat));
  try {
    const decoded = decode(txt);
    console.log(n, 'decoded OK, keys:', Object.keys(decoded.value || decoded).slice(0,10));
  } catch (e) {
    console.log(n, 'decode error:', e.message);
  }
}
