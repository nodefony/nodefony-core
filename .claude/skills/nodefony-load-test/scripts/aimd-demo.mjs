// aimd-demo — démonstration LISIBLE et déterministe de la cadence adaptative (AIMD).
//
// Pourquoi : l'AIMD est client-driven → dur à observer dans le navigateur. Ce script
// exerce la VRAIE lib (`bindAdaptiveChannel` du core, build dist) contre une socket MOCK
// avec une horloge contrôlée, et IMPRIME chaque changement de cadence : on VOIT la socket
// reculer sous famine (Multiplicative Decrease) puis remonter quand c'est sain (Additive
// Increase). Aucun serveur requis. Prérequis : core buildé (`cd src/nodefony && npm run build`).
//
// Usage : bash .claude/skills/nodefony-load-test/scripts/run.sh aimd
//     ou : node .claude/skills/nodefony-load-test/scripts/aimd-demo.mjs

import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const DIST = path.join(
  ROOT,
  "src/nodefony/dist/client/client/realtime/AdaptiveRate.js",
);

let bindAdaptiveChannel;
try {
  ({ bindAdaptiveChannel } = await import(DIST));
} catch (e) {
  console.error(
    `\n✖ Impossible de charger la lib AIMD buildée :\n  ${DIST}\n` +
      `  → build d'abord : cd src/nodefony && npm run build\n`,
  );
  process.exit(1);
}

// Socket MOCK : on observe les (ré)abonnements réseau émis par l'AIMD.
class MockSocket {
  #handlers = new Map();
  subscribe(ch) {
    console.log(`        ↳ subscribe   ${ch}`);
  }
  unsubscribe(ch) {
    console.log(`        ↳ unsubscribe ${ch}`);
  }
  on(ch, h) {
    if (!this.#handlers.has(ch)) this.#handlers.set(ch, new Set());
    this.#handlers.get(ch).add(h);
    return () => this.#handlers.get(ch)?.delete(h);
  }
  off(ch, h) {
    this.#handlers.get(ch)?.delete(h);
  }
  publish() {}
  async request() {}
  channel(name) {
    return {
      name,
      on: (h) => this.on(name, h),
      send: () => {},
      open: () => this.subscribe(name),
      close: () => this.unsubscribe(name),
    };
  }
  getStats() {
    return [];
  }
  getChannelStats() {}
  get subscribedChannels() {
    return [];
  }
  emit(ch, p) {
    for (const h of this.#handlers.get(ch) ?? []) h(p);
  }
}

const noop = { set: () => 0, clear: () => {} };
const sock = new MockSocket();
let t = 0;
const clock = () => t;

const binding = bindAdaptiveChannel(sock, "orm:health", () => {}, {
  intervalMs: 1000, // cadence DÉSIRÉE = plancher
  defaultMs: 5000,
  ladder: [1000, 2000, 4000, 8000, 16000],
  starvationFactor: 1.8,
  healthyFactor: 1.25,
  recoveryWindow: 3,
  clock,
  scheduler: noop,
  onRate: (ms, reason) =>
    console.log(
      `  [t=${String((t / 1000).toFixed(0)).padStart(3)}s]  CADENCE → ${String(ms).padStart(5)} ms   (${reason})`,
    ),
});

// Émet une frame `gap` ms après la précédente, sur le canal cadencé COURANT.
const frame = (gap) => {
  t += gap;
  sock.emit(binding.channel, {});
};

console.log(
  "\n=== AIMD — cadence adaptative (plancher 1s · échelle 1/2/4/8/16s) ===\n",
);

console.log("① RÉSEAU SAIN — frames pile à la cadence (1s). Reste à 1s.");
frame(0); // 1re frame (amorce)
for (let i = 0; i < 4; i++) frame(1000);

console.log(
  "\n② FAMINE (serveur saturé) — frames très en retard → MULTIPLICATIVE DECREASE :",
);
for (let i = 0; i < 5; i++) frame(40000); // gap énorme → recule d'un cran à chaque fois

console.log(
  `\n   → reculé jusqu'à ${binding.intervalMs / 1000}s : moins de pushes = serveur soulagé.`,
);

console.log(
  "\n③ REPRISE — serveur OK, frames pile à la cadence courante → ADDITIVE INCREASE (lente) :",
);
for (let i = 0; i < 24; i++) frame(binding.intervalMs); // sain → remonte 1 cran / fenêtre

console.log(
  `\n   → revenu à ${binding.intervalMs / 1000}s (cadence désirée). ✅ cycle AIMD complet.\n`,
);
binding.dispose();
