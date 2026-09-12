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
import { exit } from "./http-probe.mjs";
import { motifPorteClient, porteClientDe } from "./tache-zero.mjs";

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
  const sources = sourcesDe(racine).map((p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return "";
    }
  });
  const v = jugerPorteClient(pkg, sources);
  if (v.code === 0) {
    console.log(`CAUSE=conforme — ${v.detail}`);
    process.exit(0);
  }
  exit(v.code, `CAUSE=${v.cause} — ${v.detail}`);
}

// Le juge ne s'exécute que LANCÉ, jamais IMPORTÉ — son auto-contrôle importe la
// règle pure pour l'éprouver sans monter d'application.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
