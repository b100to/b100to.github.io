// Renders a LinkedIn carousel from a post's cards.json.
//
// The earlier generator baked one post's copy into the script, so a second
// post meant editing the renderer. Here the layout lives in code and the words
// live next to the post they belong to:
//
//   node scripts/generate-cards.mjs content/posts/<slug>
//
// Slides are declared by type. Adding a post is writing JSON; adding a shape
// is adding a case here.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const SIZE = 1080;

const C = {
  bg: '#FFFFFF',
  bgAccent: '#F5F5F5',
  ink: '#111111',
  sub: '#444444',
  muted: '#9A9A9A',
  accent: '#2323AA',
  accentSoft: 'rgba(35,35,170,0.07)',
  accentLine: 'rgba(35,35,170,0.22)',
  rule: 'rgba(0,0,0,0.08)',
};

const postDir = process.argv[2];
if (!postDir) {
  console.error('usage: node scripts/generate-cards.mjs content/posts/<slug>');
  process.exit(1);
}
const deck = JSON.parse(readFileSync(join(postDir, 'cards.json'), 'utf8'));
const outDir = join(postDir, 'cards');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const fonts = await loadFonts();

let n = 0;
for (const slide of deck.slides) {
  const svg = await satori(build(slide, deck), { width: SIZE, height: SIZE, fonts });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: SIZE } }).render().asPng();
  const name = String(++n).padStart(2, '0') + '.png';
  writeFileSync(join(outDir, name), png);
  console.log(`${join(outDir, name)}  ${slide.type}`);
}
console.log(`\n${n} slides -> ${outDir}`);

// ─────────────────────────────────────────────────────────────────────────────

function build(slide, deck) {
  switch (slide.type) {
    case 'cover':     return cover(slide, deck);
    case 'statement': return statement(slide, deck);
    case 'list':      return list(slide, deck);
    case 'terminal':  return terminal(slide, deck);
    case 'image':     return image(slide, deck);
    case 'outro':     return outro(slide, deck);
    default: throw new Error(`unknown slide type: ${slide.type}`);
  }
}

// The frame every slide shares: generous padding, and a footer that keeps the
// author visible when a single slide gets screenshotted out of the deck.
function frame(children, { footer = true, deck } = {}) {
  return {
    type: 'div',
    props: {
      style: {
        width: SIZE, height: SIZE, display: 'flex', flexDirection: 'column',
        backgroundColor: C.bg,
        padding: 80, justifyContent: 'space-between',
        fontFamily: 'Noto Sans KR',
      },
      children: [
        { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }, children } },
        footer ? {
          type: 'div',
          props: {
            style: { display: 'flex', justifyContent: 'space-between', fontSize: 22, color: C.muted },
            children: [
              { type: 'div', props: { children: deck.author } },
              { type: 'div', props: { children: deck.handle } },
            ],
          },
        } : { type: 'div', props: { children: '' } },
      ],
    },
  };
}

function badge(text) {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex', alignSelf: 'flex-start', marginBottom: 40,
        padding: '14px 30px', borderRadius: 999, fontSize: 26, fontWeight: 700,
        color: C.accent,
        backgroundColor: C.accentSoft,
        border: `2px solid ${C.accentLine}`,
      },
      children: text,
    },
  };
}

function cover(s, deck) {
  return frame([
    badge(s.badge),
    { type: 'div', props: { style: { fontSize: 78, fontWeight: 700, lineHeight: 1.3, color: C.ink, whiteSpace: 'pre-wrap' }, children: s.title } },
    { type: 'div', props: { style: { marginTop: 34, fontSize: 32, lineHeight: 1.6, color: C.sub }, children: s.subtitle } },
  ], { deck });
}

// One sentence, set large. For the claim a slide exists to make.
function statement(s, deck) {
  return frame([
    s.badge ? badge(s.badge) : { type: 'div', props: { children: '' } },
    { type: 'div', props: { style: { fontSize: 58, fontWeight: 700, lineHeight: 1.45, color: C.ink, whiteSpace: 'pre-wrap' }, children: s.text } },
    s.note ? { type: 'div', props: { style: { marginTop: 42, paddingLeft: 28, borderLeft: `6px solid ${C.accentLine}`, fontSize: 30, lineHeight: 1.6, color: C.sub, whiteSpace: 'pre-wrap' }, children: s.note } } : { type: 'div', props: { children: '' } },
  ], { deck });
}

function list(s, deck) {
  return frame([
    s.badge ? badge(s.badge) : { type: 'div', props: { children: '' } },
    { type: 'div', props: { style: { fontSize: 52, fontWeight: 700, lineHeight: 1.4, color: C.ink, marginBottom: 46, whiteSpace: 'pre-wrap' }, children: s.title } },
    {
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'column', gap: 30 },
        children: s.items.map((item) => ({
          type: 'div',
          props: {
            style: { display: 'flex', alignItems: 'flex-start', gap: 20 },
            children: [
              { type: 'div', props: { style: { display: 'flex', marginTop: 15, width: 13, height: 13, borderRadius: 999, backgroundColor: C.accent, flexShrink: 0 }, children: '' } },
              { type: 'div', props: { style: { fontSize: 32, lineHeight: 1.6, color: C.sub, whiteSpace: 'pre-wrap' }, children: item } },
            ],
          },
        })),
      },
    },
  ], { deck });
}

// Real output, set as type rather than pasted as a screenshot — a terminal
// capture stops being readable once a phone scales it down.
//
// The card stays white like the rest of the deck. A single dark slide in a
// light carousel reads as an accident rather than emphasis.
function terminal(s, deck) {
  return frame([
    s.badge ? badge(s.badge) : { type: 'div', props: { children: '' } },
    s.title ? { type: 'div', props: { style: { fontSize: 46, fontWeight: 700, color: C.ink, marginBottom: 38, lineHeight: 1.35, whiteSpace: 'pre-wrap' }, children: s.title } } : { type: 'div', props: { children: '' } },
    {
      type: 'div',
      props: {
        style: {
          display: 'flex', padding: 38, borderRadius: 18,
          backgroundColor: C.bgAccent,
          border: `2px solid ${C.rule}`,
          fontSize: 24, lineHeight: 1.8, color: C.ink,
          fontFamily: 'JetBrains Mono', whiteSpace: 'pre-wrap',
        },
        children: s.body,
      },
    },
    s.note ? { type: 'div', props: { style: { marginTop: 36, marginBottom: 20, fontSize: 30, lineHeight: 1.6, color: C.sub, whiteSpace: 'pre-wrap' }, children: s.note } } : { type: 'div', props: { children: '' } },
  ], { deck });
}

// A screenshot slide. The image is scaled to fit the space left over after the
// badge, title and caption, so a tall phone capture and a wide terminal shot
// both land inside the card without being cropped or squashed.
function image(s, deck) {
  const src = join(postDir, s.src);
  const { width: iw, height: ih } = pngSize(readFileSync(src));

  const boxW = SIZE - 160;
  const boxH = 620 - (s.title ? 90 : 0) - (s.caption ? 90 : 0);
  const scale = Math.min(boxW / iw, boxH / ih);

  return frame([
    s.badge ? badge(s.badge) : { type: 'div', props: { children: '' } },
    s.title ? { type: 'div', props: { style: { fontSize: 52, fontWeight: 700, lineHeight: 1.4, color: C.ink, marginBottom: 36, whiteSpace: 'pre-wrap' }, children: s.title } } : { type: 'div', props: { children: '' } },
    {
      type: 'div',
      props: {
        style: { display: 'flex', justifyContent: 'center' },
        children: {
          type: 'img',
          props: {
            src: `data:image/png;base64,${readFileSync(src).toString('base64')}`,
            width: Math.round(iw * scale),
            height: Math.round(ih * scale),
            style: { borderRadius: 16, border: `2px solid ${C.rule}` },
          },
        },
      },
    },
    s.caption ? { type: 'div', props: { style: { marginTop: 34, fontSize: 30, lineHeight: 1.6, color: C.sub, whiteSpace: 'pre-wrap' }, children: s.caption } } : { type: 'div', props: { children: '' } },
  ], { deck });
}

// Intrinsic size from the PNG header, so the caller does not have to declare it.
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function outro(s, deck) {
  return frame([
    { type: 'div', props: { style: { fontSize: 58, fontWeight: 700, lineHeight: 1.42, color: C.ink, whiteSpace: 'pre-wrap' }, children: s.title } },
    { type: 'div', props: { style: { marginTop: 40, fontSize: 30, lineHeight: 1.7, color: C.sub, whiteSpace: 'pre-wrap' }, children: s.text } },
    { type: 'div', props: { style: { marginTop: 48, paddingTop: 36, borderTop: `3px solid ${C.rule}`, fontSize: 28, color: C.accent, whiteSpace: 'pre-wrap' }, children: s.links } },
  ], { deck });
}

// The earlier deck loaded a single 700 weight, which is what gives those cards
// their uniform density. Matching it keeps a reader's feed consistent.
async function loadFonts() {
  const grab = (url) => fetch(url).then((r) => r.arrayBuffer());
  const [kr, mono] = await Promise.all([
    grab('https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-kr@latest/korean-700-normal.woff'),
    grab('https://cdn.jsdelivr.net/fontsource/fonts/jetbrains-mono@latest/latin-400-normal.woff'),
  ]);
  return [
    { name: 'Noto Sans KR', data: kr, weight: 700, style: 'normal' },
    { name: 'JetBrains Mono', data: mono, weight: 400, style: 'normal' },
  ];
}
