const fs = require('node:fs');
const path = require('node:path');

const outputDir = path.resolve('.test-check');
const hasExtension = (specifier) => path.posix.extname(specifier) !== '';

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
