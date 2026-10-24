/**
 * Micro-banc — ce que coûte UN champ de plus sur le `Resolver`, construit à
 * CHAQUE requête (`router.ts`, `new Resolver(context)`).
 *
 * A/B sur le Resolver RÉEL du `dist` bâti de @nodefony/framework :
 * - `B` : le fichier tel qu'il est bâti ;
 * - `A` : le même fichier, une déclaration de champ retirée (`NF_FIELD`,
 *   défaut `unrendered`) — écrit dans un dossier temporaire, imports réécrits
 *   vers les mêmes modules, supprimé à la fin.
 *
 * Mesure : construction + premier appel de méthode (le cycle qu'une requête
 * paie), médiane de RUNS séries ALTERNÉES (la dérive porte sur les deux).
 *
 * Validité : A ne doit PAS porter le champ, B doit le porter — sinon exit 1,
 * aucun chiffre publié.
 *
 * Il ment dans l'autre sens d'un serveur (tas froid, site monomorphe) : un
 * écart sous ~1 ns n'a pas de sens ici. Il dit l'ordre de grandeur.
 *
 * Usage : node .claude/skills/nodefony-load-test/scripts/micro/micro-resolver-field.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FIELD = process.env.NF_FIELD ?? "unrendered";
const WARM = 2e5;
const N = 2e6;
const RUNS = 9;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const distFile = path.join(
  root,
  "src/packages/@nodefony/framework/dist/nodefony/src/Resolver.js",
);
const distDir = path.dirname(distFile);

const source = fs.readFileSync(distFile, "utf8");
const decl = new RegExp(`\\n\\t${FIELD} = [^;\\n]+;`);
if (!decl.test(source)) {
  console.error(
    `champ « ${FIELD} » introuvable dans ${distFile} — rien à mesurer`,
  );
  process.exit(1);
}
// Imports relatifs → URL absolue du dist ; spécificateurs nus → résolus d'ici
// (même lien de workspace) : A et B partagent les MÊMES instances de modules.
const rewrite = (code) =>
  code.replace(/from "([^"]+)"/g, (_, spec) =>
    spec.startsWith(".")
      ? `from "${pathToFileURL(path.resolve(distDir, spec)).href}"`
      : `from "${import.meta.resolve(spec)}"`,
  );
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nf-micro-resolver-"));
try {
  const fileA = path.join(tmp, "ResolverA.mjs");
  const fileB = path.join(tmp, "ResolverB.mjs");
  fs.writeFileSync(fileA, rewrite(source.replace(decl, "")));
  fs.writeFileSync(fileB, rewrite(source));
  const { default: A } = await import(pathToFileURL(fileA).href);
  const { default: B } = await import(pathToFileURL(fileB).href);

  const context = { container: { get: () => null } };
  const probeA = new A(context);
  const probeB = new B(context);
  if (Object.hasOwn(probeA, FIELD) || !Object.hasOwn(probeB, FIELD)) {
    console.error("décor faux : A porte le champ ou B ne le porte pas");
    process.exit(1);
  }

  let sink = 0;
  /** Une requête : construire, lire ce que le pipeline relit tout de suite. */
  function cycle(Ctor, n) {
    for (let i = 0; i < n; i++) {
      const r = new Ctor(context);
      if (r.resolve) sink++;
      if (r.route === null) sink++;
    }
  }
  const time = (Ctor) => {
    const t0 = process.hrtime.bigint();
    cycle(Ctor, N);
    return Number(process.hrtime.bigint() - t0) / N;
  };
  cycle(A, WARM);
  cycle(B, WARM);
  const runs = { A: [], B: [] };
  for (let i = 0; i < RUNS; i++) {
    if (i % 2 === 0) {
      runs.A.push(time(A));
      runs.B.push(time(B));
    } else {
      runs.B.push(time(B));
      runs.A.push(time(A));
    }
  }
  const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const mA = med(runs.A);
  const mB = med(runs.B);
  const spread = (xs) => (Math.max(...xs) - Math.min(...xs)) / med(xs);
  console.log(
    JSON.stringify(
      {
        field: FIELD,
        nsPerRequest: {
          sansChamp: +mA.toFixed(2),
          avecChamp: +mB.toFixed(2),
          ecart: +(mB - mA).toFixed(2),
        },
        dispersion: {
          A: +spread(runs.A).toFixed(3),
          B: +spread(runs.B).toFixed(3),
        },
        runs: RUNS,
        node: process.version,
        sink,
      },
      null,
      2,
    ),
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
