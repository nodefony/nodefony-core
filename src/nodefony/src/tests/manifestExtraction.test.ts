/*
 *   Un bloc de configuration DÉPLACÉ ne doit rendre aucun contrôle aveugle.
 *
 *   Quatre instruments du produit lisent le TEXTE du manifeste à l'expression
 *   régulière. Tant qu'ils visaient `nodefony.config.ts` en dur, extraire un
 *   bloc vers `nodefony/config/` les faisait rendre ZÉRO constat — ce qui se
 *   lit « tout va bien », et non « je n'ai rien pu lire ». C'est la panne la
 *   plus dangereuse qu'un contrôle puisse avoir, et elle est SILENCIEUSE.
 *
 *   Ce banc travaille sur une arborescence réelle mais jetable : ces contrôles
 *   doivent répondre sur une application qui ne démarre pas, donc rien ne
 *   s'évalue ici — un décor qui booterait ne prouverait pas le bon chemin.
 */

import assert from "node:assert";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, afterEach } from "vitest";
import { checkSurface } from "../kernel/checks/surface";
import { manifestFileWith } from "../kernel/checks/sourceText";

const jetables: string[] = [];
afterEach(() => {
  for (const d of jetables.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

/** Une application jetable : des chemins relatifs, leur contenu. */
function app(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nf-extract-"));
  jetables.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return dir;
}

/** Un lecteur sur le disque réel — ce que le scaffold fournit autrement. */
const disque = {
  exists: (f: string) => existsSync(f),
  read: (f: string) => readFileSync(f, "utf8"),
  listDir: (d: string) =>
    readdirSync(d, { withFileTypes: true }).map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
    })),
};

/** La zone publique qui couvre TOUT — le manquement que le rapport doit crier. */
const ZONE_TOUT = `areas: { app: { pattern: "^/.*", security: false } }`;

function surface(root: string) {
  return checkSurface({
    roots: [root],
    cwd: root,
    projectRoot: root,
    env: {},
  });
}

describe("un bloc extrait reste VU par les contrôles du manifeste", () => {
  it("zone publique dans le manifeste racine — le cas d'aujourd'hui", () => {
    const root = app({
      "nodefony.config.ts": `export default { ${ZONE_TOUT} };`,
    });
    const r = surface(root);
    assert.equal(
      r.findings.filter((f) => f.kind === "public-area-covers-all").length,
      1,
      "la zone qui ouvre tout doit être criée",
    );
  });

  it("🔴 la MÊME zone DÉPLACÉE dans nodefony/config/ est toujours vue", () => {
    // Le cœur du ticket. Sans la lecture des fragments, ce contrôle rend zéro
    // constat sur une application dont TOUTES les routes sont publiques.
    const root = app({
      "nodefony.config.ts": `import { security } from "./nodefony/config/security";
export default { modules: [use("@nodefony/security", security(ctx))] };`,
      "nodefony/config/security.ts": `export const security = () => ({ ${ZONE_TOUT} });`,
    });
    const r = surface(root);
    const trouvés = r.findings.filter(
      (f) => f.kind === "public-area-covers-all",
    );
    assert.equal(trouvés.length, 1, "la zone déplacée doit être criée aussi");
    assert.match(
      trouvés[0].file,
      /security\.ts$/u,
      "le manquement doit pointer le fichier qui le PORTE — envoyer corriger " +
        "le manifeste racine ferait chercher là où il n'y a rien",
    );
  });

  it("ne voit RIEN quand il n'y a rien — un contrôle bruyant se fait désactiver", () => {
    const root = app({
      "nodefony.config.ts": `export default { modules: [] };`,
      "nodefony/config/http.ts": `export const http = () => ({ headerServer: null });`,
    });
    assert.equal(
      surface(root).findings.filter((f) => f.kind === "public-area-covers-all")
        .length,
      0,
    );
  });

  it("un écrivain vise le fichier qui PORTE l'ancre, pas le manifeste par défaut", () => {
    // C'est ce qui décide où le générateur insère `roleHierarchy`.
    const root = app({
      "nodefony.config.ts": `export default { modules: [] };`,
      "nodefony/config/security.ts": `export const security = () => ({ roleHierarchy: { ROLE_ADMIN: [] } });`,
    });
    assert.match(
      manifestFileWith(root, disque, /roleHierarchy\s*:\s*\{/u),
      /nodefony[/\\]config[/\\]security\.ts$/u,
    );
  });

  it("… et retombe sur le manifeste racine quand l'ancre est INTROUVABLE", () => {
    // L'appelant sait déjà signaler une ancre absente ; lui rendre un chemin
    // inventé le ferait écrire dans un fichier qui n'existe pas.
    const root = app({ "nodefony.config.ts": `export default {};` });
    assert.equal(
      manifestFileWith(root, disque, /roleHierarchy\s*:\s*\{/u),
      path.join(root, "nodefony.config.ts"),
    );
  });
});
