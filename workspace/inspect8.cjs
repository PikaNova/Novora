const fs = require('fs');
const flat = JSON.parse(fs.readFileSync('share1.router.txt', 'utf8'));
function decodeFlat(flat) {
  const memo = new Map();
  function resolveRef(v) { if (typeof v === 'number') { if (v < 0) return null; return decodeAt(v); } return v; }
  function isNode(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0 && Object.keys(v).every(k => /^_\d+$/.test(k)); }
  function decodeAt(i) {
    if (memo.has(i)) return memo.get(i);
    const v = flat[i]; let result;
    if (isNode(v)) { const obj = {}; memo.set(i, obj); for (const [k, val] of Object.entries(v)) { const keyIdx = parseInt(k.slice(1)); const propName = flat[keyIdx]; try { obj[propName] = resolveRef(val); } catch (e) { obj[propName] = '<cycle>'; } } result = obj; }
    else if (Array.isArray(v)) { const arr = []; memo.set(i, arr); for (let j = 0; j < v.length; j++) { try { arr.push(resolveRef(v[j])); } catch (e) { arr.push('<cycle>'); } } result = arr; }
    else { result = v; memo.set(i, result); }
    return result;
  }
  return decodeAt(0);
}
const decoded = decodeFlat(flat);
const route = decoded.loaderData['routes/share.$shareId.($action)'];
const sr = route.serverResponse;
console.log('serverResponse keys:', Object.keys(sr));
if (sr.data) {
  console.log('data keys:', Object.keys(sr.data).slice(0,30));
  console.log('title:', sr.data.title);
  console.log('linear_conversation length:', sr.data.linear_conversation?.length);
}
