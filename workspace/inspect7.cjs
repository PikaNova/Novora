const fs = require('fs');
const flat = JSON.parse(fs.readFileSync('share1.router.txt', 'utf8'));

function decodeFlat(flat) {
  const memo = new Map();
  function resolveRef(v) {
    if (typeof v === 'number') {
      if (v < 0) return null;
      return decodeAt(v);
    }
    return v;
  }
  function isNode(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v) &&
      Object.keys(v).length > 0 && Object.keys(v).every(k => /^_\d+$/.test(k));
  }
  function decodeAt(i) {
    if (memo.has(i)) return memo.get(i);
    const v = flat[i];
    let result;
    if (isNode(v)) {
      const obj = {};
      memo.set(i, obj);
      for (const [k, val] of Object.entries(v)) {
        const keyIdx = parseInt(k.slice(1));
        const propName = flat[keyIdx];
        try { obj[propName] = resolveRef(val); }
        catch (e) { obj[propName] = '<cycle>'; }
      }
      result = obj;
    } else if (Array.isArray(v)) {
      const arr = [];
      memo.set(i, arr);
      for (let j = 0; j < v.length; j++) {
        try { arr.push(resolveRef(v[j])); }
        catch (e) { arr.push('<cycle>'); }
      }
      result = arr;
    } else {
      result = v;
      memo.set(i, result);
    }
    return result;
  }
  return decodeAt(0);
}

const decoded = decodeFlat(flat);
console.log('root keys:', Object.keys(decoded));
console.log('loaderData:', decoded.loaderData ? Object.keys(decoded.loaderData) : 'missing');
if (decoded.loaderData) {
  console.log('loaderData.root keys:', decoded.loaderData.root ? Object.keys(decoded.loaderData.root).slice(0,30) : 'missing');
  // maybe it's under a different route key
  for (const [k,v] of Object.entries(decoded.loaderData)) {
    console.log('loaderData.'+k+':', typeof v, v ? (typeof v === 'object' ? Object.keys(v).slice(0,20) : String(v).slice(0,50)) : v);
  }
}
