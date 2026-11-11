/**
 * Micro-banc de la présence répartie (#760, ADR-0025 § « Budgets — critères de
 * fin ») — le code PUBLIÉ : le `dist` de `@nodefony/realtime`, et la vue du
 * cœur (`nodefony`) que lit le navigateur.
 *
 * Trois familles, trois natures de preuve :
 *
 * - TEMPS (ns, un process par mesure, variantes alternées, médiane, REFUS
 *   au-delà de 3 % de dispersion) :
 *   - `change-local`  : un changement (arrivée ou départ) d'un canal à présence
 *     NON diffusé de 1 000 membres, trame de changements comprise ;
 *   - `change-bus`    : le même sur un canal DIFFUSÉ (part locale + entrée du lot) ;
 *   - `list-1000`     : la liste de 1 000 membres construite puis encodée (texte),
 *     ce que paie un abonné qui (re)demande la liste ;
 *   - `apply-change`  : `PresenceView.apply` d'un changement sur une vue de 1 000 ;
 *   - `apply-change-listened` : le même avec un écouteur qui lit l'instantané à
 *     chaque trame (`observePresence`, les quatre liaisons) — l'instantané partage
 *     la `Map`, le changement suivant la recopie ;
 *   - `apply-list`    : `PresenceView.apply` d'une liste de 1 000 (resynchronisation).
 * - OCTETS (déterministes, calculés DEUX fois et comparés) :
 *   - `alive-bytes`   : preuve de vie scellée par le vrai sceau, `originId` de
 *     48 caractères — budget ≤ 280 o au pire, finale comprise ;
 *   - `client-bytes`  : S-rt-87 — 1 000 membres, 30 arrivées ou départs par
 *     seconde, identifiants de 36 caractères, fenêtre de 250 ms, 60 s simulées ;
 *     trame JSON-RPC texte telle que le hub l'émet, chaque trame relue par le
 *     lecteur et la vue du cœur — budget ≤ 2 Ko/s ; puis la même au-delà du
 *     seuil (nombres seuls).
 * - MÉMOIRE (tas après GC forcé) :
 *   - `remote-memory` : octets par présent DISTANT — deux hubs sur un bus en
 *     mémoire au vrai sceau, 100 000 présents tenus par A. Différentielle entre
 *     deux process : B sert le canal, ou ne le sert pas ; A, le bus et B
 *     s'annulent, reste la vue distante. Budget ≤ 160 o sans état ; « avec
 *     état » n'est pas mesurable en 10.0 (ADR-0025 P4 : aucun état ne se pose).
 *
 * Validité : chaque mesure prouve que son travail a eu lieu (trames non nulles,
 * issue `applied`, longueur de liste, présents vus par B) — sinon exit 1, aucun
 * chiffre. Une dispersion > 3 % : exit 3, la ligne est marquée REFUSÉE.
 *
 * Usage (depuis la racine du dépôt, `dist` bâti) :
 *   node .claude/skills/nodefony-load-test/scripts/micro/micro-presence.mjs \
 *        [--a <dist realtime>] [--b <dist realtime>] [--runs 7] [--mem-runs 3]
 *        [--only change-local,list-1000,…]
 *   `--a` vaut par défaut `src/packages/@nodefony/realtime/dist`. `--b` donné :
 *   A/B alterné (A B A B…). La vue du navigateur vient du cœur installé, la même
 *   pour A et B.
 * Mode enfant (interne) : --child <dist> <mesure> [arg]
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Itérations par mesure (≈ 1 s chacune) ; l'échauffement en vaut le dixième. */
const N = {
  "change-local": 5e6,
  "change-bus": 3e6,
  "change-toggle": 1e6,
  "list-1000": 6e4,
  "apply-change": 3e6,
  "apply-change-listened": 4e4,
  "apply-list": 4e4,
};

/**
 * Identités absentes, en anneau : chaque arrivée prend la plus ancienne partie —
 * des identités DISTINCTES, sans réservoir de millions de clés (la fenêtre de
 * mesure s'allonge sans que le tas grossisse).
 */
class AbsentRing {
  constructor(from, size) {
    this.keys = Array.from({ length: size }, (_, i) => idOf(from + i));
    this.head = 0;
  }
  /** Rend la plus ancienne absente et range `gone` à sa place. */
  swap(gone) {
    const come = this.keys[this.head];
    this.keys[this.head] = gone;
    this.head = this.head + 1 === this.keys.length ? 0 : this.head + 1;
    return come;
  }
}
const MEMBERS = 1000;
const CHANNEL = "room:bench";
const REMOTE_PRESENTS = 100_000;
const MAX_DISPERSION = 0.03;
const TIMED = [
  "change-local",
  "change-bus",
  "change-toggle",
  "list-1000",
  "apply-change",
  "apply-change-listened",
  "apply-list",
];
const BYTES = ["alive-bytes", "client-bytes"];

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};

/** Identifiant de 36 caractères (forme d'un UUID), déterministe. */
const idOf = (i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`;

if (args[0] === "--child") {
  await child(path.resolve(args[1]), args[2], args[3]);
} else {
  parent();
}

/** Charge les briques du `dist` realtime et du cœur. */
async function load(dist) {
  await import("reflect-metadata");
  const at = (rel) => import(pathToFileURL(path.join(dist, rel)).href);
  const presence = await at("nodefony/src/server/channelPresence.js");
  const core = await import("nodefony");
  return { at, presence, core };
}

/** Trame JSON-RPC texte de présence, comme le hub l'émet. */
function encode(core, params) {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: core.REALTIME_PRESENCE_METHOD,
    params,
  });
}

/** Mesure UNE grandeur sur UN dist, imprime son résultat en JSON. */
async function child(dist, which, arg) {
  const { at, presence, core } = await load(dist);
  const { ChannelPresence, presenceSettingsOf } = presence;
  const settings = (value) => presenceSettingsOf({ presence: value });

  /**
   * Canal à présence peuplé de `MEMBERS - 1` identités, première trame consommée :
   * l'arrivant des mesures fait les 1 000 SANS franchir le seuil par défaut
   * (`maxNamed` = 1 000) — le franchir reconstruirait la liste à chaque retour.
   */
  const populated = (distributed, value = true) => {
    const cp = new ChannelPresence(CHANNEL, settings(value), distributed);
    for (let i = 0; i < MEMBERS - 1; i++) cp.join(idOf(i));
    cp.takeChanges();
    if (distributed) cp.takeBusDelta();
    return cp;
  };

  const n = N[which] ?? 0;
  const WARM = Math.floor(n / 10);
  const timed = (step) => {
    for (let i = 0; i < WARM; i++) step(i);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) step(i);
    return Number(process.hrtime.bigint() - t0) / n;
  };
  const fail = (message) => {
    console.error(`${which} : ${message}`);
    process.exit(1);
  };

  switch (which) {
    case "change-local":
    case "change-bus":
    case "change-toggle": {
      const bus = which === "change-bus";
      const toggle = which === "change-toggle";
      const cp = populated(bus);
      // Motif d'un salon : un présent part, un AUTRE arrive (identités neuves,
      // pré-construites hors mesure). `change-toggle` : la MÊME identité part et
      // revient (onglet en boucle de reconnexion).
      const present = Array.from({ length: MEMBERS - 1 }, (_, i) => idOf(i));
      const fresh = toggle ? null : new AbsentRing(MEMBERS, 3 * MEMBERS);
      const mover = idOf(MEMBERS - 1);
      let frames = 0;
      let deltas = 0;
      // Une itération = un départ puis une arrivée : deux changements.
      const ns = timed((i) => {
        let gone = mover;
        let come = mover;
        if (fresh !== null) {
          const j = (i * 7919) % present.length;
          gone = present[j];
          come = fresh.swap(gone);
          present[j] = come;
        } else {
          cp.join(mover);
          if (cp.takeChanges() !== null) frames++;
          if (bus && cp.takeBusDelta() !== null) deltas++;
        }
        cp.leave(gone, i);
        if (cp.takeChanges() !== null) frames++;
        if (bus && cp.takeBusDelta() !== null) deltas++;
        if (fresh !== null) {
          cp.join(come);
          if (cp.takeChanges() !== null) frames++;
          if (bus && cp.takeBusDelta() !== null) deltas++;
        }
      });
      const expected = 2 * (n + WARM);
      if (frames !== expected) fail(`${frames} trames pour ${expected}`);
      if (bus && deltas !== expected) fail(`${deltas} lots pour ${expected}`);
      console.log(JSON.stringify({ value: ns / 2 }));
      return;
    }
    case "list-1000": {
      const cp = populated(false);
      let length = 0;
      const ns = timed(() => {
        length = encode(core, cp.listParams()).length;
      });
      if (length < (MEMBERS - 1) * 36) fail(`liste de ${length} caractères`);
      console.log(JSON.stringify({ value: ns }));
      return;
    }
    case "apply-change":
    case "apply-change-listened":
    case "apply-list": {
      const cp = populated(false);
      const list = cp.listParams();
      const view = new core.PresenceView(CHANNEL);
      if (view.apply(list) !== "applied") fail("liste initiale refusée");
      const listened = which === "apply-change-listened";
      const present = Array.from({ length: MEMBERS - 1 }, (_, i) => idOf(i));
      const fresh =
        which === "apply-list" ? null : new AbsentRing(MEMBERS, 3 * MEMBERS);
      let version = list.version;
      let applied = 0;
      let seen = 0;
      const step =
        which === "apply-list"
          ? () => {
              if (view.apply(list) === "applied") applied++;
            }
          : (i) => {
              // Une trame = un départ et une arrivée (deux identités distinctes).
              version += 1;
              const j = (i * 7919) % present.length;
              const gone = present[j];
              const come = fresh.swap(gone);
              const frame = {
                channel: CHANNEL,
                version,
                count: MEMBERS - 1,
                unnamed: 0,
                changes: { set: [come, 1], gone: [gone] },
              };
              present[j] = come;
              if (view.apply(frame) === "applied") applied++;
              if (listened) seen += view.snapshot().members.size;
            };
      const ns = timed(step);
      if (applied !== n + WARM)
        fail(`${applied} trames appliquées pour ${n + WARM}`);
      if (listened && seen < (n + WARM) * (MEMBERS - 1))
        fail("instantanés non lus");
      console.log(JSON.stringify({ value: ns }));
      return;
    }
    case "alive-bytes": {
      const { sealBackplaneEnvelope } = await at(
        "nodefony/src/backplane/envelope.js",
      );
      const originId = "o".repeat(48);
      const secret = "s".repeat(32);
      // Valeurs au pire de leur longueur : incarnation au plafond des entiers sûrs,
      // `seq`/`last` à dix chiffres.
      const incarnation = Number.MAX_SAFE_INTEGER;
      const body = {
        incarnation,
        seq: 9_999_999_999,
        last: 9_999_999_999,
        interval: 5000,
      };
      const seal = (payload) =>
        Buffer.byteLength(
          sealBackplaneEnvelope(
            {
              channel: core.PLATFORM_BUS_CHANNELS.presenceAlive,
              payload,
              originId,
            },
            secret,
          ),
        );
      console.log(
        JSON.stringify({
          value: Math.max(seal(body), seal({ ...body, final: true })),
          regular: seal(body),
          final: seal({ ...body, final: true }),
        }),
      );
      return;
    }
    case "client-bytes": {
      // 60 s simulées, fenêtre de 250 ms, 30 arrivées ou départs par seconde.
      // `named` : sous le seuil ; `count` : nettement au-dessus (nombres seuls) ;
      // `edge` : le salon oscille AUTOUR du seuil (999 ↔ 1 000).
      const maxNamed =
        arg === "count" ? 900 : arg === "edge" ? MEMBERS - 1 : MEMBERS;
      const cp = new ChannelPresence(CHANNEL, settings({ maxNamed }), false);
      for (let i = 0; i < MEMBERS; i++) cp.join(idOf(i));
      // L'abonné reçoit la liste à l'abonnement, puis les changements numérotés.
      const view = new core.PresenceView(CHANNEL);
      if (view.apply(cp.listParams()) !== "applied") fail("liste initiale");
      const pending = cp.takeChanges();
      if (pending !== null && view.apply(pending) !== "applied")
        fail("premier changement");
      const present = Array.from({ length: MEMBERS }, (_, i) => idOf(i));
      let next = MEMBERS;
      let cursor = 0;
      let bytes = 0;
      let frames = 0;
      let owed = 0;
      const SECONDS = 60;
      const WINDOW_MS = presence.PRESENCE_WINDOW_MS;
      for (let w = 0; w < (SECONDS * 1000) / WINDOW_MS; w++) {
        owed += (30 * WINDOW_MS) / 1000;
        for (; owed >= 1; owed -= 1) {
          // Alternance départ / arrivée : le salon reste à ~1 000.
          if ((cursor & 1) === 0) {
            const k = (cursor * 7919) % present.length;
            cp.leave(present[k], w * WINDOW_MS);
            present[k] = present[present.length - 1];
            present.pop();
          } else {
            const id = idOf(next++);
            present.push(id);
            cp.join(id);
          }
          cursor++;
        }
        const frame = cp.takeChanges();
        if (frame === null) continue;
        const text = encode(core, frame);
        const params = JSON.parse(text).params;
        if (!core.isPresenceFrame(params))
          fail(`trame illisible : ${text.slice(0, 120)}`);
        if (view.apply(params) !== "applied") fail("trame non appliquée");
        bytes += Buffer.byteLength(text);
        frames++;
      }
      if (view.snapshot().count !== cp.listParams().count)
        fail("vue divergente");
      console.log(
        JSON.stringify({
          value: bytes / SECONDS,
          framesPerSecond: frames / SECONDS,
        }),
      );
      return;
    }
    case "remote-memory": {
      console.log(
        JSON.stringify({ value: await remoteHeap(at, core, arg === "serve") }),
      );
      process.exit(0);
    }
    default:
      fail("mesure inconnue");
  }
}

/**
 * Tas (octets, après GC forcé) d'un process qui tient deux hubs reliés par un
 * bus en mémoire au vrai sceau, A portant `REMOTE_PRESENTS` présents. `serve` :
 * B sert le canal (il tient la vue distante) ; sinon B sert un autre canal.
 */
async function remoteHeap(at, core, serve) {
  if (typeof globalThis.gc !== "function")
    throw new Error("--expose-gc requis");
  const { RealtimeHub } = await at("nodefony/src/server/RealtimeHub.js");
  const { RealtimeConnection } = await at(
    "nodefony/src/server/RealtimeConnection.js",
  );
  const { sealBackplaneEnvelope, openBackplaneEnvelope } = await at(
    "nodefony/src/backplane/envelope.js",
  );
  const secret = "s".repeat(32);
  const handlers = new Map();
  let lastWork = Date.now();
  const peer = (originId) => ({
    originId,
    start() {},
    stop() {
      handlers.delete(originId);
    },
    publish(channel, payload) {
      if (channel !== core.PLATFORM_BUS_CHANNELS.presenceAlive)
        lastWork = Date.now();
      const raw = sealBackplaneEnvelope({ channel, payload, originId }, secret);
      for (const [id, handler] of handlers) {
        if (id === originId) continue;
        queueMicrotask(() => {
          const msg = openBackplaneEnvelope(raw, secret);
          if (msg !== null) handler(msg);
        });
      }
    },
    onMessage(handler) {
      handlers.set(originId, handler);
    },
    describe() {
      return { driver: "bench-net", kind: "memory", originId, crossPod: true };
    },
  });
  const hub = (id) => {
    const h = new RealtimeHub();
    h.declareChannelPolicy("room:*", { presence: true }, null);
    h.markBroadcastChannel("room:");
    h.setBackplane(peer(id));
    return h;
  };
  /** Une connexion nommée abonnée, sans émission (seul l'état compte). */
  const keep = [];
  const connect = (h, channel, user) => {
    const conn = new RealtimeConnection(
      { impose() {}, end: () => false, send() {} },
      () => ({
        type: "test",
        authenticated: true,
        id: user,
        userIdentifier: user,
        roles: [],
        scopes: [],
        issuer: null,
        account: true,
      }),
    );
    const sink = () => {};
    if (!h.subscribeClient(channel, sink, () => () => {}, undefined, conn))
      throw new Error(`abonnement refusé : ${channel}`);
    h.presenceSubscribed(channel, conn);
    keep.push(conn, sink);
  };
  const a = hub("bench-pod-a");
  const b = hub("bench-pod-b");
  connect(b, serve ? CHANNEL : "room:other", "observer");
  for (let i = 0; i < REMOTE_PRESENTS; i++) connect(a, CHANNEL, idOf(i));
  // Attendre que le bus se taise (preuves de vie exceptées).
  for (;;) {
    await new Promise((r) => setTimeout(r, 100));
    if (Date.now() - lastWork > 600) break;
  }
  if (serve) {
    const seen = b.presence(CHANNEL)?.count ?? -1;
    if (seen !== REMOTE_PRESENTS + 1)
      throw new Error(
        `B voit ${seen} présents au lieu de ${REMOTE_PRESENTS + 1}`,
      );
  }
  for (let i = 0; i < 4; i++) globalThis.gc();
  const heap = process.memoryUsage().heapUsed;
  // Tenir tout vivant jusqu'à la lecture.
  if (keep.length === 0 || a === b) throw new Error("décor perdu");
  return heap;
}

function parent() {
  const a = path.resolve(opt("--a", "src/packages/@nodefony/realtime/dist"));
  const bArg = opt("--b");
  const b = bArg === undefined ? null : path.resolve(bArg);
  const runs = Number(opt("--runs", "7"));
  const memRuns = Number(opt("--mem-runs", "3"));
  const only = opt("--only");
  const wanted = (name) => only === undefined || only.split(",").includes(name);
  const self = new URL(import.meta.url).pathname;
  const measure = (dist, which, arg, gc = false) => {
    const r = spawnSync(
      process.execPath,
      [...(gc ? ["--expose-gc"] : []), self, "--child", dist, which, arg ?? ""],
      { encoding: "utf8", maxBuffer: 1 << 24 },
    );
    if (r.status !== 0) {
      console.error(r.stderr || r.stdout);
      process.exit(1);
    }
    return JSON.parse(r.stdout.trim().split("\n").pop());
  };
  const median = (xs) => {
    const s = [...xs].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const spread = (xs) => (Math.max(...xs) - Math.min(...xs)) / median(xs);
  const camps =
    b === null
      ? [["A", a]]
      : [
          ["A", a],
          ["B", b],
        ];
  let refused = false;

  // TEMPS — variantes alternées, médiane, refus au-delà de 3 %.
  const timeRows = [];
  for (const which of TIMED.filter(wanted)) {
    const series = Object.fromEntries(camps.map(([k]) => [k, []]));
    for (let i = 0; i < runs; i++)
      for (const [k, dist] of camps) series[k].push(measure(dist, which).value);
    const row = { mesure: which };
    for (const [k] of camps) {
      const xs = series[k];
      const d = spread(xs);
      row[`${k} ns`] = median(xs).toFixed(1);
      row[`${k} dispersion`] =
        `${(d * 100).toFixed(1)} %${d > MAX_DISPERSION ? " REFUSÉ" : ""}`;
      if (d > MAX_DISPERSION) refused = true;
    }
    if (b !== null)
      row["écart %"] = (
        ((median(series.B) - median(series.A)) / median(series.A)) *
        100
      ).toFixed(1);
    timeRows.push(row);
  }
  if (timeRows.length > 0) {
    console.log("TEMPS (un process par mesure, médiane)");
    console.table(timeRows);
  }

  // OCTETS — déterministes : deux calculs identiques exigés.
  const byteRows = [];
  const bytes = (which, arg, label, budget, unit) => {
    for (const [k, dist] of camps) {
      const one = measure(dist, which, arg);
      const two = measure(dist, which, arg);
      if (JSON.stringify(one) !== JSON.stringify(two)) {
        console.error(
          `${which} : deux calculs différents — ${JSON.stringify([one, two])}`,
        );
        process.exit(1);
      }
      byteRows.push({
        camp: k,
        mesure: label,
        valeur: `${one.value.toFixed(0)} ${unit}`,
        détail:
          one.final !== undefined
            ? `courante ${one.regular} o, finale ${one.final} o`
            : one.framesPerSecond !== undefined
              ? `${one.framesPerSecond.toFixed(2)} trames/s`
              : "",
        budget: budget === null ? "—" : `≤ ${budget} ${unit}`,
        verdict:
          budget === null ? "—" : one.value <= budget ? "tenu" : "DÉPASSÉ",
      });
    }
  };
  if (wanted("alive-bytes"))
    bytes("alive-bytes", "", "preuve de vie scellée (pire des deux)", 280, "o");
  if (wanted("client-bytes")) {
    bytes(
      "client-bytes",
      "named",
      "S-rt-87 par client (liste nommée)",
      2048,
      "o/s",
    );
    bytes(
      "client-bytes",
      "count",
      "S-rt-87 par client (nombres seuls)",
      null,
      "o/s",
    );
    bytes(
      "client-bytes",
      "edge",
      "S-rt-87 par client (salon AU seuil)",
      null,
      "o/s",
    );
  }
  if (byteRows.length > 0) {
    console.log("OCTETS (déterministes)");
    console.table(byteRows);
  }

  // MÉMOIRE — différentielle servi / non servi, paires alternées.
  if (wanted("remote-memory")) {
    const memRows = [];
    for (const [k, dist] of camps) {
      const per = [];
      for (let i = 0; i < memRuns; i++) {
        const served = measure(dist, "remote-memory", "serve", true).value;
        const idle = measure(dist, "remote-memory", "idle", true).value;
        per.push((served - idle) / REMOTE_PRESENTS);
      }
      const d = spread(per);
      if (d > MAX_DISPERSION) refused = true;
      const value = median(per);
      memRows.push({
        camp: k,
        mesure: `octets par présent distant (${REMOTE_PRESENTS} présents, sans état)`,
        valeur: `${value.toFixed(1)} o`,
        dispersion: `${(d * 100).toFixed(1)} %${d > MAX_DISPERSION ? " REFUSÉ" : ""}`,
        budget: "≤ 160 o",
        verdict: value <= 160 ? "tenu" : "DÉPASSÉ",
      });
    }
    console.log("MÉMOIRE (tas après GC forcé, différentielle)");
    console.table(memRows);
    console.log(
      "« avec état » : non mesurable en 10.0 (ADR-0025 P4, aucun état ne se pose).",
    );
  }
  if (refused) {
    console.error(
      "Dispersion > 3 % : mesure REFUSÉE — machine à calmer, relancer.",
    );
    process.exit(3);
  }
}
