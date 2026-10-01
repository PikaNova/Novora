const fs = require('fs');
const flat = JSON.parse(fs.readFileSync('share1.router.txt','utf8'));
console.log('flat[784]:', JSON.stringify(flat[784]).slice(0,100));
// find arrays with string elements
for (let i = 0; i < flat.length; i++) {
  const v = flat[i];
  if (Array.isArray(v) && v.some(x => typeof x === 'string')) {
    console.log('array with strings at', i, JSON.stringify(v).slice(0,150));
    break;
  }
}
// check content structure
console.log('flat[155]:', JSON.stringify(flat[155]).slice(0,200));
console.log('flat[428]:', JSON.stringify(flat[428]));
console.log('flat[429]:', JSON.stringify(flat[429]).slice(0,200));
console.log('flat[430]:', JSON.stringify(flat[430]));
console.log('flat[431]:', JSON.stringify(flat[431]).slice(0,300));
