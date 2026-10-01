const fs = require('fs');
for (const n of [1,2,3]) {
  const h = fs.readFileSync(`share${n}.html`, 'utf8');
  const m = h.match(/window\.__reactRouterContext\.streamController\.enqueue\(([\s\S]*?)\);?\s*<\/script>/);
  if (!m) { console.log(n, 'not found'); continue; }
  // The captured text is a JS string literal (possibly concatenated). Try JSON.parse directly.
  let raw = m[1];
  let parsed;
  try { parsed = JSON.parse(raw); console.log(n, 'JSON.parse OK'); }
  catch(e) {
    // Maybe multiple concatenated string literals; eval in a safe-ish way
    try { parsed = (0,eval)('(' + raw + ')'); console.log(n, 'eval OK'); }
    catch(e2) { console.log(n, 'fail', e2.message); continue; }
  }
  fs.writeFileSync(`share${n}.router.txt`, typeof parsed === 'string' ? parsed : JSON.stringify(parsed));
  console.log(n, 'written', typeof parsed === 'string' ? parsed.length : JSON.stringify(parsed).length);
}
