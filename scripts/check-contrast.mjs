#!/usr/bin/env node
/* WCAG AA check for every season theme. Reads the [data-season] token blocks straight out of index.html,
   so there is no second copy of the palette to drift. Run: node scripts/check-contrast.mjs
   Exits 1 if any required pair fails, or if a theme or token is missing. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const TOKENS = ['bg', 'surface', 'ink', 'muted', 'line', 'accent', 'accent-ink', 'metal', 'tag', 'stroke'];
const SEASONS = ['none', 'light-spring', 'true-spring', 'bright-spring', 'light-summer', 'true-summer', 'soft-summer',
  'soft-autumn', 'true-autumn', 'deep-autumn', 'deep-winter', 'true-winter', 'bright-winter'];
const STATUS = Object.fromEntries(['ok', 'warn', 'bad'].map(k => [k, (html.match(new RegExp(`--${k}:\\s*(#[0-9A-Fa-f]{6})`)) || [])[1]]));

const themes = {};
for (const m of html.matchAll(/\[data-season="([a-z-]+)"\]\s*\{([^}]*)\}/g)) {
  const t = {};
  for (const d of m[2].matchAll(/--([a-z-]+):\s*([^;]+)/g)) t[d[1]] = d[2].trim();
  themes[m[1]] = t;
}

const lin = c => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const lum = hex => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

/* [foreground, background, minimum, what it is used for] */
const REQUIRED = [
  ['ink', 'bg', 4.5, 'text'], ['ink', 'surface', 4.5, 'text'], ['ink', 'tag', 4.5, 'tag label'],
  ['muted', 'bg', 4.5, 'secondary text, field underline'], ['muted', 'surface', 4.5, 'secondary text'],
  ['accent-ink', 'accent', 4.5, 'button label'],
  ['accent', 'bg', 4.5, 'active underline, button edge'], ['accent', 'surface', 4.5, 'active underline'],
  ['ok', 'bg', 4.5, 'status text'], ['ok', 'surface', 4.5, 'status text'],
  ['warn', 'bg', 4.5, 'status text'], ['warn', 'surface', 4.5, 'status text'],
  ['bad', 'bg', 4.5, 'status text'], ['bad', 'surface', 4.5, 'status text'],
];
/* Ornament only (grommet, string, pin, hairlines): reported, not gated. No information depends on them. */
const DECOR = [['metal', 'tag'], ['metal', 'bg'], ['line', 'bg']];

let fails = 0;
const pad = (s, n) => String(s).padEnd(n);
for (const s of SEASONS) {
  const t = themes[s];
  if (!t) { console.log(`\n${s}\n  FAIL  theme block missing`); fails++; continue; }
  const missing = TOKENS.filter(k => !t[k]);
  console.log(`\n${s}`);
  if (missing.length) { console.log(`  FAIL  missing tokens: ${missing.join(', ')}`); fails++; continue; }
  const col = k => t[k] || STATUS[k];
  for (const [fg, bg, min, use] of REQUIRED) {
    const r = ratio(col(fg), col(bg)), pass = r >= min;
    if (!pass) fails++;
    console.log(`  ${pass ? 'pass' : 'FAIL'}  ${pad(fg + ' on ' + bg, 22)} ${pad(r.toFixed(2) + ':1', 9)} needs ${min}  ${use}`);
  }
  console.log(`  ----  decorative, not gated: ${DECOR.map(([a, b]) => `${a} on ${b} ${ratio(t[a], t[b]).toFixed(2)}:1`).join(' · ')}`);
}
const extra = Object.keys(themes).filter(k => !SEASONS.includes(k));
if (extra.length) { console.log(`\nFAIL  unexpected theme blocks: ${extra.join(', ')}`); fails++; }
console.log(`\n${Object.keys(themes).length} themes, ${REQUIRED.length} required pairs each: ${fails ? fails + ' FAILED' : 'all pass'}`);
process.exit(fails ? 1 : 0);
