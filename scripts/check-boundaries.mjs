// Enforces the layer rules described in docs/ARCHITECTURE.md by scanning import specifiers.
// core:    pure TypeScript; may not import Node, Electron, DOM-only libs, or other layers.
// backend: Node services; may import core and Node built-ins; not Electron or UI.
// ui:      web UI; may import core and browser libs; not Node, Electron, or backend.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { builtinModules } from 'node:module';

const root = new URL('..', import.meta.url).pathname;
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

const rules = {
  'packages/core/src': {
    allow: ['@noble/hashes', 'diff', 'fflate', 'highlight.js', 'markdown-it', 'markdown-it-footnote', 'yaml'],
    forbidNode: true,
  },
  'packages/backend/src': {
    allow: ['@mde/core', 'fflate', '@anthropic-ai/sdk'],
    forbidNode: false,
  },
  'packages/ui/src': {
    allow: ['@mde/core', 'react', 'react-dom', 'react-dom/client', 'zustand', 'pagedjs-esm', '@codemirror/', '@lezer/', '@fontsource/', 'harper.js'],
    forbidNode: true,
  },
};

const importRe = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) yield p;
  }
}

let failures = 0;
for (const [dir, rule] of Object.entries(rules)) {
  for (const file of walk(join(root, dir))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(importRe)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith('.')) continue;
      const isNode = nodeBuiltins.has(spec) || spec.startsWith('node:');
      const allowed = !isNode
        ? rule.allow.some((a) => (a.endsWith('/') ? spec.startsWith(a) : spec === a || spec.startsWith(`${a}/`)))
        : !rule.forbidNode;
      if (!allowed) {
        failures++;
        console.error(`${relative(root, file)}: import "${spec}" is not allowed in ${dir}`);
      }
    }
  }
}
if (failures) {
  console.error(`\n${failures} boundary violation(s).`);
  process.exit(1);
}
console.log('Layer boundaries OK.');
