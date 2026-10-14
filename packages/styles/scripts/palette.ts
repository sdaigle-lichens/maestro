#!/usr/bin/env node
// design-palette generator: reads the canonical --name-lm / --name-dm inputs, writes the theme, its browser scheme file,
// the namespaced Tailwind utilities, Sass names and a resolved JSON, syncs inputs with the Claude Design palette card, and prints a
// contrast audit. Zero dependencies. Node 22.18+ runs it as is (erasable TypeScript only: no build step).
// Copied into projects by the design plugin: edit the plugin's copy, never a project's.

type Mode = 'light' | 'dark';
type Pair = { light: string; dark: string };
// overrides: semantic tokens re-pointed to another token, the same in both modes ({ link: 'info-text' }).
type Palette = { brand: Pair[]; font: Pair; fontInverted: Pair; background: Pair; border: Pair; status: Record<string, Pair>; overrides?: Record<string, string> };
// A token value: a hex literal, or a reference to another token written var(--color-<name>).
type Token = [name: string, value: string];
type Inputs = Record<string, { lm: string; dm: string }>;
type Check = { m: Mode; kind: 'text' | 'state' | 'brand' | 'line' | 'input' | 'hue'; fg: string; bg: string; a: string; b: string; need: number; val: number; pass: boolean; level: 'fail' | 'warn' };
type Role = 'text' | 'bg' | 'border';
type Step = [lightness: (l: number) => number, chroma: number];

const BRAND = ['primary', 'secondary', 'tertiary', 'quaternary', 'quinary'];
const STATUS: Record<string, [string, string]> = { info: ['#2f6fde', '#5b93f0'], danger: ['#d33a3a', '#ef6461'], success: ['#237a4b', '#4cb47a'], warning: ['#d99a17', '#e8b53c'] };
const rgb = (h: string): number[] => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (h: string) => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const pair = ([light, dark]: [string, string]): Pair => ({ light, dark });
const mapObj = <V, R>(o: Record<string, V>, fn: (v: V) => R): Record<string, R> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fn(v)]));

const toLin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const fromLin = (v: number) => { v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, v)) * 255); };
function hexToLab(h: string): [number, number, number] {
  const [r, g, b] = rgb(h).map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function labToHex([L, a, b]: [number, number, number]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return '#' + [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(fromLin).map(v => v.toString(16).padStart(2, '0')).join('');
}
const SCALE = ['faint', 'soft', 'strong', 'intense'];
const STEPS_LM: Record<string, Step> = {
  faint: [() => 0.97, 0.3],
  soft: [() => 0.91, 0.55],
  strong: [l => Math.min(0.5, l * 0.8), 1],
  intense: [l => Math.min(0.35, l * 0.6), 0.9]
};
const STEPS_DM: Record<string, Step> = {
  strong: [l => Math.max(0.75, l + (1 - l) * 0.35), 0.9],
  intense: [l => Math.max(0.88, l + (1 - l) * 0.6), 0.6]
};
const DM_MIX: Record<string, number> = { faint: 16, soft: 30 };
const relHex = (hex: string, d: Step) => { const [L, a, b] = hexToLab(hex); return labToHex([d[0](L), a * d[1], b * d[1]]); };
const mixHex = (x: string, pct: number, y: string) => { const A = hexToLab(x), B = hexToLab(y), t = pct / 100; return labToHex(A.map((v, i) => v * t + B[i] * (1 - t)) as [number, number, number]); };
function baseHex(p: Palette, n: string, m: Mode): string {
  if (BRAND.includes(n)) return p.brand[BRAND.indexOf(n)][m];
  if (n === 'font' || n === 'background' || n === 'border') return p[n][m];
  if (n === 'font-inverted') return p.fontInverted[m];
  return p.status[n][m];
}
function scaleHex(p: Palette, n: string, m: Mode, st: string) {
  const x = baseHex(p, n, m);
  if (m === 'light') return relHex(x, STEPS_LM[st]);
  return DM_MIX[st] ? mixHex(x, DM_MIX[st], p.background.dark) : relHex(x, STEPS_DM[st]);
}
// An intent's text and strong border: its fill when readable, else the first darker (lighter, in dark mode) step that is.
const elevatedHex = (p: Palette, m: Mode) => m === 'light' ? mixHex(p.background[m], 30, '#ffffff') : mixHex(p.font[m], 5, p.background[m]);
function readableRef(p: Palette, n: string, m: Mode, need: number, steps: string[], on: string[]): string {
  const hex = (st: string) => st ? scaleHex(p, n, m, st) : baseHex(p, n, m);
  const st = steps.find(x => on.every(b => ratio(hex(x), b) >= need)) ?? steps[steps.length - 1];
  return st ? n + '-' + st : n;
}
const textRef = (p: Palette, n: string, m: Mode) => readableRef(p, n, m, 4.5, ['', 'strong', 'intense'], [p.background[m], elevatedHex(p, m), scaleHex(p, n, m, 'faint')]);
const borderRef = (p: Palette, n: string, m: Mode) => readableRef(p, n, m, 3, ['', 'strong'], [p.background[m], elevatedHex(p, m)]);
const onRef = (p: Palette, n: string, m: Mode) => { const x = baseHex(p, n, m); return ratio(x, p.font[m]) >= ratio(x, p.fontInverted[m]) ? 'text' : 'text-inverted'; };
// Every intent: the brand slots, then the status colors.
// Unset brand slots have no tokens: only the set ones and the status colors are intents.
const intentsOf = (p: Palette) => [...p.brand.map((_, i) => BRAND[i]), ...Object.keys(p.status)];
const hoverShift = (hex: string, active: boolean) => ({ sign: hexToLab(hex)[0] > 0.78 ? -1 : 1, d: active ? 0.12 : 0.07 });
function resolver(p: Palette, m: Mode) { const T = Object.fromEntries(tokensFor(p, m)); return (k: string) => { let v = T[k], g = 0; while (v && v.startsWith('var(--color-') && g++ < 10) v = T[v.slice(12, -1)]; return v; }; }
function runAudit(p: Palette): Check[] {
  const out: Check[] = [];
  (['light', 'dark'] as const).forEach(m => {
    const r = resolver(p, m);
    const ints = intentsOf(p);
    const add = (kind: Check['kind'], fg: string, bg: string, need: number, level: Check['level'] = 'fail') => {
      const a = r(fg), b = r(bg); if (!a || !b) return;
      const val = kind === 'state' ? Math.abs(hexToLab(a)[0] - hexToLab(b)[0]) : ratio(a, b);
      out.push({ m, kind, fg, bg, a, b, need, val, pass: val >= need, level });
    };
    ints.forEach(k => { const lx = hexToLab(r(k))[0]; if (lx > 0.9) out.push({ m, kind: 'input', fg: k, bg: 'bg', a: r(k), b: r('bg'), need: 0.9, val: lx, pass: false, level: 'warn' }); });
    const hueOf = (x: string) => { const [l, a, b2] = hexToLab(x); return { h: (Math.atan2(b2, a) * 180 / Math.PI + 360) % 360, c: Math.hypot(a, b2), l }; };
    ints.filter(k => BRAND.includes(k)).forEach(k => Object.keys(p.status).forEach(st => {
      const A = hueOf(r(k)), B = hueOf(r(st)); if (A.c < 0.04 || B.c < 0.04) return;
      const dh = Math.min(Math.abs(A.h - B.h), 360 - Math.abs(A.h - B.h)), dl = Math.abs(A.l - B.l);
      if (dh < 25 && dl < 0.2) out.push({ m, kind: 'hue', fg: k, bg: st, a: r(k), b: r(st), need: 25, val: dh, pass: false, level: 'warn' });
    }));
    ints.forEach(k => { add('text', k + '-text', k + '-bg', 4.5); add('text', k + '-text', 'bg', 4.5); add('line', k + '-border-strong', 'bg', 3); add('text', 'text-on-' + k, k, 4.5); add('state', k + '-hover', k, 0.04); add('state', k + '-bg-hover', k + '-bg', 0.04); add('state', k + '-bg-active', k + '-bg-hover', 0.04); add('brand', k, 'bg', 3, 'warn'); });
    ['bg', 'bg-elevated', 'bg-inset'].forEach(bg => { add('text', 'text', bg, 4.5); add('text', 'text-muted', bg, 4.5); });
    ['bg', 'bg-elevated'].forEach(bg => { add('text', 'link', bg, 4.5); add('line', 'border-input', bg, 3); add('line', 'focus-ring', bg, 3); add('line', 'focus-ring-danger', bg, 3); });
    add('state', 'bg-hover', 'bg', 0.04, 'warn'); add('state', 'bg-hover', 'bg-elevated', 0.04, 'warn');
  });
  return out;
}

const BASE_INPUTS = ['font', 'font-inverted', 'background', 'border'];
function fromInputs(o: Partial<Inputs>, overrides: Record<string, string> = {}): Palette {
  const g = (n: string): Pair | null => { const v = o[n]; return v ? { light: v.lm ?? v.dm, dark: v.dm ?? v.lm } : null; };
  const brand: Pair[] = []; BRAND.forEach((n, i) => { const v = g(n); if (v) brand[i] = v; });
  const font = g('font') as Pair, background = g('background') as Pair, status: Record<string, Pair> = {};
  Object.keys(o).filter(n => !BRAND.includes(n) && !BASE_INPUTS.includes(n)).forEach(n => { status[n] = g(n) as Pair; });
  return { brand: brand.filter(Boolean), font, background, status: Object.keys(status).length ? status : mapObj(STATUS, pair),
    fontInverted: g('font-inverted') ?? { ...background },
    border: g('border') ?? { light: mixHex(font.light, 14, background.light), dark: mixHex(font.dark, 14, background.dark) }, overrides: { ...overrides } };
}
// Token overrides: only the semantic tokens (the ones that reference another token) can be re-pointed, to any other token.
const overridable = (p: Palette) => tokensFor({ ...p, overrides: {} }, 'light').filter(([, v]) => v.startsWith('var(--color-')).map(([k]) => k);
function overrideErrors(p: Palette, o: Record<string, string>): string[] {
  const can = new Set(overridable(p)), names = new Set(tokensFor(p, 'light').map(([k]) => k));
  const bad = Object.entries(o).flatMap(([k, t]) => !can.has(k) ? ['--' + k + ' is not a semantic token (only tokens that reference another one can be overridden)']
    : !names.has(t) || t === k ? ['--' + k + ': var(--' + t + ') is not another token of the theme'] : []);
  if (bad.length) return bad;
  const q = { ...p, overrides: o };
  return (['light', 'dark'] as const).flatMap(m => { const r = resolver(q, m); return Object.keys(o).filter(k => !(r(k) || '').startsWith('#')).map(k => '--' + k + ' (' + m + '): the overrides make a loop'); });
}
function toInputs(p: Palette): Inputs {
  const o: Inputs = {};
  [...p.brand.map((_, i) => BRAND[i]), ...BASE_INPUTS, ...Object.keys(p.status)].forEach(n => { o[n] = { lm: baseHex(p, n, 'light'), dm: baseHex(p, n, 'dark') }; });
  return o;
}

// Hand-authored tokens: every other custom property of the inputs file (spacing, type, radius, breakpoints…, named like
// Tailwind v4's theme variables). Copied as is into the theme and the Sass file, never derived. In a generated file
// (one-file layout) they are the block under the EXTRAS comment. A declaration named like a semantic token of the
// theme is a token override instead (--link: var(--info-text)): splitExtras sorts them; in a generated file they are
// the block under the OVERRIDES comment.
type Extra = [name: string, value: string];
const EXTRAS = 'Hand-authored tokens', OVERRIDES = 'Token overrides';
const declsOf = (css: string): Extra[] => [...css.replace(/\/\*[^]*?\*\//g, '').matchAll(/--([a-z][a-z0-9-]*)\s*:\s*([^;{}]+)(?:;|(?=\}))/g)].map(([, n, v]): Extra => [n, v.replace(/\s+/g, ' ').trim()]);
function readExtras(css: string): Extra[] {
  if (!/^\/\* Generated by design-palette/.test(css)) return declsOf(css).filter(([n]) => !/-(lm|dm)$/.test(n));
  const block = (title: string) => { const i = css.indexOf('/* ' + title); return i < 0 ? [] : declsOf(css.slice(css.indexOf('*/', i) + 2, css.indexOf('}', i))); };
  return [...block(EXTRAS), ...block(OVERRIDES)];
}
const REF_RE = /^var\(--([a-z][a-z0-9-]*)\)$/;
function splitExtras(semantic: string[], decls: Extra[]) {
  const can = new Set(semantic), overrides: Record<string, string> = {}, errors: string[] = [];
  const extras = decls.filter(([n, v]) => {
    if (!can.has(n)) return true;
    const m = v.match(REF_RE);
    if (m) overrides[n] = m[1]; else errors.push('--' + n + ' overrides a semantic token: its value must be var(--<token>), got ' + v);
    return false;
  });
  return { extras, overrides, errors };
}
function overridesCss(o: Record<string, string>) {
  const e = Object.entries(o);
  return e.length ? '\n\n/* ' + OVERRIDES + ': semantic tokens re-pointed to another token, the same in both modes. Edit them here: palette.ts keeps them. */\n:root {\n' + e.map(([k, t]) => '  --' + k + ': var(--' + t + ');').join('\n') + '\n}' : '';
}
const generatedNames = (p: Palette) => new Set(tokensFor(p, 'light').flatMap(([k]) => [k, k + '-light', k + '-dark']));
function extrasCss(extras: Extra[], from: string) {
  if (!extras.length) return '';
  const where = from ? 'Copied as is from ' + from + ': edit them there.' : 'Edit them here: palette.ts copies them as is.';
  return '\n\n/* ' + EXTRAS + ' (spacing, type, radius, breakpoints…), the same in both modes. ' + where + ' */\n:root {\n' + extras.map(([n, v]) => '  --' + n + ': ' + v + ';').join('\n') + '\n}';
}

// [token, light, dark]: each side is a hex literal, an input (var(--X-lm)) or a token reference (var(--Y)).
function webTokens(p: Palette): [string, string, string][] {
  const dk = Object.fromEntries(tokensFor(p, 'dark')), inp = (n: string, m: Mode) => 'var(--' + n + (m === 'light' ? '-lm' : '-dm') + ')';
  const input: Record<string, string> = { bg: 'background', border: 'border', text: 'font', 'text-inverted': 'font-inverted' };
  intentsOf(p).forEach(n => { input[n] = n; });
  const ref = (v: string) => v.startsWith('var(--color-') ? 'var(--' + v.slice(12) : v;
  return tokensFor(p, 'light').map(([k, v]) => input[k] ? [k, inp(input[k], 'light'), inp(input[k], 'dark')] : [k, ref(v), ref(dk[k])]);
}
const modeRef = (k: string, v: string, m: Mode) => v[0] === '#' ? 'var(--' + k + '-' + m + ')' : v;
function buildWebCss(p: Palette, extras: Extra[] = [], from = ''): string {
  const T = webTokens(p);
  const inputs = [...p.brand.map((_, i) => BRAND[i]), ...BASE_INPUTS, ...Object.keys(p.status)];
  const L = ['/* Generated by design-palette/scripts/palette.ts. Edit only the Inputs block and the ' + EXTRAS.toLowerCase() + ', then re-run the script.', '   Plain values and var() only, so web and React Native (NativeWind) can share this file. */', ':root {', '  /* 1. Inputs: -lm light mode, -dm dark mode. Primary + secondary required */'];
  inputs.forEach(n => L.push('  --' + n + '-lm: ' + baseHex(p, n, 'light') + ';', '  --' + n + '-dm: ' + baseHex(p, n, 'dark') + ';'));
  L.push('', '  /* 2. Generated values per mode: faint > soft > base > strong > intense scales, neutrals, hover, effects */');
  T.forEach(([k, a, b]) => { if (a === b) return; if (a[0] === '#') L.push('  --' + k + '-light: ' + a + ';'); if (b[0] === '#') L.push('  --' + k + '-dark: ' + b + ';'); });
  L.push('', '  /* 3. Tokens: what components use. Light values here; the dark block below re-points the ones that change.', '     Semantic tokens only reference other tokens, so they follow the mode. */');
  T.forEach(([k, a, b]) => L.push('  --' + k + ': ' + (a === b ? a : modeRef(k, a, 'light')) + ';'));
  L.push('}', '', '/* Dark mode: prefers-color-scheme (Appearance.setColorScheme on React Native). To force a mode in a browser,', '   import the scheme file (palette.ts --scheme) after this one and set color-scheme on <html>. */', '@media (prefers-color-scheme: dark) {', '  :root {');
  T.forEach(([k, a, b]) => { if (a !== b) L.push('    --' + k + ': ' + modeRef(k, b, 'dark') + ';'); });
  L.push('  }', '}');
  return L.join('\n') + extrasCss(extras, from) + (from ? '' : overridesCss(p.overrides || {}));
}
// Sass names for every token: $text-muted is var(--text-muted), so values stay live (dark mode) and a misspelled name
// fails the build. Breakpoints are the exception: media queries cannot read var(), so they hold the literal value.
function buildSass(p: Palette, extras: Extra[], from: string): string {
  const bp = extras.filter(([n]) => n.startsWith('breakpoint-'));
  const bad = bp.find(([, v]) => v.includes('var('));
  if (bad) throw new Error('--' + bad[0] + ' must be a literal (e.g. 640px): media queries cannot read var()');
  const L = ['// Generated by design-palette/scripts/palette.ts from ' + from + '. Do not edit: change the inputs there and re-run.', '// Each name is the theme\'s custom property (load the theme CSS too): no Sass math or color functions on them.', '// Breakpoints hold literal values for media queries: @include mq(sm) { … }.', '@use "sass:map";', '', '// Palette tokens'];
  tokensFor(p, 'light').forEach(([k]) => L.push('$' + k + ': var(--' + k + ');'));
  const rest = extras.filter(e => !bp.includes(e));
  if (rest.length) L.push('', '// ' + EXTRAS, ...rest.map(([n]) => '$' + n + ': var(--' + n + ');'));
  if (bp.length) L.push('', '// Breakpoints', ...bp.map(([n, v]) => '$' + n + ': ' + v + ';'),
    '$breakpoints: (' + bp.map(([n, v]) => n.slice(11) + ': ' + v).join(', ') + ');', '',
    '@mixin mq($name) {', '  @if not map.has-key($breakpoints, $name) {', '    @error "Unknown breakpoint #{$name}, expected one of #{map.keys($breakpoints)}";', '  }',
    '  @media (min-width: map.get($breakpoints, $name)) {', '    @content;', '  }', '}');
  return L.join('\n');
}
function buildSchemeCss(p: Palette): string {
  const L = ['/* Generated with the design palette. Browser only: never import it on React Native, where react-native-css', '   turns light-dark() into arrays. Import it after the theme; color-scheme on <html> then picks the mode. */', ':root {', '  color-scheme: light dark;'];
  webTokens(p).forEach(([k, a, b]) => { if (a !== b) L.push('  --' + k + ': light-dark(' + modeRef(k, a, 'light') + ', ' + modeRef(k, b, 'dark') + ');'); });
  L.push('}');
  return L.join('\n');
}

function buildThumbnail(p: Palette, title?: string): string {
  const bg = baseHex(p, 'primary', 'light'), fg = baseHex(p, onRef(p, 'primary', 'light') === 'text' ? 'font' : 'font-inverted', 'light');
  const t = String(title || 'Palette').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const strip = Object.keys(p.status).map(k => '<div style="flex:1;background:' + baseHex(p, k, 'light') + '"></div>').join('');
  return '<!doctype html>\n<!-- Generated by design-palette/scripts/palette.ts from the palette inputs. Do not edit. -->\n<html><head><meta charset="utf-8"><title>' + t + '</title>' +
    '<style>html,body{margin:0;height:100%}body{display:flex;background:' + bg + ';color:' + fg + ';font:700 clamp(32px,12vw,160px)/1 system-ui,sans-serif;letter-spacing:-0.03em}</style></head>' +
    '<body><div style="flex:1;display:grid;place-items:center;padding:0 6vw;text-align:center">' + t + '</div><div style="width:4vw;display:flex;flex-direction:column">' + strip + '</div></body></html>\n';
}

function tokensFor(p: Palette, m: Mode): Token[] {
  const T: Token[] = [], lm = m === 'light', f = p.font[m], b = p.background[m], r = p.border[m], W = '#ffffff', K = '#000000';
  intentsOf(p).forEach(n => { T.push([n, baseHex(p, n, m)]); SCALE.forEach(st => T.push([n + '-' + st, scaleHex(p, n, m, st)])); });
  T.push(['bg', b], ['bg-faint', mixHex(f, lm ? 6 : 11, b)], ['bg-soft', mixHex(f, lm ? 10 : 15, b)], ['bg-strong', mixHex(f, lm ? 14 : 20, b)], ['bg-intense', mixHex(f, lm ? 31 : 36, b)],
    ['border', r], ['border-strong', mixHex(r, 80, f)],
    ['bg-elevated', lm ? mixHex(b, 30, W) : mixHex(f, 5, b)], ['bg-inset', lm ? mixHex(f, 3, b) : mixHex(b, 80, K)],
    ['text', f], ['text-inverted', p.fontInverted[m]], ['text-faint', mixHex(f, 45, b)], ['text-soft', mixHex(f, 68, b)], ['text-strong', mixHex(f, 85, lm ? K : W)], ['text-intense', mixHex(f, 70, lm ? K : W)]);
  const ref = (k: string) => 'var(--color-' + k + ')';
  T.push(['bg-hover', ref('bg-faint')], ['bg-active', ref('bg-soft')], ['border-input', ref('text-faint')], ['text-muted', ref('text-soft')], ['text-disabled', ref('text-faint')], ['bg-disabled', ref('bg-soft')], ['focus-ring', ref('primary-strong')], ['link', ref('primary-text')], ['link-hover', ref('primary-strong')]);
  intentsOf(p).forEach(n => T.push([n + '-bg', ref(n + '-faint')], [n + '-bg-hover', ref(n + '-soft')], [n + '-border', ref(n + '-soft')], [n + '-border-strong', ref(borderRef(p, n, m))], [n + '-text', ref(textRef(p, n, m))], ['text-on-' + n, ref(onRef(p, n, m))]));
  if (intentsOf(p).includes('danger')) T.push(['focus-ring-danger', ref('danger-border-strong')]);
  const sh = (x: string, o: { sign: number; d: number }) => { const [l, a, b2] = hexToLab(x); return labToHex([l + o.sign * o.d, a, b2]); };
  intentsOf(p).forEach(n => { const x = baseHex(p, n, m), s = scaleHex(p, n, m, 'soft'); T.push([n + '-hover', sh(x, hoverShift(x, false))], [n + '-active', sh(x, hoverShift(x, true))], [n + '-bg-active', sh(s, hoverShift(s, false))]); });
  T.push(['overlay', lm ? '#00000073' : '#000000a6'], ['shadow', lm ? f + '2e' : '#0000008c']);
  const o = p.overrides || {};
  return T.map(([k, v]): Token => o[k] && v.startsWith('var(--color-') ? [k, ref(o[k])] : [k, v]);
}

// Tailwind names: every token under the project namespace, the role word moved into the utility (text-noa-muted,
// bg-noa-elevated, border-noa-strong) through Tailwind's per-utility color namespaces, which win over --color-* for
// that utility only. Intents: bg-noa-primary is the solid fill, bg-noa-primary-subtle its tint, text-noa-primary and
// border-noa-primary its readable text and its border. Any token also works on any utility by its full name
// (bg-noa-primary-faint, ring-noa-focus-ring).
const ROLE_NS: Record<Role, string> = { text: '--text-color-', bg: '--background-color-', border: '--border-color-' };
function namespacedNames(p: Palette, ns: string) {
  const intents = intentsOf(p), out: Record<Role, [string, string][]> = { text: [], bg: [], border: [] }, warn: string[] = [];
  const add = (role: Role, name: string, k: string) => {
    const hit = out[role].find(([n]) => n === name);
    if (hit) { if (hit[1] !== k) warn.push(role + '-' + name + ' is both --' + hit[1] + ' and --' + k + ': kept --' + hit[1]); return; }
    out[role].push([name, k]);
  };
  tokensFor(p, 'light').forEach(([k]) => {
    const role = (Object.keys(ROLE_NS) as Role[]).find(r => k === r || k.startsWith(r + '-'));
    if (role) return add(role, ns + k.slice(role.length), k);
    const i = intents.find(n => k === n || k.startsWith(n + '-'));
    if (!i) return;
    const rest = k.slice(i.length);
    if (rest === '' || rest === '-hover' || rest === '-active') add('bg', ns + '-' + k, k);
    else if (rest === '-bg' || rest === '-bg-hover' || rest === '-bg-active') add('bg', ns + '-' + i + '-subtle' + rest.slice(3), k);
    else if (rest === '-text') add('text', ns + '-' + i, k);
    else if (rest === '-border') add('border', ns + '-' + i, k);
    else if (rest === '-border-strong') add('border', ns + '-' + i + '-strong', k);
  });
  return { out, warn };
}
function buildTailwindCss(p: Palette, ns: string, themeCss: string): string {
  const head = themeCss ? 'Edit only the inputs block below, then re-run the script.' : 'Import the theme file (palette.ts --theme) too. Do not edit: re-run the script.';
  const L = ['/* Generated by design-palette/scripts/palette.ts: Tailwind v4 utilities for the palette tokens. ' + head + ' */', '@import "tailwindcss";', '', ...(themeCss ? [themeCss, ''] : [])];
  L.push('/* text-' + ns + ', text-' + ns + '-muted, bg-' + ns + '-elevated, border-' + ns + '-strong, bg-' + ns + '-primary (solid), bg-' + ns + '-primary-subtle (tint),', '   text-' + ns + '-primary; any token by its full name on any utility: bg-' + ns + '-primary-faint. Inline keeps them following the mode. */', '@theme inline {');
  tokensFor(p, 'light').forEach(([k]) => L.push('  --color-' + ns + '-' + k + ': var(--' + k + ');'));
  (Object.entries(namespacedNames(p, ns).out) as [Role, [string, string][]][]).forEach(([role, names]) => names.forEach(([n, k]) => L.push('  ' + ROLE_NS[role] + n + ': var(--' + k + ');')));
  L.push('}');
  return L.join('\n');
}
function buildJson(p: Palette): string {
  const l = resolver(p, 'light'), d = resolver(p, 'dark');
  return '{\n' + tokensFor(p, 'light').map(([k]) => '  ' + JSON.stringify(k) + ': { "light": "' + l(k) + '", "dark": "' + d(k) + '" }').join(',\n') + '\n}';
}

// ---------------------------------------------------------------------------
// Inputs I/O: canonical CSS <-> inputs object <-> Claude Design palette card
// ---------------------------------------------------------------------------
type CardProp = { editor: string | null; default: unknown; tsType: string };
type CardProps = Record<string, CardProp | undefined>;
const INPUT_RE = /--([a-z][a-z0-9-]*)-(lm|dm)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
const normHex = (h: string) => { h = h.toLowerCase(); return h.length === 4 ? '#' + [...h.slice(1)].map(c => c + c).join('') : h; };

function readThemeInputs(css: string): Partial<Inputs> {
  const o: Record<string, Record<string, string>> = {};
  for (const [, name, mode, hex] of css.matchAll(INPUT_RE)) (o[name] ??= {})[mode] = normHex(hex);
  return o as Partial<Inputs>;
}
function requireInputs(o: Partial<Inputs>, where: string) {
  const missing = ['primary', 'secondary', 'font', 'background'].filter(n => !o[n]);
  if (missing.length) throw new Error('Missing required inputs in ' + where + ': ' + missing.join(', '));
}
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function readCardProps(html: string): CardProps {
  const m = html.match(/data-dc-script[^>]*data-props="([^"]*)"/) || html.match(/data-props="([^"]*)"/);
  if (!m) throw new Error('No data-props found on the palette card');
  return JSON.parse(unesc(m[1]));
}
function writeCardProps(html: string, props: CardProps) { return html.replace(/data-props="[^"]*"/, 'data-props="' + esc(JSON.stringify(props)) + '"'); }
function cardInputs(html: string) { return (readCardProps(html).inputs?.default ?? null) as Inputs | null; }
// The card's hand-authored token values ({ "spacing-md": "1em" }): it edits the values of the inputs file's tokens, never
// their names, since components compile against them.
type Tokens = Record<string, string>;
function cardTokens(html: string) { return (readCardProps(html).tokens?.default ?? null) as Tokens | null; }
const badToken = (v: unknown) => typeof v !== 'string' || !v.trim() || /[;{}]/.test(v);
const applyTokens = (extras: Extra[], t: Tokens) => extras.map(([n, v]): Extra => [n, t[n] === undefined ? v : t[n].replace(/\s+/g, ' ').trim()]);
function diffTokens(from: Extra[], to: Tokens) {
  const out: string[] = [], names = new Set(from.map(([n]) => n));
  applyTokens(from, to).forEach(([n, v], i) => { if (v !== from[i][1]) out.push('~ --' + n + '  ' + from[i][1] + ' -> ' + v); });
  Object.keys(to).filter(n => !names.has(n)).forEach(n => out.push('? --' + n + ' is not in the inputs file: ignored (add it there first)'));
  return out;
}
// The card's token overrides ({ link: 'info-text' }); null when the card has none, undefined when it predates them.
function cardOverrides(html: string) { const o = readCardProps(html).overrides; return o ? (o.default ?? {}) as Record<string, string> : undefined; }
function diffOverrides(from: Record<string, string>, to: Record<string, string>) {
  return [...new Set([...Object.keys(from), ...Object.keys(to)])].flatMap(k => from[k] === to[k] ? []
    : !from[k] ? ['+ --' + k + ': var(--' + to[k] + ')'] : !to[k] ? ['- --' + k + ' (back to its generated reference)'] : ['~ --' + k + '  var(--' + from[k] + ') -> var(--' + to[k] + ')']);
}
function withCardInputs(html: string, inputs: Inputs, title?: string, ns?: string, tokens?: Tokens, overrides?: Record<string, string>) {
  const props = readCardProps(html);
  if (title) props.title = { editor: 'text', default: title, tsType: 'string' };
  if (ns) props.namespace = { editor: null, default: ns, tsType: 'string' };
  props.inputs = { editor: null, default: inputs, tsType: 'Record<string, { lm: string; dm: string }> | null' };
  if (tokens) props.tokens = { editor: null, default: Object.keys(tokens).length ? tokens : null, tsType: 'Record<string, string> | null' };
  if (overrides) props.overrides = { editor: null, default: Object.keys(overrides).length ? overrides : null, tsType: 'Record<string, string> | null' };
  if (props.preset) props.preset.default = 'project';
  return writeCardProps(html, props);
}
// Rewrites the input values of an inputs file in place: keeps its comments and order, drops inputs the new set lacks
// and appends new ones before the brace closing the inputs block (not the hand-authored tokens' block after it).
function withInputs(css: string, o: Inputs) {
  const seen = new Set<string>();
  let end = -1;
  const out = css.replace(/^[ \t]*--([a-z][a-z0-9-]*)-(lm|dm)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;[^\n]*\n?/gm, (line: string, n: string, m: 'lm' | 'dm', hex: string, at: number) => {
    end = at;
    if (!o[n]) return '';
    seen.add(n);
    return line.replace(hex, o[n][m]);
  });
  const add = Object.keys(o).filter(n => !seen.has(n)).flatMap(n => ['  --' + n + '-lm: ' + o[n].lm + ';', '  --' + n + '-dm: ' + o[n].dm + ';']);
  if (!add.length) return out;
  // The text after the last input line is unchanged: find its brace in css, then the same distance from out's end.
  const j = end < 0 ? -1 : css.indexOf('}', end), i = j < 0 ? out.lastIndexOf('}') : out.length - (css.length - j);
  return out.slice(0, i) + add.join('\n') + '\n' + out.slice(i);
}
// font-inverted and border are optional, derived when left out. The card always holds them (toInputs), so an inputs
// file that left one out keeps deriving it unless the card's value is neither the derived one before nor after the edit.
const OPTIONAL = ['font-inverted', 'border'];
function dropDerived(card: Inputs, file: Partial<Inputs>): Inputs {
  const required = (o: Partial<Inputs>) => Object.fromEntries(Object.entries(o).filter(([n]) => !OPTIONAL.includes(n)));
  const derived = [file, card].filter(o => o.font && o.background).map(o => toInputs(fromInputs(required(o))));
  const same = (a: { lm: string; dm: string }, b: { lm: string; dm: string }) => a.lm.toLowerCase() === b.lm.toLowerCase() && a.dm.toLowerCase() === b.dm.toLowerCase();
  return Object.fromEntries(Object.entries(card).filter(([n, v]) => !(OPTIONAL.includes(n) && !file[n] && derived.some(d => same(d[n], v)))));
}
const pickInputs = (o: Inputs, keep: Partial<Inputs>): Inputs => Object.fromEntries(Object.entries(o).filter(([n]) => keep[n]));
// Rewrites the token overrides of an inputs file in place: drops the ones o lacks, adds new ones in the block holding
// the others, else in the template's block under the OVERRIDES comment, else in a new block at the end.
function withOverrides(css: string, o: Record<string, string>, semantic: string[]) {
  const seen = new Set<string>();
  let end = -1;
  const out = css.replace(/^[ \t]*--([a-z][a-z0-9-]*)\s*:\s*var\(--[a-z0-9-]+\)\s*;[^\n]*\n?/gm, (line: string, n: string, at: number) => {
    if (!semantic.includes(n)) return line;
    end = at;
    if (!o[n]) return '';
    seen.add(n);
    return line.replace(/var\(--[a-z0-9-]+\)/, 'var(--' + o[n] + ')');
  });
  const add = Object.keys(o).filter(n => !seen.has(n)).map(n => '  --' + n + ': var(--' + o[n] + ');');
  if (!add.length) return out;
  const block = out.indexOf('/* ' + OVERRIDES);
  if (end < 0 && block < 0) return out.replace(/\s*$/, '') + '\n\n/* ' + OVERRIDES + ': semantic tokens re-pointed to another token, the same in both modes. */\n:root {\n' + add.join('\n') + '\n}\n';
  // After the last override line, else in the (empty) block under the OVERRIDES comment.
  const j = end < 0 ? -1 : css.indexOf('}', end), i = j < 0 ? out.indexOf('}', out.indexOf('*/', block)) : out.length - (css.length - j);
  return out.slice(0, i) + add.join('\n') + '\n' + out.slice(i);
}
// Rewrites the hand-authored token values of an inputs file in place, keeping its comments and order.
function withTokens(css: string, extras: Extra[]) {
  const v = Object.fromEntries(extras);
  return css.replace(/^([ \t]*--([a-z][a-z0-9-]*)\s*:\s*)([^;{}]+?)(\s*;)/gm, (line: string, head: string, n: string, _old: string, tail: string) =>
    n in v && !/-(lm|dm)$/.test(n) ? head + v[n] + tail : line);
}
function diffInputs(from: Partial<Inputs>, to: Partial<Inputs>) {
  const out: string[] = [];
  new Set([...Object.keys(from), ...Object.keys(to)]).forEach(n => {
    const a = from[n], b = to[n];
    if (!a) out.push('+ ' + n + '  lm ' + b?.lm + '  dm ' + b?.dm);
    else if (!b) out.push('- ' + n);
    else (['lm', 'dm'] as const).forEach(m => { if ((a[m] || '').toLowerCase() !== (b[m] || '').toLowerCase()) out.push('~ ' + n + '  ' + m + ' ' + a[m] + ' -> ' + b[m]); });
  });
  return out;
}
function report(p: Palette) {
  const res = runAudit(p), bad = res.filter(c => !c.pass);
  const fmt = (c: Check) => (c.level === 'fail' ? 'FAIL' : 'WARN') + '  ' + c.m.padEnd(5) + '  ' +
    (c.kind === 'hue' ? '--' + c.fg + ' looks like --' + c.bg + ' (hue ' + c.val.toFixed(0) + '° apart): brand may read as a status'
      : c.kind === 'input' ? '--' + c.fg + ' is very light (L ' + c.val.toFixed(2) + '): weak tints and hover'
      : '--' + c.fg + ' on --' + c.bg + '  ' + (c.kind === 'state' ? 'dL ' + c.val.toFixed(3) + ' (need ' + c.need + ')' : c.val.toFixed(2) + ':1 (need ' + c.need + ':1)'));
  const fails = bad.filter(c => c.level === 'fail').length;
  return { text: ['Contrast audit: ' + res.length + ' checks, ' + fails + ' fail, ' + (bad.length - fails) + ' warn', ...bad.map(fmt)].join('\n'), fails };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const USAGE = [
  'Usage: node palette.ts <inputs.css> [options]',
  '  <inputs.css>          canonical file holding the --name-lm / --name-dm inputs; its other custom properties',
  '                        (spacing, type, breakpoints…) are hand-authored tokens, copied as is into the theme, and the',
  '                        ones named like a semantic token are overrides that re-point it (--link: var(--info-text))',
  '  --web                 regenerate <inputs.css> as the full theme (plain values + var(), shared by web and React Native)',
  '  --theme <file>        write the full theme to <file> instead, leaving <inputs.css> as the inputs only',
  '  --scheme <file>       write the browser-only light-dark() file that lets color-scheme force a mode',
  '                        (may equal the theme file for web-only projects)',
  '  --mobile <file>       write the Tailwind v4 utilities for the tokens (equals <inputs.css> for mobile-only projects:',
  '                        the file then also holds the full theme). Needs --namespace',
  '  --namespace <name>    the project namespace of the Tailwind names (manifest palette.namespace): text-<name>-muted,',
  '                        bg-<name>-elevated, bg-<name>-primary-subtle…; with --to-card, also written into the card',
  '  --json <file>         write every token resolved to a hex per mode, for code that cannot read CSS variables',
  '  --sass <file>         write Sass names for every token ($text-muted: var(--text-muted)) and the breakpoints as',
  '                        literal values with an mq() mixin, for Sass projects (load the theme CSS too)',
  '  --to-card <card>      write the inputs, hand-authored token values and overrides into the Claude Design palette',
  '                        card (data-props "inputs", "tokens" and "overrides")',
  '  --from-card <card>    take the inputs, token values and overrides from the palette card (prints the diff), write',
  '                        them into <inputs.css>, then generate. Token names the inputs file lacks are ignored',
  '  --diff-card <card>    print the input, token and override diff between <inputs.css> and the card, write nothing',
  '  --thumbnail <file>    write the Claude Design project thumbnail (primary + status strip)',
  '  --title <name>        project name for --to-card and --thumbnail (default: the --from-card card\'s title)',
  '  --audit-only          print the contrast audit, write nothing',
  '  --strict              exit 1 when the audit has failures (default: report only)'
].join('\n');

const isMain = typeof process !== 'undefined' && process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href;
if (isMain) {
  const fs = await import('node:fs');
  const args = process.argv.slice(2);
  const valued = ['--theme', '--mobile', '--scheme', '--json', '--sass', '--to-card', '--from-card', '--diff-card', '--thumbnail', '--title', '--namespace'];
  const flags = ['--web', '--audit-only', '--strict', '--help'];
  const fail = (msg: string): never => { console.error('palette.ts: ' + msg); process.exit(1); };
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const has = (k: string) => args.includes(k);
  if (has('--help')) { console.log(USAGE); process.exit(0); }
  const unknown = args.filter((a, i) => a.startsWith('--') && !valued.includes(a) && !flags.includes(a) && !valued.includes(args[i - 1]));
  if (unknown.length) fail('unknown option ' + unknown.join(', ') + '\n' + USAGE);
  valued.forEach(k => { const v = opt(k); if (has(k) && (!v || v.startsWith('--'))) fail(k + (k === '--title' || k === '--namespace' ? ' needs a name' : ' needs a file path')); });
  const input = args.find((a, i) => !a.startsWith('--') && !valued.includes(args[i - 1])) ?? fail('missing <inputs.css>\n' + USAGE);
  const mobile = opt('--mobile'), scheme = opt('--scheme'), json = opt('--json'), sass = opt('--sass'), diffCard = opt('--diff-card'), fromCard = opt('--from-card'), toCard = opt('--to-card'), ns = opt('--namespace');
  if (has('--web') && has('--theme')) fail('pass --web (theme in <inputs.css>) or --theme <file> (theme elsewhere), not both');
  const theme = opt('--theme') ?? (has('--web') ? input : undefined);
  if (theme && mobile === input) fail('--mobile <inputs.css> already writes the full theme: drop ' + (has('--web') ? '--web' : '--theme'));
  if (theme && theme === mobile) fail('--theme and --mobile cannot write the same file: pass --mobile <inputs.css> for a mobile-only file');
  if (scheme === input && theme !== input) fail('--scheme <inputs.css> needs --web: React Native cannot read light-dark(), and the inputs file must keep its inputs');
  if (scheme && scheme === mobile) fail('--scheme and --mobile cannot write the same file: React Native cannot read light-dark()');
  if (json === input) fail('--json cannot write <inputs.css>');
  if (sass && [input, theme, scheme, mobile, json].includes(sass)) fail('--sass needs a file of its own');
  if (ns !== undefined && !/^[a-z][a-z0-9]*$/.test(ns)) fail('--namespace takes lowercase letters and digits, e.g. noa');
  if (mobile && !ns && !has('--audit-only')) fail('--mobile needs --namespace <name> (the manifest palette.namespace)');
  const read = (f: string) => { if (!fs.existsSync(f)) fail('file not found: ' + f); return fs.readFileSync(f, 'utf8'); };

  try {
    let inputs = readThemeInputs(read(input));
    const decls = readExtras(read(input));
    const split = (o: Partial<Inputs>) => splitExtras(o.font && o.background ? overridable(fromInputs(o)) : [], decls);
    let { extras, overrides, errors } = split(inputs);
    if (diffCard) {
      const html = read(diffCard), ci = cardInputs(html), ct = cardTokens(html), co = cardOverrides(html);
      if (!ci) { console.log('card has no inputs yet'); process.exit(0); }
      const d = [...diffInputs(inputs, dropDerived(ci, inputs)), ...(ct ? diffTokens(extras, ct) : []), ...(co ? diffOverrides(overrides, co) : [])];
      console.log(d.length ? 'theme -> card differences:\n' + d.join('\n') : 'theme and card inputs match');
      process.exit(0);
    }
    let title = opt('--title');
    if (fromCard) {
      const html = read(fromCard), ci = cardInputs(html) ?? fail('the palette card has no inputs: ' + fromCard);
      title ??= readCardProps(html).title?.default as string | undefined;
      const next = dropDerived(mapObj(ci, v => ({ lm: v.lm && normHex(v.lm), dm: v.dm && normHex(v.dm) })), inputs);
      const d = diffInputs(inputs, next);
      console.log(d.length ? 'applying card inputs:\n' + d.join('\n') : 'card inputs already match the theme');
      inputs = next;
      ({ extras, overrides, errors } = split(inputs));
      const co = cardOverrides(html);
      if (co) {
        const od = diffOverrides(overrides, co);
        console.log(od.length ? 'applying card overrides:\n' + od.join('\n') : 'card overrides already match the inputs file');
        overrides = { ...co };
      }
      const ct = cardTokens(html);
      if (ct) {
        const bad = Object.keys(ct).filter(n => badToken(ct[n]));
        if (bad.length) fail('the palette card has invalid token values (empty, or with ; { }): --' + bad.join(', --'));
        const td = diffTokens(extras, ct);
        console.log(td.length ? 'applying card tokens:\n' + td.join('\n') : 'card tokens already match the inputs file');
        extras = applyTokens(extras, ct);
      }
    }
    requireInputs(inputs, fromCard ? fromCard : input);
    if (errors.length) fail(errors.join('\n'));
    const p = fromInputs(inputs, overrides);
    const oe = overrideErrors(p, overrides);
    if (oe.length) fail('invalid token overrides' + (fromCard ? ' in the palette card' : '') + ':\n' + oe.join('\n'));
    const gen = generatedNames(p), clash = extras.filter(([n]) => gen.has(n)).map(([n]) => '--' + n);
    if (clash.length) fail(clash.join(', ') + ' in ' + input + (clash.length > 1 ? ' are' : ' is') + ' generated: rename (hand-authored tokens use Tailwind names: --spacing-md, --text-lg, --breakpoint-sm); only semantic tokens (--link, --primary-text…) take an override');

    if (!has('--audit-only')) {
      if (fromCard && theme !== input && mobile !== input) { fs.writeFileSync(input, withOverrides(withTokens(withInputs(read(input), pickInputs(toInputs(p), inputs)), extras), overrides, overridable(p))); console.log('wrote the card inputs, tokens and overrides into ' + input); }
      if (theme) {
        const css = theme === input ? buildWebCss(p, extras) : buildWebCss(p, extras, input).replace(/^\/\*[^]*?\*\//, '/* Generated by design-palette/scripts/palette.ts from ' + input + '. Do not edit: change the inputs there and re-run.\n   Plain values and var() only, so web and React Native (NativeWind) can share this file. */');
        fs.writeFileSync(theme, css + (scheme === theme ? '\n\n' + buildSchemeCss(p) : '') + '\n'); console.log('wrote ' + theme + (scheme === theme ? ' (theme + scheme)' : ' (theme)'));
      }
      if (scheme && scheme !== theme) { fs.writeFileSync(scheme, buildSchemeCss(p) + '\n'); console.log('wrote ' + scheme + ' (scheme)'); }
      if (mobile && ns) {
        fs.writeFileSync(mobile, buildTailwindCss(p, ns, mobile === input ? buildWebCss(p, extras) : '') + '\n');
        console.log('wrote ' + mobile + (mobile === input ? ' (theme + tailwind)' : ' (tailwind)') + ', namespace ' + ns);
        namespacedNames(p, ns).warn.forEach(w => console.log('WARN  namespace: ' + w));
        if (extras.length) console.log('WARN  ' + extras.length + ' hand-authored tokens are in the theme, not in the Tailwind utilities: Tailwind\'s own theme holds that scale');
      }
      if (json) { fs.writeFileSync(json, buildJson(p) + '\n'); console.log('wrote ' + json + ' (json)'); }
      if (sass) { fs.writeFileSync(sass, buildSass(p, extras, input) + '\n'); console.log('wrote ' + sass + ' (sass, ' + extras.length + ' hand-authored)'); }
      if (toCard) { fs.writeFileSync(toCard, withCardInputs(read(toCard), toInputs(p), title, ns, Object.fromEntries(extras), overrides)); console.log('wrote inputs' + (extras.length ? ', ' + extras.length + ' tokens' : '') + (Object.keys(overrides).length ? ', ' + Object.keys(overrides).length + ' overrides' : '') + ' into ' + toCard); }
      const thumb = opt('--thumbnail');
      if (thumb) { fs.writeFileSync(thumb, buildThumbnail(p, title)); console.log('wrote ' + thumb + ' (thumbnail)'); }
      if (!theme && !scheme && !mobile && !json && !sass && !toCard && !thumb) console.log('nothing written: pass --web, --theme <file>, --scheme <file>, --mobile <file>, --json <file>, --sass <file>, --to-card <card> or --thumbnail <file>');
    }
    const r = report(p);
    console.log(r.text);
    if (has('--strict') && r.fails) process.exit(1);
  } catch (e) { fail((e as Error).message); }
}

export { readExtras, buildSass, namespacedNames, buildThumbnail, readThemeInputs, withInputs, fromInputs, toInputs, buildWebCss, buildSchemeCss, buildTailwindCss, buildJson, runAudit, diffInputs, withCardInputs, cardInputs, cardTokens, diffTokens, applyTokens, withTokens, overridable, overrideErrors, splitExtras, cardOverrides, diffOverrides, withOverrides };
