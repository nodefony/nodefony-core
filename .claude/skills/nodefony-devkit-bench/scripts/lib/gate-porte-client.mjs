/**
 * Juge de la PORTE CLIENTE — l'agent a-t-il employé la façade de SON moteur ?
 *
 * 🔴 **Le banc était React-centré exactement comme le gabarit qu'il éprouve.**
 * Sa sonde cherchait `RealtimeClient|nodefony/react`, écrit en dur. Lâché sur
 * une application Svelte — le moteur qu'a effectivement choisi l'agent du
 * premier essai réel du 2026-09-12 — il aurait recalé un travail juste, et
 * n'aurait rien vu du trou que #347 a fermé. Ce qui se mesure est « l'agent
 * a-t-il employé LA façade de SON moteur », jamais « celle de React ».
 *
 * Le moteur se CONSTATE dans le manifeste — c'est le mot du produit
 * (`FRONTEND_PARAMS[…].client.marker`), et le même principe que pour le dossier
 * de l'application dans la tâche 0 : on lit, on ne suppose pas.
 *
 * | Sortie | Cause                     | Qui est en cause                 |
 * | -----: | ------------------------- | -------------------------------- |
 * |    `0` | conforme                  | — la porte du moteur est employée |
 * |    `1` | porte-client-absente      | l'AGENT — façade non employée    |
 * |    `2` | manifeste-illisible       | l'INSTRUMENT — rien à juger      |
 * |    `3` | moteur-front-ambigu       | l'INSTRUMENT — verdict non rendu |
 * |    `2` | frontiere-illisible       | l'INSTRUMENT — pas de premier commit |
 *
 * 🔴 **Il ne lit QUE ce que l'agent a AJOUTÉ** — les lignes ajoutées depuis le
 * premier commit (celui que `create app` pose), plus les fichiers non suivis.
 * Il lisait toute l'application, et `create app` LIVRE déjà la façade
 * (`tests/e2e.test.ts`, `LiveController.ts`) : vécu au banc (tâche 0, alpha.9),
 * une page « temps réel » qui interrogeait l'API toutes les deux secondes a été
 * jugée conforme sur le seul code du gabarit. La ligne, pas le fichier : un
 * fichier du gabarit simplement retouché contient déjà la façade.
 *
 * ⚠️ Ce juge ne regarde PAS le WebSocket recomposé à la main : c'est l'affaire
 * de la sonde négative jumelle. Une positive et une négative se prouvent
 * séparément — une négative seule passe aussi par abandon.
 *
 * @module
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { exit } from "./http-probe.mjs";
import { motifPorteClient, porteClientDe } from "./tache-zero.mjs";
import { needsShell } from "./exec-portable.mjs";

/**
 * Les fichiers où une porte cliente peut s'écrire.
 *
 * `.svelte` et `.vue` en font partie : ces moteurs écrivent leur logique DANS
 * le composant, et s'en tenir aux extensions TypeScript rendrait le juge aveugle
 * là précisément où il doit voir. C'est la même faute que le critère React-centré,
 * un cran plus bas.
 */
const EXTENSIONS = /\.(?:[cm]?[jt]sx?|svelte|vue)$/u;

/** Ce qu'on ne lit jamais : ni les dépendances, ni ce qui est construit. */
const IGNORES = new Set(["node_modules", "dist", ".git", "build", "coverage"]);

/**
 * Les sources de l'application — récursif, bornés aux dossiers utiles.
 *
 * @param {string} racine - le dossier de l'application.
 * @returns {string[]} les chemins absolus des fichiers à lire.
 */
export function sourcesDe(racine) {
  const trouves = [];
  const descendre = (dir, profondeur) => {
    if (profondeur > 8) return;
    let entrees;
    try {
      entrees = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entrees) {
      if (IGNORES.has(e) || e.startsWith(".")) continue;
      const p = path.join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) descendre(p, profondeur + 1);
      else if (EXTENSIONS.test(e)) trouves.push(p);
    }
  };
  descendre(racine, 0);
  return trouves;
}

/**
 * Les lignes AJOUTÉES d'un diff unifié, bornées aux fichiers sources — PURE.
 *
 * @param {string} diff - la sortie de `git diff -U0`.
 * @returns {string[]} les lignes ajoutées (sans le `+`), fichier par fichier.
 */
export function lignesAjoutees(diff) {
  const ajoutees = [];
  let lu = false;
  for (const ligne of diff.split("\n")) {
    const entete = /^\+\+\+ (?:b\/)?(.*)$/u.exec(ligne);
    if (entete) {
      const rel = entete[1] ?? "";
      lu =
        rel !== "/dev/null" &&
        EXTENSIONS.test(rel) &&
        !rel.split("/").some((seg) => IGNORES.has(seg) || seg.startsWith("."));
      continue;
    }
    if (lu && ligne.startsWith("+")) ajoutees.push(ligne.slice(1));
  }
  return ajoutees;
}

/**
 * Ce que l'agent a ÉCRIT : lignes ajoutées depuis le premier commit, et
 * contenu des fichiers sources non suivis.
 *
 * @param {string} racine - le dossier de l'application.
 * @returns {{ok: boolean, sources: string[], motif?: string}}
 */
export function sourcesAjoutees(racine) {
  const git = (...args) =>
    spawnSync("git", args, {
      cwd: racine,
      encoding: "utf8",
      shell: needsShell("git"),
      maxBuffer: 64 * 1024 * 1024,
    });
  const premier = git("rev-list", "--max-parents=0", "HEAD");
  const sha = premier.status === 0 ? premier.stdout.trim().split("\n")[0] : "";
  if (!sha) {
    return {
      ok: false,
      sources: [],
      motif:
        "pas de premier commit — sans lui, le LIVRÉ ne se distingue pas de " +
        "l'AJOUTÉ, et le gabarit porte déjà la façade",
    };
  }
  const diff = git("diff", "-U0", "--no-color", "--no-ext-diff", sha, "--");
  if (diff.status !== 0) {
    return { ok: false, sources: [], motif: "git diff illisible" };
  }
  const sources = lignesAjoutees(diff.stdout);
  const libres = git("ls-files", "--others", "--exclude-standard", "-z");
  for (const rel of (libres.stdout ?? "").split("\0")) {
    if (!rel) continue;
    if (!EXTENSIONS.test(rel)) continue;
    if (rel.split("/").some((seg) => IGNORES.has(seg) || seg.startsWith(".")))
      continue;
    try {
      sources.push(readFileSync(path.join(racine, rel), "utf8"));
    } catch {
      /* disparu entre-temps */
    }
  }
  return { ok: true, sources };
}

/**
 * Rend le verdict — fonction PURE, c'est elle qui porte la règle.
 *
 * Séparée de la collecte pour être éprouvable sans monter d'application : ce
 * banc a déjà payé des juges dont la règle ne se vérifiait qu'en les jouant.
 *
 * @param {object|null} pkg - le `package.json` de l'application.
 * @param {string[]} sources - le contenu des fichiers sources.
 * @returns {{code: number, cause: string, detail: string}}
 */
export function jugerPorteClient(pkg, sources) {
  const porte = porteClientDe(pkg);
  if (!porte.ok) {
    return {
      code: porte.cause === "moteur-front-ambigu" ? 3 : 2,
      cause: porte.cause,
      detail: `${porte.detail} — l'INSTRUMENT ne sait pas quoi exiger, pas l'agent`,
    };
  }
  const motif = motifPorteClient(porte.subpath);
  const vue = sources.some((s) => motif.test(s));
  if (!vue) {
    return {
      code: 1,
      cause: "porte-client-absente",
      detail:
        `moteur « ${porte.moteur} » : aucune source n'emploie ${porte.subpath} ` +
        "ni la façade RealtimeClient — le client a été recomposé au lieu " +
        "d'utiliser ce que le framework offre de plus haut niveau",
    };
  }
  return {
    code: 0,
    cause: "conforme",
    detail: `moteur « ${porte.moteur} » : la porte ${porte.subpath} est employée`,
  };
}

/**
 * Collecte et rend le verdict.
 *
 * @returns {void}
 */
function main() {
  const racine = process.cwd();
  const f = path.join(racine, "package.json");
  let pkg = null;
  if (existsSync(f)) {
    try {
      pkg = JSON.parse(readFileSync(f, "utf8"));
    } catch {
      pkg = null;
    }
  }
  const ajout = sourcesAjoutees(racine);
  if (!ajout.ok) {
    exit(
      2,
      `CAUSE=frontiere-illisible — ${ajout.motif} — l'INSTRUMENT, pas l'agent`,
    );
    return;
  }
  const v = jugerPorteClient(pkg, ajout.sources);
  if (v.code === 0) {
    console.log(`CAUSE=conforme — ${v.detail}`);
    process.exit(0);
  }
  exit(v.code, `CAUSE=${v.cause} — ${v.detail}`);
}

// Le juge ne s'exécute que LANCÉ, jamais IMPORTÉ — son auto-contrôle importe la
// règle pure pour l'éprouver sans monter d'application.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
