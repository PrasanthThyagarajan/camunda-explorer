/**
 * Static check for the browser ES module graph under public/js.
 *
 * The browser resolves these at load time with no bundler, so a missing file or
 * a renamed export silently blanks the dashboard instead of failing loudly.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js');

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : walk(full);
    return full.endsWith('.js') ? [full] : [];
  });
}

const files = walk(root);

function exportsOf(file) {
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) names.add(name.trim());
    }
  }
  if (/export\s+default/.test(src)) names.add('default');
  return names;
}

const exportCache = new Map();
const problems = [];
let importCount = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = file.slice(root.length + 1);

  for (const m of src.matchAll(/import\s+([^;]*?)\s+from\s+['"](\.[^'"]+)['"]/g)) {
    importCount++;
    const [, clause, spec] = m;
    const target = resolve(dirname(file), spec);

    if (!existsSync(target)) {
      problems.push(`${rel}: imports missing file "${spec}"`);
      continue;
    }
    if (!exportCache.has(target)) exportCache.set(target, exportsOf(target));
    const available = exportCache.get(target);

    const braced = clause.match(/\{([^}]*)\}/);
    if (!braced) continue;
    for (const part of braced[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name && !available.has(name)) {
        problems.push(`${rel}: imports "${name}" from ${spec}, which does not export it`);
      }
    }
  }
}

console.log(`Modules scanned : ${files.length}`);
console.log(`Imports checked : ${importCount}`);
if (problems.length) {
  console.log(`\nBROKEN (${problems.length}):`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
console.log('\nEvery relative import resolves to a real file and a real export.');
