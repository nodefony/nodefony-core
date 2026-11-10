/**
 * Micro-banc A/B — ce que coûte, PAR MESSAGE, le bus entre pods, dans le VRAI
 * `RedisBackplane` BÂTI, entre deux `dist` de `@nodefony/realtime` (avant / après
 * un diff de l'enveloppe, du sceau, de la file ou du tri d'entrée).
 *
 * Le transport est neutralisé (aucun Redis) : `publish` rend `void` (transport
 * synchrone, la file n'a rien à suivre) et l'abonnement retient le rappel du
 * driver, que le banc appelle lui-même avec des messages déjà scellés. Ce qu'on
 * mesure est donc le travail du pod, pas le réseau — le banc réseau est
 * `nodefony-multipod-bench/scripts/bus-bytes.mjs`.
 *
 * Six chemins, sujet texte (JSON) et sujet binaire (CBOR), bus SCELLÉ :
 *
 * - `seal-text` / `seal-cbor` : `publish` — encodage + sceau + file d'envoi ;
 * - `peer-text` / `peer-cbor` : un message d'un AUTRE pod reçu — ouverture, sceau
 *   vérifié, remis au handler ;
 * - `echo-text` / `echo-cbor` : l'ÉCHO de ce pod (le bus rend à l'émetteur ce
 *   qu'il publie — un message reçu sur deux sur un pod chargé), jamais remis.
 *
 * Trois charges : `tiny` (un lot de présence), `1k`, `16k` ; le sujet binaire y
 * ajoute 256 octets bruts (sinon la charge ne prendrait pas le sujet binaire).
 *
 * Protocole : un PROCESS par mesure (JIT frais), variantes ALTERNÉES A B A B…,
 * médiane de RUNS. Validité : le handler doit avoir reçu chaque message d'un pair
 * et AUCUN écho, la publication doit avoir atteint le transport — sinon exit 1,
 * aucun chiffre publié.
 *
 * Usage :
 *   node micro-backplane-envelope-ab.mjs --a <dist avant> --b <dist après> [--runs 7]
 *        [--paths seal-text,peer-text,echo-text,seal-cbor,peer-cbor,echo-cbor] [--sizes tiny,1k,16k]
 *   (un `dist` = le dossier `dist/` de @nodefony/realtime, ou sa copie : `cp -R dist <ailleurs>`
 *    AVANT de modifier, pour garder la version « avant »)
 * Mode enfant (interne) : --child <dist> <chemin> <taille>
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SECRET = "bench-secret-0123456789abcdef";
const ME = "pod-a.1234";
const PEER = "pod-b.5678";
const CHANNEL = "room:42";
/** Itérations par taille : le HMAC domine, 16 Ko coûte ~50 µs. */
const ITER = { tiny: 2e5, "1k": 1e5, "16k": 2e4 };

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};

if (args[0] === "--child") {
  await child(path.resolve(args[1]), args[2], args[3]);
} else {
  parent();
}

/** Charge de la taille demandée ; `bytes` ajoute des octets bruts (sujet binaire). */
function payloadOf(size, bytes) {
  const base = {
    tiny: { members: ["u1", 1, "u2", 2], seq: 41, prev: 40 },
    "1k": {
      list: Array.from({ length: 60 }, (_, i) => ({ id: `u${i}`, n: i })),
    },
    "16k": { text: "x".repeat(16_000), seq: 1 },
  }[size];
  if (base === undefined) throw new Error(`taille inconnue : ${size}`);
  return bytes ? { ...base, raw: new Uint8Array(256).fill(7) } : base;
}

/** Mesure UN chemin, UNE taille, sur UN dist ; imprime `ns/message` en JSON. */
async function child(dist, which, size) {
  const { RedisBackplane } = await import(
    pathToFileURL(path.join(dist, "nodefony/src/backplane/RedisBackplane.js"))
      .href
  );
  const env = await import(
    pathToFileURL(path.join(dist, "nodefony/src/backplane/envelope.js")).href
  );
  const { CBOR_FRAME_CODEC } = await import("nodefony/cbor");

  let published = 0;
  let onText = null;
  let onBytes = null;
  const transport = {
    publish() {
      published++;
    },
    subscribe(_c, cb) {
      onText = cb;
    },
    subscribeBytes(_c, cb) {
      onBytes = cb;
    },
    unsubscribe() {},
  };
  const bp = new RedisBackplane(
    transport,
    ME,
    "nodefony:realtime:bench",
    SECRET,
  );
  const binary = which.endsWith("-cbor");
  if (binary) bp.enableBytes(CBOR_FRAME_CODEC);
  await bp.start();
  let delivered = 0;
  bp.onMessage(() => {
    delivered++;
  });

  const payload = payloadOf(size, binary);
  const sealed = (originId) =>
    binary
      ? env.sealBackplaneEnvelopeBytes(
          { channel: CHANNEL, payload, originId },
          CBOR_FRAME_CODEC,
          SECRET,
        )
      : env.sealBackplaneEnvelope(
          { channel: CHANNEL, payload, originId },
          SECRET,
        );
  const fromPeer = sealed(PEER);
  const fromMe = sealed(ME);
  const receive = binary ? onBytes : onText;
  if (receive === null) throw new Error("abonnement non posé");

  const step = {
    seal: () => bp.publish(CHANNEL, payload),
    peer: () => receive(fromPeer),
    echo: () => receive(fromMe),
  }[which.split("-")[0]];
  if (step === undefined) throw new Error(`chemin inconnu : ${which}`);
  const n = ITER[size];
  const warm = n / 10;

  for (let i = 0; i < warm; i++) step();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) step();
  const ns = Number(process.hrtime.bigint() - t0) / n;

  // Validité : le chemin a réellement tourné, et l'écho n'a jamais été remis.
  const total = n + warm;
  const kind = which.split("-")[0];
  if (kind === "seal" && published !== total)
    fail(`publié ${published}/${total}`);
  if (kind === "peer" && delivered !== total)
    fail(`remis ${delivered}/${total}`);
  if (kind === "echo" && delivered !== 0)
    fail(`${delivered} échos remis au hub`);
  console.log(JSON.stringify({ ns }));
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function parent() {
  const a = opt("--a");
  const b = opt("--b");
  const runs = Number(opt("--runs", "7"));
  if (!a || !b) {
    console.error("usage : --a <dist avant> --b <dist après> [--runs 7]");
    process.exit(2);
  }
  const self = new URL(import.meta.url).pathname;
  const measure = (dist, which, size) => {
    const r = spawnSync(
      process.execPath,
      [self, "--child", dist, which, size],
      {
        encoding: "utf8",
      },
    );
    if (r.status !== 0) {
      console.error(`${which} ${size} (${dist}) :`, r.stderr || r.stdout);
      process.exit(1);
    }
    return JSON.parse(r.stdout.trim().split("\n").pop()).ns;
  };
  const median = (xs) => {
    const s = [...xs].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const rows = [];
  const paths = opt(
    "--paths",
    "seal-text,peer-text,echo-text,seal-cbor,peer-cbor,echo-cbor",
  ).split(",");
  for (const size of opt("--sizes", "tiny,1k,16k").split(",")) {
    for (const which of paths) {
      const A = [];
      const B = [];
      for (let i = 0; i < runs; i++) {
        A.push(measure(a, which, size));
        B.push(measure(b, which, size));
      }
      const ma = median(A);
      const mb = median(B);
      rows.push({
        charge: size,
        chemin: which,
        "A ns/msg": ma.toFixed(0),
        "B ns/msg": mb.toFixed(0),
        "écart %": (((mb - ma) / ma) * 100).toFixed(1),
        "A min–max": `${Math.min(...A).toFixed(0)}–${Math.max(...A).toFixed(0)}`,
        "B min–max": `${Math.min(...B).toFixed(0)}–${Math.max(...B).toFixed(0)}`,
      });
    }
  }
  console.table(rows);
}
