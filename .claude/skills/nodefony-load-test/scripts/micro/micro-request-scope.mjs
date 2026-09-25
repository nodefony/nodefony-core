/**
 * Micro-bench isolé — ce que coûte l'injection à chaque requête : un contrôleur
 * (portée « request », le défaut) construit par l'injecteur, et le service de
 * portée `request` qu'il réclame (#485).
 *
 * Importe `nodefony` — donc le dist COURANT du cœur. Quatre variantes :
 *   A. contrôleur ← singleton                 (Injector.instantiate seul)
 *   B. bulle + contrôleur ← singleton         (enterScope + RequestContext.run
 *                                              + A + leaveScope : la RÉFÉRENCE)
 *   C. bulle + contrôleur ← service request   (classe nue : l'injecteur et le
 *                                              scope seuls — C − B = le coût
 *                                              d'un service request)
 *   D. bulle + contrôleur ← service request   (sous-classe de Service :
 *                                              D − C = son constructeur)
 * C et D exigent un cœur qui porte la portée `request` : sur un dist antérieur
 * elles sont sautées, et la sortie le DIT.
 *
 * Validité (RÈGLE N°1) : chaque variante vérifie que le travail a EU LIEU —
 * dépendance reçue, un service request créé ET nettoyé par cycle. Un écart →
 * exit 1, aucun chiffre publié.
 *
 * Protocole : échauffement 1e5 par variante, puis 5 séries de 5e5 ops —
 * médiane et dispersion par variante. Il ment dans l'autre sens d'un serveur
 * (tas froid, sites d'appel monomorphes) : il chiffre un poste, l'arbitre reste
 * la sonde in-situ (`bench-ab-mono.sh <label> NF_PERF_PROBE=1`). Comparer
 * AVANT/APRÈS dans la MÊME fenêtre, en paires alternées : bascule
 * `git stash push -- <fichiers>` / `git stash pop` + rebuild du cœur après
 * CHAQUE bascule — le dist ne suit pas le stash.
 *
 * Usage : node .claude/skills/nodefony-load-test/scripts/micro/micro-request-scope.mjs
 */
import {
  Container,
  Injector,
  Nodefony,
  RequestContext,
  Scope,
  Service,
  inject,
  injectable,
} from "nodefony";

const WARMUP = 1e5;
const SERIES = 5;
const N = 5e5;

const supportsRequest = typeof Scope.prototype.hasOwn === "function";

// Décor du serveur réel : la racine porte `syslog` et `kernel` — sans eux,
// chaque Service construit fabriquerait son propre Syslog.
const root = new Container();
for (let i = 0; i < 40; i++) root.set(`svc${i}`, { name: `svc${i}` });
root.set("syslog", { log() {}, reset() {} });
root.set("kernel", { name: "kernel" });
root.addScope("request");
const ctx = { name: "context" };

class Dep extends Service {
  constructor(container) {
    super("microDep", container ?? root, false);
  }
}
injectable("MicroDep")(Dep);
const dep = new Dep(root);
Injector.rememberContainerKey(Dep, "microDep");
Nodefony.getKernel = () => ({
  get: (key) => (key === "microDep" ? dep : null),
  set() {},
});

class CtrlSingletonDep {
  static scope = "request";
  constructor(context, d) {
    this.context = context;
    this.d = d;
  }
}
inject("MicroDep")(CtrlSingletonDep, undefined, 1);

let created = 0;
let cleaned = 0;

class PlainTenant {
  constructor(scope) {
    this.name = "microPlainTenant";
    this.scope = scope;
    created++;
  }
  clean() {
    this.scope = null;
    cleaned++;
  }
}
class ServiceTenant extends Service {
  constructor(scope) {
    super("microServiceTenant", scope, false);
    created++;
  }
  clean() {
    cleaned++;
    super.clean();
  }
}
class CtrlPlain {
  static scope = "request";
  constructor(context, t) {
    this.context = context;
    this.t = t;
  }
}
class CtrlService {
  static scope = "request";
  constructor(context, t) {
    this.context = context;
    this.t = t;
  }
}
if (supportsRequest) {
  injectable({ name: "MicroPlainTenant", scope: "request" })(PlainTenant);
  injectable({ name: "MicroServiceTenant", scope: "request" })(ServiceTenant);
  inject("MicroPlainTenant")(CtrlPlain, undefined, 1);
  inject("MicroServiceTenant")(CtrlService, undefined, 1);
}

/** Une requête : bulle ouverte sur un scope neuf, contrôleur, fermeture. */
const inRequest = (Ctrl) => {
  const s = root.enterScope("request");
  const c = RequestContext.run({ requestId: "micro", scope: s }, () =>
    Injector.instantiate(Ctrl, ctx),
  );
  root.leaveScope(s);
  return c;
};

const variants = {
  "A contrôleur ← singleton": {
    run: () => Injector.instantiate(CtrlSingletonDep, ctx),
    valid: (c) => c.d === dep,
  },
  "B bulle + contrôleur ← singleton": {
    run: () => inRequest(CtrlSingletonDep),
    valid: (c) => c.d === dep,
  },
  "C bulle + contrôleur ← request (classe nue)": {
    needsRequest: true,
    run: () => inRequest(CtrlPlain),
    valid: (c) => c.t instanceof PlainTenant && c.t.scope === null,
  },
  "D bulle + contrôleur ← request (Service)": {
    needsRequest: true,
    run: () => inRequest(CtrlService),
    valid: (c) => c.t instanceof ServiceTenant && c.t.container === null,
  },
};

function bench(fn, n) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn();
  return Number(process.hrtime.bigint() - t0) / n;
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

const results = {};
const skipped = {};
for (const [label, v] of Object.entries(variants)) {
  if (v.needsRequest && !supportsRequest) {
    skipped[label] = "dist sans portée request (antérieur à #485)";
    continue;
  }
  // Contrôle AVANT de mesurer : une variante qui ne fait pas son travail
  // mesurerait la vitesse à laquelle elle échoue.
  const before = { created, cleaned };
  if (!v.valid(v.run())) {
    console.error(`INVALIDE — ${label} : dépendance non reçue`);
    process.exit(1);
  }
  if (
    v.needsRequest &&
    (created - before.created !== 1 || cleaned - before.cleaned !== 1)
  ) {
    console.error(
      `INVALIDE — ${label} : un cycle doit créer ET nettoyer un service request ` +
        `(créés ${created - before.created}, nettoyés ${cleaned - before.cleaned})`,
    );
    process.exit(1);
  }
  for (let i = 0; i < WARMUP; i++) v.run();
  const runs = [];
  const startCreated = created;
  const startCleaned = cleaned;
  for (let r = 0; r < SERIES; r++) runs.push(bench(v.run, N));
  // Contrôle PENDANT : autant de créations et de nettoyages que de cycles.
  if (v.needsRequest) {
    const expected = SERIES * N;
    if (
      created - startCreated !== expected ||
      cleaned - startCleaned !== expected
    ) {
      console.error(
        `INVALIDE — ${label} : ${created - startCreated} créés, ` +
          `${cleaned - startCleaned} nettoyés pour ${expected} cycles`,
      );
      process.exit(1);
    }
  }
  const med = median(runs);
  results[label] = {
    median_ns: +med.toFixed(1),
    dispersion_pct: +(
      ((Math.max(...runs) - Math.min(...runs)) / med) *
      100
    ).toFixed(1),
    runs_ns: runs.map((x) => +x.toFixed(1)),
  };
}
console.log(
  JSON.stringify(
    { node: process.version, supportsRequest, results, skipped },
    null,
    2,
  ),
);
