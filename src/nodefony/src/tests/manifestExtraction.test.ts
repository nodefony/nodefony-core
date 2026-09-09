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
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, afterEach } from "vitest";
import { checkSurface } from "../kernel/checks/surface";
import { checkWiring } from "../kernel/checks/wiring";
import { checkReadiness } from "../kernel/checks/readiness";
import {
  diskManifestReader,
  manifestFileWith,
  readManifestCode,
  readManifestSources,
  withoutComments,
} from "../kernel/checks/sourceText";
import { getScaffoldContext } from "../cli/scaffold/engine";

/** Racine de CE dépôt — lui-même une application Nodefony. */
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

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
      manifestFileWith(root, diskManifestReader, /roleHierarchy\s*:\s*\{/u),
      /nodefony[/\\]config[/\\]security\.ts$/u,
    );
  });

  it("… et retombe sur le manifeste racine quand l'ancre est INTROUVABLE", () => {
    // L'appelant sait déjà signaler une ancre absente ; lui rendre un chemin
    // inventé le ferait écrire dans un fichier qui n'existe pas.
    const root = app({ "nodefony.config.ts": `export default {};` });
    assert.equal(
      manifestFileWith(root, diskManifestReader, /roleHierarchy\s*:\s*\{/u),
      path.join(root, "nodefony.config.ts"),
    );
  });
});

/*
 *   #298 — les lecteurs cherchent dans le CODE, commentaires retirés, et par
 *   tous leurs lecteurs. Le manifeste racine de ce dépôt porte un exemple
 *   `mongoose` entièrement commenté qui contient `connectors: {` : sur le texte
 *   brut, la racine « portait » le motif et gagnait toujours — le fragment qui
 *   porte le VRAI bloc n'était jamais lu, et le scaffold lisait un connecteur
 *   nommé `options`, tiré d'un commentaire.
 */
describe("les lecteurs du manifeste lisent le CODE, pas le texte brut (#298)", () => {
  it("🔴 une ancre en COMMENTAIRE dans la racine ne l'emporte pas sur le vrai bloc d'un fragment", () => {
    const root = app({
      "nodefony.config.ts": `import { orm } from "./nodefony/config/orm";
// Exemple :
//   connectors: {
//     options: { user, pass, maxPoolSize },
//   },
export default { modules: [use("@nodefony/drizzle", orm(ctx))] };`,
      "nodefony/config/orm.ts": `export const orm = () => ({ connectors: { main: { dialect: "postgres" } } });`,
    });
    assert.match(
      manifestFileWith(root, diskManifestReader, /\bconnectors\s*:\s*\{/u),
      /nodefony[/\\]config[/\\]orm\.ts$/u,
    );
  });

  it("le scaffold ne lit pas un connecteur dans un commentaire — liste vide plutôt qu'un nom inventé", () => {
    const root = app({
      "package.json": `{ "name": "x" }`,
      "nodefony.config.ts": `//   connectors: {
//     options: { user, pass },
//   },
export default { modules: [] };`,
    });
    const ctx = getScaffoldContext(root);
    assert.ok(ctx, "le décor est une application");
    // Aucun connecteur DÉCLARÉ : le scaffold expose celui que le module ORM
    // fournit (`default`) — jamais un nom tiré d'un commentaire.
    assert.deepEqual(
      ctx.connectors.map((c) => c.name),
      ["default"],
    );
  });

  it("… et sur CE dépôt, l'exemple mongoose commenté ne produit plus de connecteur « options »", () => {
    const ctx = getScaffoldContext(REPO_ROOT);
    assert.ok(ctx, "le dépôt est une application");
    assert.ok(
      !ctx.connectors.some((c) => c.name === "options"),
      JSON.stringify(ctx.connectors.map((c) => c.name)),
    );
  });

  it("🔴 sans nodefony.config.ts, AUCUN fragment n'est un manifeste", () => {
    // Un fragment ne vaut que parce que le manifeste le nomme. Dans un paquet
    // de module lancé seul, `defineModuleConfig.ts`, `services.ts` et
    // `routing.ts` passaient pour des fragments de manifeste.
    const root = app({
      "nodefony/config/config.ts": `export default {};`,
      "nodefony/config/defineModuleConfig.ts": `export const x = 1;`,
      "nodefony/config/services.ts": `export const services = [];`,
      "nodefony/config/routing.ts": `export const routing = [];`,
    });
    assert.deepEqual(readManifestSources(root, diskManifestReader), []);
  });

  it("readManifestCode rend le code de TOUTES les sources, commentaires retirés", () => {
    const root = app({
      "nodefony.config.ts": `// use("@nodefony/redis")
export default { modules: [use("@nodefony/http")] };`,
      "nodefony/config/security.ts": `export const security = () => ({ jwt: { keystore: { dir: "var/keys" } } });`,
    });
    const code = readManifestCode(root, diskManifestReader);
    assert.match(code, /keystore\s*:/u, "le fragment est lu");
    assert.doesNotMatch(code, /@nodefony\/redis/u, "le commentaire est retiré");
  });

  it("readiness voit un use() déplacé dans un fragment", async () => {
    const root = app({
      "package.json": `{ "name": "a" }`,
      "nodefony.config.ts": `import { extra } from "./nodefony/config/extra";
export default { modules: [...extra] };`,
      "nodefony/config/extra.ts": `export const extra = [use("@acme/absent")];`,
    });
    mkdirSync(path.join(root, "node_modules"), { recursive: true });
    const r = await checkReadiness({ projectRoot: root });
    assert.ok(
      r.findings.some(
        (f) =>
          f.kind === "module-not-installed" &&
          f.message.includes("@acme/absent"),
      ),
      JSON.stringify(r.findings),
    );
  });

  it("wiring nomme le FRAGMENT qui porte une zone énumérée, pas le manifeste racine", () => {
    const root = app({
      "index.ts": `class App extends Module {}`,
      "nodefony.config.ts": `export default { modules: [] };`,
      "nodefony/config/security.ts": `export const security = () => ({
  areas: {
    compte: {
      pattern: "^/api/account/(profile|invoices)",
      authenticators: ["session"],
    },
  },
});`,
    });
    const r = checkWiring({ roots: [root], cwd: root, projectRoot: root });
    const f = r.findings.filter((x) => x.kind === "firewall-area-enumere");
    assert.strictEqual(f.length, 1, JSON.stringify(r.findings));
    assert.match(f[0].file, /nodefony[/\\]config[/\\]security\.ts$/u);
  });
});

/*
 *   Le nettoyage des commentaires est la brique de TOUS ces lecteurs — et il
 *   avait un trou : deux expressions régulières, les blocs retirés AVANT les
 *   lignes, si bien qu'un `/*` écrit dans une ligne `//` ouvrait un faux bloc
 *   refermé des centaines de lignes plus bas. Le manifeste de ce dépôt passait
 *   de 31 000 à 2 800 caractères, `keystore` compris — et `security:secrets`
 *   déclarait non câblé ce qui l'était.
 */
describe("withoutComments — le CODE, en une passe (#298)", () => {
  it("🔴 un `/*` dans une ligne `//` n'ouvre aucun bloc", () => {
    const code = withoutComments(`// consomme /api/*)
const a = 1;
/* bloc */
const keystore: { dir: string } = { dir: "x" };
`);
    assert.match(code, /const a = 1/u, "le code qui suit la ligne survit");
    assert.match(code, /keystore\s*:/u);
    assert.doesNotMatch(
      code,
      /bloc|consomme/u,
      "les commentaires sont retirés",
    );
  });

  it("une chaîne est copiée telle quelle : URL, `//` et `/*` entre guillemets", () => {
    const code = withoutComments(
      `const u = "https://x.test/a/*"; const c = '// pas un commentaire'; // vrai commentaire`,
    );
    assert.match(code, /https:\/\/x\.test\/a\/\*/u);
    assert.match(code, /'\/\/ pas un commentaire'/u);
    assert.doesNotMatch(code, /vrai commentaire/u);
  });

  it("sur le manifeste de CE dépôt, le câblage du keystore survit au nettoyage", () => {
    const raw = readFileSync(
      path.join(REPO_ROOT, "nodefony.config.ts"),
      "utf8",
    );
    const code = withoutComments(raw);
    assert.match(code, /keystore\s*:/u);
    // Un faux bloc ouvert avale tout ce qui suit : la DERNIÈRE ligne de code
    // du fichier doit survivre, quelle qu'elle soit.
    const lastCodeLine = raw
      .split("\n")
      .map((l) => l.trim())
      .findLast(
        (l) => l !== "" && !l.startsWith("//") && !l.startsWith("*"),
      ) as string;
    assert.ok(
      code.includes(lastCodeLine),
      `manifeste amputé (${code.length} caractères) : « ${lastCodeLine} » absent`,
    );
  });
});

/*
 *   #299 — deux choses habitent un dossier du même nom : le fragment de
 *   manifeste (`<app>/nodefony/config/<module>.ts`) et la configuration d'un
 *   MODULE (`<module>/nodefony/config/config.ts`). Le lecteur écarte
 *   `config.ts` et `*.config.ts` en silence : un fragment nommé
 *   `security.config.ts` n'est lu par aucun contrôle ET chargé par personne.
 */
describe("un fragment au nom RÉSERVÉ est signalé par doctor (#299)", () => {
  it("🔴 `nodefony/config/security.config.ts` : ignoré par les contrôles et chargé par personne → constat", () => {
    const root = app({
      "index.ts": `class App extends Module {}`,
      "nodefony.config.ts": `export default { modules: [] };`,
      "nodefony/config/security.config.ts": `export const security = () => ({});`,
      "nodefony/config/config.ts": `export default {};`,
    });
    const r = checkWiring({ roots: [root], cwd: root, projectRoot: root });
    const f = r.findings.filter((x) => x.kind === "reserved-fragment-name");
    assert.strictEqual(f.length, 2, JSON.stringify(r.findings));
    const files = f.map((x) => x.file).sort();
    assert.match(files[0], /nodefony[/\\]config[/\\]config\.ts$/u);
    assert.match(files[1], /nodefony[/\\]config[/\\]security\.config\.ts$/u);
    assert.match(
      f[0].message,
      /security\.ts|<module>\.ts/u,
      "le geste : renommer",
    );
  });

  it("`cluster/cluster.config.ts` et `security.ts` ne sont PAS signalés", () => {
    const root = app({
      "index.ts": `class App extends Module {}`,
      "nodefony.config.ts": `export default { modules: [] };`,
      "nodefony/config/security.ts": `export const security = () => ({});`,
      "nodefony/config/cluster/cluster.config.ts": `export default { workers: 1 };`,
    });
    const r = checkWiring({ roots: [root], cwd: root, projectRoot: root });
    assert.deepEqual(
      r.findings.filter((x) => x.kind === "reserved-fragment-name"),
      [],
      JSON.stringify(r.findings),
    );
  });
});
