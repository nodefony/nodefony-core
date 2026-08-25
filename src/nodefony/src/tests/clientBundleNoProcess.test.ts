/**
 * Sentinelle du bundle NAVIGATEUR — aucune entrée de `dist/client/` ne doit
 * toucher une globale Node **au chargement du module**.
 *
 * Le défaut que ce test ferme : `src/Service.ts` est ISOMORPHE (réexporté par
 * `src/client/index.ts`), et une lecture nue de `process.env` posée à son
 * top-level a tué le bundle Studio ENTIER — `ReferenceError: process is not
 * defined` levée avant le premier import applicatif, page blanche, aucun test
 * du dépôt ne s'en apercevant. Rien dans TypeScript ne distingue un fichier
 * isomorphe d'un fichier serveur : `process` y est typé, il compile, et c'est
 * seulement le navigateur qui tombe.
 *
 * Pourquoi la preuve porte sur `dist/`, pas sur les sources : c'est l'artefact
 * que Vite sert au navigateur. Une garde correcte en `.ts` mais perdue au
 * bundling passerait une sentinelle écrite sur le source.
 *
 * Pourquoi un process ENFANT : `delete globalThis.process` est irréversible
 * vis-à-vis des modules déjà chargés, et vitest a besoin de `process` pour
 * rapporter. L'enfant isole le décor et meurt avec.
 *
 * Ce que le test NE juge PAS : les dépendances externes. `react` lit
 * `process.env.NODE_ENV` à son top-level — c'est un cas que tout bundler
 * substitue à la compilation, pas un défaut de Nodefony. Seule une frame
 * située DANS `dist/client/` fait échouer.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const distClient = path.resolve(here, "..", "..", "dist", "client");

/** Entrées déclarées par `clientConfig` (rolldown.config.ts) — `preserveModules`
 *  conserve l'arborescence de `src/`, d'où le `client/` répété. */
const ENTRIES = [
  path.join("client", "index.js"),
  path.join("client", "debugbar", "index.js"),
  path.join("client", "react", "index.js"),
  path.join("client", "roles", "index.js"),
];

/** Importe `target` dans un interpréteur privé de `process`, et rend la
 *  première frame de la pile en cas d'échec. Sortie sur une seule ligne JSON —
 *  `console.log` n'est appelé qu'après restauration de `process`. */
const CHILD = `
const saved = globalThis.process;
const target = saved.argv[1];
const say = (o) => { globalThis.process = saved; console.log(JSON.stringify(o)); };
delete globalThis.process;
import(target).then(
  () => say({ ok: true }),
  (e) => say({
    ok: false,
    name: e && e.constructor ? e.constructor.name : "Error",
    message: String(e && e.message),
    frame: String((e && e.stack) || "").split("\\n")[1] || "",
  }),
);
`;

interface IProbeResult {
  ok: boolean;
  name?: string;
  message?: string;
  frame?: string;
}

const probe = (entry: string): IProbeResult => {
  const url = pathToFileURL(path.join(distClient, entry)).href;
  const run = spawnSync(process.execPath, ["-e", CHILD, url], {
    encoding: "utf8",
    timeout: 30_000,
  });
  const line = run.stdout.trim().split("\n").pop() ?? "";
  if (!line) {
    throw new Error(
      `sonde muette pour ${entry} — stderr: ${run.stderr.slice(0, 400)}`,
    );
  }
  return JSON.parse(line) as IProbeResult;
};

describe("bundle navigateur — aucune globale Node au chargement", () => {
  beforeAll(() => {
    // Un `dist` absent rendrait la sentinelle VERTE sans rien avoir chargé :
    // l'échec est explicite plutôt que silencieux.
    expect(
      existsSync(distClient),
      `dist/client/ absent — lancer 'npm run build' dans src/nodefony avant cette suite`,
    ).toBe(true);
  });

  for (const entry of ENTRIES) {
    // Le `spawnSync` s'autorise 30 s ; laisser le `it` au défaut de 5 s rend ce
    // budget inatteignable, et la suite complète rouge sur quatre entrées dont
    // aucune n'a de défaut. Vu au run du 08-21 : 4 timeouts, 4 verts en isolation.
    it(`${entry} se charge sans 'process'`, { timeout: 60_000 }, () => {
      const full = path.join(distClient, entry);
      expect(existsSync(full), `entrée absente du dist : ${entry}`).toBe(true);

      const res = probe(entry);
      if (res.ok) return;

      // Une frame hors dist/client = dépendance externe (react & co) : le
      // bundler substitue ces globales à la compilation, ce n'est pas notre
      // surface. Tout le reste est un défaut de Nodefony.
      const ours = (res.frame ?? "").includes(
        `${path.sep}dist${path.sep}client`,
      );
      expect(
        ours,
        `${entry} touche une globale Node au chargement :\n` +
          `  ${res.name}: ${res.message}\n  ${res.frame}`,
      ).toBe(false);
    });
  }
});
