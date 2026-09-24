const fs = require('node:fs');
const path = require('node:path');

const outputDir = path.resolve('.test-check');
const hasExtension = (specifier) => path.posix.extname(specifier) !== '';

/**
 * 增量编译（tsconfig.test.json 的 incremental）不会删除「源文件已删掉」的旧产物，
 * 而 node --test 的 glob 会把它们继续跑起来。这里按「有没有同名 .ts 源」清一遍，
 * 让 .test-check 始终与源码一致。
 *
 * 注意：tsconfig.test.json 的 rootDir 是仓库根，所以 `.test-check/tests/x.test.js`
 * 对应的源是 `<仓库根>/tests/x.test.ts`，不能就地找同名 .ts。
 */
function pruneStaleOutput(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      pruneStaleOutput(entryPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const sourcePath = `${path.relative(outputDir, entryPath).slice(0, -'.js'.length)}.ts`;
    if (!fs.existsSync(path.join(path.dirname(outputDir), sourcePath))) fs.rmSync(entryPath, { force: true });
  }
}

function addJsExtension(source) {
  const rewrite = (_match, prefix, quote, specifier, suffix) => {
    if (!specifier.startsWith('.') || hasExtension(specifier)) return `${prefix}${quote}${specifier}${quote}${suffix}`;
    return `${prefix}${quote}${specifier}.js${quote}${suffix}`;
  };

  return source
    .replace(/(\bfrom\s*)(['"])([^'"]+)\2(\s*;?)/g, rewrite)
    .replace(/(\bimport\s*)(['"])([^'"]+)\2(\s*;?)/g, rewrite)
    .replace(/(\bimport\s*\(\s*)(['"])([^'"]+)\2(\s*\))/g, rewrite);
}

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(filePath);
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      const original = fs.readFileSync(filePath, 'utf8');
      const rewritten = addJsExtension(original);
      if (rewritten !== original) fs.writeFileSync(filePath, rewritten);
    }
  }
}

visit(outputDir);
pruneStaleOutput(outputDir);
