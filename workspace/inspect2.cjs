const fs = require('fs');
const flat = JSON.parse(fs.readFileSync('share1.router.txt','utf8'));
for (const i of [143,148,144,146,147,150,151,152,153,154,155,156,157,158,159,160,161,162,163,164,165,166]) {
  console.log(i, JSON.stringify(flat[i]).slice(0,150));
}
