/**
 * Static checks on the Wrap tab's hand-written UI: `bun run check:ui`.
 *
 * `bun build` and `tsc` both pass on a browser script that calls a function
 * nobody defined, and the page then fails at the point of the call. That has
 * happened three times while editing whole regions of this file out, so the
 * check is cheap insurance rather than ceremony.
 *
 * It verifies three things:
 *   - every function called is defined somewhere, or is a known global
 *   - every id the script looks up exists in the markup
 *   - every class the script sets has a rule in the stylesheet
 */

const ui = 'agent/ui/wrap';
const source = await Bun.file(`${ui}/app.js`).text();

/** Prose in comments reads as calls, so strip them before matching. */
const js = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const html = await Bun.file(`${ui}/index.html`).text();
const css = (await Bun.file(`${ui}/app.css`).text()) + (await Bun.file('agent/ui/theme.css').text());

const GLOBALS = new Set([
  'Array', 'Boolean', 'Date', 'Error', 'Intl', 'JSON', 'Map', 'Math', 'Number',
  'Object', 'Promise', 'Set', 'String', 'URL', 'clearTimeout', 'confirm',
  'document', 'fetch', 'history', 'localStorage', 'location', 'parseInt',
  'requestAnimationFrame', 'sessionStorage', 'setTimeout', 'window',
  'HTMLElement', 'isNaN', 'alert', 'console', 'if', 'for', 'while', 'switch',
  'catch', 'return', 'typeof', 'function', 'await', 'new', 'async', 'do',
  'else', 'try', 'yield', 'void', 'delete', 'in', 'of', 'throw',
]);

const failures: string[] = [];

// ── Calls to functions that do not exist ───────────────────────────────────
const defined = new Set<string>();
for (const m of js.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) {
  defined.add(m[1]!);
}
for (const m of js.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) {
  defined.add(m[1]!);
}
// Destructured and parameter names are not worth parsing; treat any bare
// identifier that appears as a binding somewhere as defined.
for (const m of js.matchAll(/(?:\(|,|\{)\s*([a-z][\w$]*)\s*(?:,|\)|\}|=>)/g)) {
  defined.add(m[1]!);
}

for (const m of js.matchAll(/(?<![.\w$])([a-z][\w$]*)\s*\(/g)) {
  const name = m[1]!;
  if (defined.has(name) || GLOBALS.has(name)) continue;
  failures.push(`app.js calls ${name}() which is never defined`);
}

// ── Ids looked up that are not in the markup ───────────────────────────────
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]!));
for (const m of js.matchAll(/\$\('([^']+)'\)/g)) {
  if (!htmlIds.has(m[1]!)) failures.push(`app.js looks up #${m[1]} which is not in index.html`);
}

// ── Classes set that have no rule ──────────────────────────────────────────
const classes = new Set<string>();
for (const m of js.matchAll(/className\s*=\s*'([^']+)'/g)) {
  for (const c of m[1]!.split(/\s+/)) classes.add(c);
}
for (const m of js.matchAll(/classList\.(?:add|toggle|remove)\('([^']+)'/g)) {
  classes.add(m[1]!);
}
for (const c of classes) {
  if (!new RegExp(`\\.${c}\\b`).test(css)) {
    failures.push(`app.js sets class .${c} which has no rule in app.css`);
  }
}

if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\n${failures.length} problem(s) in ${ui}`);
  process.exit(1);
}
console.log('  ✓ ui checks pass (calls, ids, classes)');
