const fs = require('fs');
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
for (const n of [1,2,3]) {
  const flat = JSON.parse(fs.readFileSync(`share${n}.router.txt`, 'utf8'));
  const decoded = decodeFlat(flat);
  const route = decoded.loaderData['routes/share.$shareId.($action)'];
  const data = route.serverResponse.data;
  const linear = data.linear_conversation || [];
  const out = [];
  for (const node of linear) {
    const msg = node?.message;
    if (!msg) continue;
    const role = msg?.author?.role || 'unknown';
    const parts = msg?.content?.parts || [];
    const text = parts.filter(p => typeof p === 'string').join('\n');
    if (text.trim()) out.push({ role, text });
  }
  fs.writeFileSync(`share${n}.messages.json`, JSON.stringify(out, null, 2));
  console.log(`share${n}: "${data.title}" - ${out.length} messages (${out.filter(m=>m.role==='user').length} user, ${out.filter(m=>m.role==='assistant').length} assistant)`);
}
