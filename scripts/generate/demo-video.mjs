#!/usr/bin/env node
/**
 * Fabrique la vidéo d'essai de la démo « Vidéo par plages » (#747) :
 * `src/nodefony/assets/demo-video.mp4`, que `create app --demo` copie dans
 * `media/` du module de démo (`renderDemoLayer`, moteur du scaffold).
 *
 * Pourquoi une vidéo FABRIQUÉE plutôt qu'un extrait de film : elle n'a pas de
 * licence à porter, elle pèse quelques dizaines de kilo-octets dans le paquet
 * publié, et chaque image MONTRE son instant — un minuteur et une barre de
 * progression — si bien qu'un saut dans le lecteur se voit, au dixième près.
 *
 * Les images sont dessinées ici, en Node pur (PPM brut : un en-tête et des
 * pixels), puis encodées par ffmpeg — requis pour REGÉNÉRER seulement : le
 * fichier produit est versionné, et ni le dépôt ni une application n'ont
 * besoin de ffmpeg pour s'en servir.
 *
 * @usage node scripts/generate/demo-video.mjs
 *
 * Réglages qui comptent pour la leçon :
 * - une image-clé par seconde (`-g`) : un saut tombe sur une seconde ronde
 *   sans décoder ce qui précède ;
 * - `+faststart` : l'index (`moov`) est placé AVANT les images (`mdat`) — le
 *   lecteur sait où est chaque instant dès les premiers octets reçus. Le test
 *   de la démo le vérifie sur le fichier copié.
 *
 * Usage : `node scripts/generate/demo-video.mjs`
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const OUT = path.join(ROOT, "src", "nodefony", "assets", "demo-video.mp4");

const WIDTH = 640;
const HEIGHT = 360;
const FPS = 15;
const SECONDS = 30;

// Palette de la démo (`demo.css`, thème sombre) et du logo.
const BG = [0x0a, 0x0f, 0x1c];
const TRACK = [0x1b, 0x27, 0x40];
const BLUE = [0x00, 0xa0, 0xf2];
const GREEN = [0x44, 0x84, 0x38];
const DIGIT = [0xe6, 0xed, 0xf7];
const DIM = [0x3a, 0x4a, 0x66];
const OFF = [0x13, 0x1b, 0x2d];

/**
 * Segments allumés par chiffre, dans l'ordre a b c d e f g (afficheur à sept
 * segments : a en haut, puis dans le sens horaire, g au milieu).
 */
const SEGMENTS = [
  "abcdef",
  "bc",
  "abdeg",
  "abcdg",
  "bcfg",
  "acdfg",
  "acdefg",
  "abc",
  "abcdefg",
  "abcdfg",
];

const frame = Buffer.alloc(WIDTH * HEIGHT * 3);

/** Remplit un rectangle, borné à l'image. */
function rect(x, y, w, h, [r, g, b]) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(WIDTH, Math.round(x + w));
  const y1 = Math.min(HEIGHT, Math.round(y + h));
  for (let py = y0; py < y1; py += 1) {
    let offset = (py * WIDTH + x0) * 3;
    for (let px = x0; px < x1; px += 1) {
      frame[offset] = r;
      frame[offset + 1] = g;
      frame[offset + 2] = b;
      offset += 3;
    }
  }
}

/** Un chiffre à sept segments, coin haut-gauche en (x, y). */
function digit(value, x, y, w, h, t) {
  const on = SEGMENTS[value] ?? "";
  const half = (h - t) / 2;
  const parts = {
    a: [x + t, y, w - 2 * t, t],
    b: [x + w - t, y + t, t, half - t],
    c: [x + w - t, y + half + t, t, half - t],
    d: [x + t, y + h - t, w - 2 * t, t],
    e: [x, y + half + t, t, half - t],
    f: [x, y + t, t, half - t],
    g: [x + t, y + half, w - 2 * t, t],
  };
  for (const [name, box] of Object.entries(parts)) {
    rect(...box, on.includes(name) ? DIGIT : OFF);
  }
}

/** Dessine l'image de l'instant `ms`. */
function draw(ms) {
  rect(0, 0, WIDTH, HEIGHT, BG);
  const tenths = Math.floor(ms / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor(tenths / 10) % 60;
  const glyphs = [
    minutes,
    ":",
    Math.floor(seconds / 10),
    seconds % 10,
    ".",
    tenths % 10,
  ];
  const w = 64;
  const h = 120;
  const t = 13;
  const gap = 16;
  const sep = 22;
  const total = glyphs.reduce(
    (sum, glyph) => sum + (typeof glyph === "number" ? w : sep) + gap,
    -gap,
  );
  let x = (WIDTH - total) / 2;
  const y = 80;
  for (const glyph of glyphs) {
    if (glyph === ":") {
      rect(x + (sep - t) / 2, y + h * 0.28, t, t, DIGIT);
      rect(x + (sep - t) / 2, y + h * 0.66, t, t, DIGIT);
      x += sep + gap;
    } else if (glyph === ".") {
      rect(x + (sep - t) / 2, y + h - t, t, t, BLUE);
      x += sep + gap;
    } else {
      digit(glyph, x, y, w, h, t);
      x += w + gap;
    }
  }
  // La barre : un repère par seconde, plus haut toutes les cinq.
  const left = 40;
  const width = WIDTH - 2 * left;
  const bar = 270;
  for (let s = 0; s <= SECONDS; s += 1) {
    const tick = s % 5 === 0 ? 16 : 8;
    rect(left + (width * s) / SECONDS - 1, bar - tick - 6, 2, tick, DIM);
  }
  rect(left, bar, width, 10, TRACK);
  const done = (width * ms) / (SECONDS * 1000);
  rect(left, bar, done, 10, GREEN);
  rect(left + done - 7, bar - 5, 14, 20, BLUE);
}

const ffmpeg = spawn(
  "ffmpeg",
  [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "image2pipe",
    "-c:v",
    "ppm",
    "-framerate",
    String(FPS),
    "-i",
    "-",
    "-c:v",
    "libx264",
    "-preset",
    "veryslow",
    "-tune",
    "animation",
    "-crf",
    "34",
    "-g",
    String(FPS),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    OUT,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);
ffmpeg.on("error", (error) => {
  console.error(`ffmpeg introuvable : ${error.message}`);
  process.exit(69);
});
const header = Buffer.from(`P6\n${WIDTH} ${HEIGHT}\n255\n`);
for (let index = 0; index < FPS * SECONDS; index += 1) {
  draw((index * 1000) / FPS);
  const ok = ffmpeg.stdin.write(Buffer.concat([header, frame]));
  if (!ok) await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
}
ffmpeg.stdin.end();
ffmpeg.on("close", (code) => {
  if (code !== 0) process.exit(code ?? 1);
  console.log(`écrit : ${path.relative(ROOT, OUT)}`);
});
