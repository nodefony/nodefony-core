/**
 * Micro-banc A/B — ce que coûte `Resolver.returnController`, appelé sur la
 * valeur rendue par CHAQUE action HTTP, entre deux `Resolver.js` BÂTIS de
 * @nodefony/framework (avant / après un diff).
 *
 * Quatre retours, ceux d'une application ordinaire : objet simple et tableau
 * (auto-JSON — le cas courant), chaîne, nombre. Le contexte est factice et ses
 * envois sont vides : on mesure l'AIGUILLAGE de la valeur, pas l'écriture
 * réseau, qui serait la même des deux côtés.
 *
 * Protocole : les deux variantes chargées dans le même process (imports
 * réécrits vers les MÊMES modules, comme `micro-resolver-field.mjs`), séries
 * ALTERNÉES A B A B… pour étaler la dérive thermique, médiane de RUNS.
 * Validité : chaque variante doit avoir rendu chaque valeur par la voie
 * attendue (compteurs `render`/`send` du contexte factice) — sinon exit 1,
 * aucun chiffre publié.
 *
 * Il ment dans l'autre sens d'un serveur (tas froid, site monomorphe par
 * série) : il dit l'ordre de grandeur, un écart sous ~2 ns n'a pas de sens.
 *
 * @usage node .claude/skills/nodefony-load-test/scripts/micro/micro-return-controller-ab.mjs --a <Resolver.js avant> --b <Resolver.js après> [--runs 9]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const fileA = opt("--a");
const fileB = opt("--b");
const RUNS = Number(opt("--runs", "9"));
const WARM = 2e5;
const N = 2e6;
if (!fileA || !fileB) {
  console.error("usage : --a <Resolver.js> --b <Resolver.js> [--runs 9]");
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
// Les imports relatifs d'un Resolver.js bâti visent ses voisins du dist.
const distDir = path.join(
  root,
  "src/packages/@nodefony/framework/dist/nodefony/src",
);
const rewrite = (code) =>
  code.replace(/from "([^"]+)"/g, (_, spec) =>
    spec.startsWith(".")
      ? `from "${pathToFileURL(path.resolve(distDir, spec)).href}"`
      : `from "${import.meta.resolve(spec)}"`,
  );

const VALUES = {
  object: { id: 42, label: "Cordage 12mm" },
  array: [1, 2, 3],
  string: "ok",
  number: 42,
};

/** Un contexte HTTP factice : envois vides, comptés. */
function fakeContext() {
  return {
    type: "http",
    sended: false,
    isRedirect: false,
    renders: 0,
    sends: 0,
    setContextJson() {},
    render() {
      this.renders++;
      return undefined;
    },
    send() {
      this.sends++;
      return undefined;
    },
  };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nf-micro-return-"));
try {
  const load = async (file, name) => {
    const out = path.join(tmp, `${name}.mjs`);
    fs.writeFileSync(out, rewrite(fs.readFileSync(file, "utf8")));
    const { default: Ctor } = await import(pathToFileURL(out).href);
    return Ctor;
  };
  const variants = { A: await load(fileA, "A"), B: await load(fileB, "B") };

  /** Un faux Resolver : le prototype réel, un contexte factice. */
  const resolverOf = (Ctor) => {
    const r = Object.create(Ctor.prototype);
    r.context = fakeContext();
    return r;
  };

  // Validité : chaque valeur part par la voie attendue, des deux côtés.
  for (const [name, Ctor] of Object.entries(variants)) {
    const r = resolverOf(Ctor);
    for (const value of Object.values(VALUES)) r.returnController(value);
    if (r.context.renders !== 3 || r.context.sends !== 1) {
      console.error(
        `décor faux : ${name} rend ${r.context.renders} render / ${r.context.sends} send (attendu 3 / 1)`,
      );
      process.exit(1);
    }
  }

  const time = (r, value, n) => {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) r.returnController(value);
    return Number(process.hrtime.bigint() - t0) / n;
  };
  const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const spread = (xs) => (Math.max(...xs) - Math.min(...xs)) / med(xs);

  const result = {};
  for (const [kind, value] of Object.entries(VALUES)) {
    const rA = resolverOf(variants.A);
    const rB = resolverOf(variants.B);
    time(rA, value, WARM);
    time(rB, value, WARM);
    const runs = { A: [], B: [] };
    for (let i = 0; i < RUNS; i++) {
      const order = i % 2 === 0 ? ["A", "B"] : ["B", "A"];
      for (const v of order) runs[v].push(time(v === "A" ? rA : rB, value, N));
    }
    result[kind] = {
      avantNs: +med(runs.A).toFixed(2),
      apresNs: +med(runs.B).toFixed(2),
      ecartNs: +(med(runs.B) - med(runs.A)).toFixed(2),
      dispersion: {
        A: +spread(runs.A).toFixed(3),
        B: +spread(runs.B).toFixed(3),
      },
    };
  }
  console.log(
    JSON.stringify(
      { nsParAppel: result, runs: RUNS, node: process.version },
      null,
      2,
    ),
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
