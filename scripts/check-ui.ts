/**
 * Static checks on each page's hand-written UI: `bun run check:ui`.
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

const GLOBALS = new Set([
  'Array', 'Boolean', 'Date', 'Error', 'Intl', 'JSON', 'Map', 'Math', 'Number',
  'Object', 'Promise', 'Set', 'String', 'URL', 'clearTimeout', 'confirm',
  'document', 'fetch', 'history', 'localStorage', 'location', 'parseInt',
  'requestAnimationFrame', 'sessionStorage', 'setTimeout', 'window',
  'HTMLElement', 'isNaN', 'alert', 'console', 'if', 'for', 'while', 'switch',
  'catch', 'return', 'typeof', 'function', 'await', 'new', 'async', 'do',
  'else', 'try', 'yield', 'void', 'delete', 'in', 'of', 'throw',
  'encodeURIComponent', 'addEventListener', 'setInterval', 'clearInterval',
  'matchMedia', 'getComputedStyle',
  // CSS functions inside template strings, not calls.
  'translate', 'translateX', 'translateY', 'scale', 'rotate', 'calc', 'rgba', 'var',
]);

/** One page: its script, its markup, and the sheets it loads besides theme.css. */
type Page = { dir: string; js: string; css: string[] };

const PAGES: Page[] = [
  { dir: 'agent/ui', js: 'app.js', css: ['app.css'] },
  { dir: 'agent/ui/wrap', js: 'app.js', css: ['app.css'] },
  { dir: 'agent/ui/settings', js: 'settings.js', css: ['settings.css'] },
];

const failures: string[] = [];

for (const page of PAGES) {
  const where = (what: string) => `${page.dir}/${page.js} ${what}`;
  const source = await Bun.file(`${page.dir}/${page.js}`).text();
  /** Prose in comments reads as calls, so strip them before matching. */
  const js = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  /** A selector like ':not(' in a string is not a call either. */
  const code = js.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''");
  const html = await Bun.file(`${page.dir}/index.html`).text();
  let css = await Bun.file('agent/ui/theme.css').text();
  for (const sheet of page.css) css += await Bun.file(`${page.dir}/${sheet}`).text();


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

  for (const m of code.matchAll(/(?<![.\w$])([a-z][\w$]*)\s*\(/g)) {
    const name = m[1]!;
    if (defined.has(name) || GLOBALS.has(name)) continue;
    failures.push(where(`calls ${name}() which is never defined`));
  }

  // ── Ids looked up that are not in the markup ───────────────────────────────
  const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]!));
  for (const m of js.matchAll(/\$\('([^']+)'\)/g)) {
    if (!htmlIds.has(m[1]!)) failures.push(where(`looks up #${m[1]} which is not in index.html`));
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
      failures.push(where(`sets class .${c} which has no rule in its sheets`));
    }
  }

}

if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\n${failures.length} problem(s)`);
  process.exit(1);
}
console.log(`  ✓ ui checks pass on ${PAGES.length} pages (calls, ids, classes)`);
