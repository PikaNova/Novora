const fs = require('node:fs');
const path = require('node:path');

const outputDir = path.resolve('.test-check');
const hasExtension = (specifier) => path.posix.extname(specifier) !== '';

/**
 * 增量编译（tsconfig.test.json 的 incremental）不会删除「源文件已删掉」的旧产物，
 * 而 node --test 的 glob 会把它们继续跑起来。这里按「有没有同名源文件」清一遍，
 * 让 .test-check 始终与源码一致。
 *
 * 注意：tsconfig.test.json 的 rootDir 是仓库根，所以 `.test-check/tests/x.test.js`
 * 对应的源是 `<仓库根>/tests/x.test.ts(|tsx)`，不能就地找同名源文件。
 * 源文件后缀要按实际源码列全：测试开始引用 .tsx 组件后，只认 .ts 会把所有
 * 组件产物当成「源文件已删除」删掉。
 */
function pruneStaleOutput(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      pruneStaleOutput(entryPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const sourceBase = path.relative(outputDir, entryPath).slice(0, -'.js'.length);
    const hasSource = ['.ts', '.tsx'].some((extension) =>
      fs.existsSync(path.join(path.dirname(outputDir), `${sourceBase}${extension}`)),
    );
    if (!hasSource) fs.rmSync(entryPath, { force: true });
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
