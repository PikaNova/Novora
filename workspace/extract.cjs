const fs = require('fs');
for (const n of [1,2,3]) {
  const h = fs.readFileSync(`share${n}.html`, 'utf8');
  const m = h.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (m) { fs.writeFileSync(`share${n}.json`, m[1]); console.log(n, 'NEXT_DATA', m[1].length); }
  else {
    const m2 = h.match(/window\.__reactRouterContext\.streamController\.enqueue\(([\s\S]*?)\);?\s*<\/script>/);
    console.log(n, 'router ctx?', !!m2, 'len', m2 ? m2[1].length : 0);
    const tags = [...h.matchAll(/<script[^>]*>/g)].map(x=>x[0]).slice(0,20);
    console.log(n, 'scripts:', tags.join('\n'));
  }
}
