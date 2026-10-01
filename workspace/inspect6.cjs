const fs = require('fs');
const flat = JSON.parse(fs.readFileSync('share1.router.txt','utf8'));
// Find all node objects and collect negative values
const negs = new Set();
for (let i = 0; i < flat.length; i++) {
  const v = flat[i];
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === 'number' && val < 0) negs.add(val);
    }
  }
  if (Array.isArray(v)) {
    for (const el of v) if (typeof el === 'number' && el < 0) negs.add(el);
  }
}
console.log('negative values used:', [...negs].sort());
// What property names use these negatives?
for (let i = 0; i < flat.length; i++) {
  const v = flat[i];
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === 'number' && val < 0) {
        const keyIdx = parseInt(k.slice(1));
        console.log(`flat[${i}] key ${flat[keyIdx]} = ${val}`);
      }
    }
  }
}
