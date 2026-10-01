const fs = require('fs');
const flat = JSON.parse(fs.readFileSync('share1.router.txt','utf8'));
const idx = flat.indexOf('linear_conversation');
console.log('linear_conversation at index', idx);
console.log('flat[idx+1]:', JSON.stringify(flat[idx+1]).slice(0,200));
const arr = flat[idx+1];
if (Array.isArray(arr)) {
  console.log('first few elements:', arr.slice(0,5));
  console.log('flat[119]:', JSON.stringify(flat[119]).slice(0,300));
  console.log('flat[120]:', JSON.stringify(flat[120]).slice(0,300));
}
