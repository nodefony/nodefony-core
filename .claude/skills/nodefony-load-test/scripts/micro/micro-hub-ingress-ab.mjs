/**
 * A/B de l'ENTRÉE DU BUS dans le hub temps réel (`RealtimeHub.#admitFromBackplane`) :
 * un message ORDINAIRE reçu d'un pair, sur un canal servi ici et diffusé, livré à
 * un abonné. C'est le coût payé par message, sur chaque pod, pour chaque
 * publication d'un autre pod.
 *
 *   node micro-hub-ingress-ab.mjs --a <dist avant> --b <dist après> [--runs 7]
 *
 * `--a`/`--b` = un dossier `dist` de `@nodefony/realtime` (copier le `dist` AVANT
 * de modifier). Un process par mesure, A et B ALTERNÉS, médiane et étendue par
 * scénario : 1 préfixe diffusé, puis 16 (le canal servi est le dernier — le pire
 * cas d'une boucle sur les préfixes). Le travail est prouvé : chaque message doit
 * avoir été livré, sinon la mesure est refusée.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ITER = 2_000_000;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

if (opt("child", null) !== null) {
  // ── Mesure dans un process neuf ──────────────────────────────────────────
  const dist = opt("child", "");
  const prefixes = Number(opt("prefixes", "1"));
  const { getRealtimeHub } = await import(
    pathToFileURL(path.join(dist, "index.js")).href
  );
  const hub = getRealtimeHub();
  hub.clear();
  let handler = null;
  hub.setBackplane({
    originId: "pod-a",
    start: () => {},
    stop: () => {},
    publish: () => {},
    onMessage: (h) => {
      handler = h;
    },
    describe: () => ({
      driver: "bench",
      kind: "memory",
      originId: "pod-a",
      crossPod: true,
    }),
  });
  for (let i = 0; i < prefixes - 1; i++) hub.markBroadcastChannel(`p${i}:`);
  hub.markBroadcastChannel("chat:");
  let delivered = 0;
  hub.subscribe(
    "chat:room",
    () => {
      delivered++;
    },
    () => () => {},
  );
  const msg = { channel: "chat:room", payload: { seq: 1 }, originId: "pod-b" };
  for (let i = 0; i < 200_000; i++) handler(msg); // chauffe
  delivered = 0;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < ITER; i++) handler(msg);
  const ns = Number(process.hrtime.bigint() - t0) / ITER;
  if (delivered !== ITER) {
    console.error(`livrés ${delivered}/${ITER}`);
    process.exit(3);
  }
  console.log(JSON.stringify({ ns }));
  process.exit(0);
}

// ── Parent : A et B alternés, médiane par scénario ─────────────────────────
const a = path.resolve(opt("a", ""));
const b = path.resolve(opt("b", ""));
const runs = Number(opt("runs", "7"));
const self = fileURLToPath(import.meta.url);
const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
for (const prefixes of [1, 16]) {
  const out = { A: [], B: [] };
  for (let r = 0; r < runs; r++) {
    for (const [label, dist] of r % 2 === 0
      ? [
          ["A", a],
          ["B", b],
        ]
      : [
          ["B", b],
          ["A", a],
        ]) {
      const res = spawnSync(
        process.execPath,
        [self, "--child", dist, "--prefixes", String(prefixes)],
        {
          encoding: "utf8",
        },
      );
      if (res.status !== 0) {
        console.error(res.stderr);
        process.exit(res.status ?? 1);
      }
      out[label].push(JSON.parse(res.stdout.trim()).ns);
    }
  }
  const mA = median(out.A);
  const mB = median(out.B);
  const span = (xs) =>
    `${Math.min(...xs).toFixed(1)}–${Math.max(...xs).toFixed(1)}`;
  console.log(
    `${String(prefixes).padStart(2)} préfixe(s) : A ${mA.toFixed(1)} ns [${span(out.A)}] · B ${mB.toFixed(1)} ns [${span(out.B)}] · ${(((mB - mA) / mA) * 100).toFixed(1)} %`,
  );
}
