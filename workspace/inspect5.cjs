const fs = require('fs');
const flat = JSON.parse(fs.readFileSync('share1.router.txt','utf8'));
console.log('flat[432]:', JSON.stringify(flat[432]).slice(0,500));
