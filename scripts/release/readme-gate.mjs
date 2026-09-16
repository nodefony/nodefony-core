#!/usr/bin/env node
/**
 * **Refuse de publier quand un README de paquet ment à sa page npm.**
 *
 * Le README d'un paquet EST sa page npmjs.com, et il est FIGÉ pour la version
 * publiée : un défaut ne s'y rattrape qu'en republiant. C'est la seule surface
 * du dépôt dont la faute coûte un cran de version.
 *
 * ## Pourquoi ce contrôle existe
 *
 * La passe de la veille de la `10.0.0-alpha` (`4d942323`) a corrigé, sur les
 * quinze README publiables, **huit affirmations fausses et quatorze liens
 * morts** : `npm install @nodefony/core` (E404 — le paquet se nomme `nodefony`),
 * deux imports par défaut alors que le cœur n'exporte que du nommé, trois
 * commandes servant `latest` (qui pointe encore la lignée 7 en JavaScript), et
 * un symbole documenté que personne ne réexportait. Elle a été faite **à la
 * main**, et rien n'empêchait la même dérive de revenir au cran suivant.
 *
 * Le voisin le plus proche entretenait l'illusion d'une couverture :
 * `catalogue.test.ts` garde une page de documentation contre les paquets
 * fantômes — il ne lit aucun README de paquet publiable.
 *
 * ## Les familles d'écart, et pourquoi chacune
 *
 * - `LIEN-MORT` — un lien relatif dont la cible n'existe pas. Le cas le plus
 *   simple, et celui qu'on croit impossible parce qu'il marche dans le dépôt.
 * - `LIEN-HORS-TARBALL` — la cible existe ICI mais n'entre pas dans l'archive
 *   envoyée au registre. C'est le cas vicieux : le lien est vert au dépôt, mort
 *   sur npmjs.com. Quatorze des liens corrigés par `4d942323` étaient de
 *   ceux-là — `CLAUDE.md`, `MEMORY.md`, un paquet frère, des sources non
 *   publiées.
 * - `PAQUET-FANTOME` — une commande d'installation nomme un paquet du dépôt qui
 *   n'est pas publiable : le nom d'un workspace (`@nodefony/core`) ou d'un
 *   paquet `private`. La commande copiée depuis la page rend E404.
 * - `COMMANDE-SANS-CANAL` — une commande d'installation omet son dist-tag alors
 *   que `latest` ne sert pas encore la 10 : elle servirait la `7.0.2`, une
 *   lignée JavaScript sans rapport avec ce que la page décrit. La règle se
 *   DÉSARME d'elle-même le jour où `latest` bascule.
 * - `COMMANDE-DE-DEPOT` — un bloc à copier vise un WORKSPACE du monorepo
 *   (`--workspace=`, `--filter`). Personne n'a de workspace après
 *   `npm install` : la commande est injouable pour le lecteur de la page, et
 *   c'est le reste connu que la passe manuelle avait laissé
 *   (`@nodefony/user`, « npm run build --workspace=… » en guise d'installation).
 * - `SYMBOLE-ABSENT` — un `import { X } from "@nodefony/…"` dont `X` n'est pas
 *   exporté par l'index du paquet. C'est ce cas précis qui a laissé passer un
 *   import documenté vers `securityConfigJsonSchema`, jamais réexporté : le
 *   « Usage minimal » de la page échouait à sa première ligne.
 * - `IMPORT-DEFAUT` — un import par DÉFAUT depuis un paquet qui n'en a pas.
 *   Même tissu que le précédent, et constaté deux fois sur la page du cœur.
 *
 * ## Ce qui fait foi, et le bord connu
 *
 * La surface exportée est lue sur l'**index source du paquet**, pas sur
 * `.ai/symbols.json` : le graphe symbolique dit qu'un symbole est exporté par
 * SON FICHIER, ce qui ne dit rien de l'index — `securityConfigJsonSchema` y
 * figurait en `exported: true` tout en étant inatteignable depuis le paquet.
 * Il sert ici à la seule chose qu'il fait mieux : lever un doute quand l'index
 * échappe à la lecture.
 *
 * Et l'appartenance au tarball est constatée sur l'archive elle-même
 * (`npm pack --dry-run`), jamais déduite du champ `files` : les trois fichiers
 * ajoutés d'office par npm, les `.npmignore` et les globs de `files` sont des
 * règles qu'on réimplémenterait de travers.
 *
 * ## Codes de sortie
 *
 * - `0` — les quinze pages disent vrai.
 * - `1` — au moins un écart. La publication doit s'arrêter.
 * - `2` — **on n'a PAS PU regarder** (registre muet, index illisible). Ne pas
 *   savoir regarder n'est pas un verdict favorable. Un écart CONSTATÉ prime
 *   toujours : le code 1 gagne sur le code 2, sinon un contrôle à moitié aveugle
 *   masquerait la faute qu'il vient de trouver.
 *
 * @example
 * ```bash
 * node scripts/release/readme-gate.mjs                  # confronte au registre public
 * node scripts/release/readme-gate.mjs --json           # sortie machine
 * node scripts/release/readme-gate.mjs --dist-tags '{"latest":"7.0.2"}'
 * ```
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  COMMANDE,
  ligneDe,
  lireDistTags,
  zonesDeCode,
} from "./accueil-gate.mjs";

/**
 * Points d'injection — ils n'existent que pour rendre ce contrôle ÉPROUVABLE.
 * Hors test, les valeurs sont celles qu'elles ont toujours eues.
 */
const ROOT =
  process.env.NF_README_ROOT ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Les trois fichiers que npm ajoute à TOUT tarball, quoi que dise `files`.
 * Ils comptent donc comme des cibles de lien légitimes.
 */
const AJOUTES_DOFFICE = ["README.md", "LICENSE", "package.json"];

/** Un lien markdown inline dont la cible est capturée. */
const LIEN = /\]\(\s*<?([^)<>\s]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** Un lien markdown par référence : `[label]: cible`. */
const LIEN_REFERENCE = /^\s{0,3}\[[^\]]+\]:\s*<?([^\s<>]+)>?/gm;

/**
 * Une commande qui n'a de sens que DANS le monorepo. `--workspace` et `--filter`
 * sont des sélecteurs de dépôt : après `npm install`, ils ne désignent rien.
 */
const COMMANDE_DE_DEPOT =
  /\b(?:npm|pnpm|yarn|bun)\s+[^\n]*?(--workspace[= ]|--filter[= ])/g;

/** `import { A, B as C } from "…"` — y compris sur plusieurs lignes. */
const IMPORT_NOMME =
  /\bimport\s+(?:type\s+)?\{([^{}]*)\}\s*from\s*["']([^"']+)["']/g;

/** `import Truc from "…"` — l'import par DÉFAUT, avec ou sans accolade jointe. */
const IMPORT_DEFAUT =
  /\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^{}]*\})?\s*from\s*["']([^"']+)["']/g;

/**
 * Un motif global porte un `lastIndex` MUTABLE : le réutiliser d'un fichier à
 * l'autre reprend la lecture au milieu du suivant, et les occurrences sautées
 * ne laissent aucune trace. D'où ce clone à chaque parcours — le motif reste
 * défini en UN endroit, sans que son état voyage.
 *
 * @param motif - l'expression régulière partagée.
 * @returns une copie neuve, `lastIndex` à zéro.
 */
const neuf = (motif) => new RegExp(motif.source, motif.flags);

/**
 * Les workspaces destinés au registre, et ceux qui n'y vont pas.
 *
 * `npm query .workspace` est la source de vérité — la même que celle du pack :
 * une liste en dur se périmerait au premier module ajouté, et c'est exactement
 * la dérive que ce fichier existe pour empêcher.
 *
 * @param root - la racine du dépôt.
 * @returns `{ publiables, prives }`, chacun portant nom et dossier.
 */
function paquetsPubliables(root) {
  const workspaces = JSON.parse(
    execFileSync("npm", ["query", ".workspace", "--json"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    }),
  );
  const publiables = [];
  const prives = [];
  for (const w of workspaces) {
    const entree = { nom: w.name, dossier: path.resolve(root, w.location) };
    (w.private ? prives : publiables).push(entree);
  }
  return { publiables, prives };
}

/**
 * Les chemins que le tarball contiendra RÉELLEMENT.
 *
 * `--ignore-scripts` n'est pas une précaution de style : un `prepack` qui
 * bâtirait le paquet ferait de ce contrôle une compilation déguisée, lente et
 * capable d'échouer pour une raison qui ne le regarde pas.
 *
 * @param dossier - la racine du paquet.
 * @returns les chemins internes au tarball, préfixe `package/` retiré.
 */
function fichiersDuTarball(dossier) {
  const brut = execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: dossier,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const rendu = JSON.parse(brut);
  // npm a rendu un TABLEAU, puis un objet indexé par nom selon les versions :
  // lire les deux formes coûte une ligne et évite un gate aveugle au prochain npm.
  const entrees = Array.isArray(rendu) ? rendu : Object.values(rendu);
  const fichiers = new Set();
  for (const entree of entrees) {
    for (const f of entree?.files ?? []) fichiers.add(f.path);
  }
  return fichiers;
}

/** Retire commentaires de bloc et de ligne — un export commenté n'en est pas un. */
const sansCommentaires = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/**
 * La surface qu'un paquet expose depuis son index source.
 *
 * On lit l'index et rien d'autre : c'est lui qui décide ce qu'un `import`
 * atteint. Un `export *` rend la lecture incomplète — on le DIT plutôt que de
 * faire rougir un symbole qu'on n'a pas su suivre.
 *
 * Un paquet SANS index source (`create-nodefony` n'expose qu'un binaire) est lui
 * aussi déclaré non résolu — mais cela ne vaut avertissement que si un import le
 * vise réellement, sans quoi le contrôle rendrait « je n'ai pas pu regarder »
 * pour un paquet que personne n'importe, à chaque passage et pour toujours.
 *
 * @param dossier - la racine du paquet.
 * @returns `{ noms, defaut, aveugle }` — `aveugle` porte le motif quand la
 *   lecture ne conclut pas.
 */
function surfaceExportee(dossier) {
  const candidats = [
    path.join(dossier, "index.ts"),
    path.join(dossier, "src", "index.ts"),
  ];
  const index = candidats.find((f) => fs.existsSync(f));
  if (!index) {
    return { noms: new Set(), defaut: false, aveugle: "aucun index.ts trouvé" };
  }
  const source = sansCommentaires(fs.readFileSync(index, "utf8"));
  const noms = new Set();

  for (const m of source.matchAll(/\bexport\s+(?:type\s+)?\{([^{}]*)\}/g)) {
    for (const brut of m[1].split(",")) {
      // `A as B` n'expose que B ; `type A` n'expose que A.
      const nom = brut
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .pop();
      if (nom) noms.add(nom.trim());
    }
  }
  for (const m of source.matchAll(
    /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|class|function|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    noms.add(m[1]);
  }

  const defaut = /\bexport\s+default\b/.test(source);
  const aveugle = /\bexport\s+\*/.test(source)
    ? `${path.relative(dossier, index)} porte un « export * » — surface non résolue`
    : null;
  return { noms, defaut, aveugle };
}

/**
 * Le paquet visé par un spécificateur d'import, ou `null` pour un sous-chemin.
 *
 * Un sous-chemin (`nodefony/client`) a son propre index, que ce contrôle ne
 * résout pas : le déclarer inconnu vaut mieux que le juger sur la mauvaise
 * surface.
 */
function paquetDuSpecificateur(specificateur, connus) {
  if (connus.has(specificateur)) return specificateur;
  return null;
}

/**
 * Confronte UN README à ce que son paquet publie réellement.
 *
 * @param options.paquet - nom npm du paquet.
 * @param options.fichier - chemin du README, relatif à la racine, pour l'ancrage.
 * @param options.contenu - le markdown.
 * @param options.racinePaquet - dossier du paquet, pour résoudre les liens.
 * @param options.fichiersTarball - chemins réellement empaquetés.
 * @param options.publiables - noms npm que le registre sert.
 * @param options.surfaces - map nom de paquet → surface exportée.
 * @param options.exigeCanal - `true` tant que `latest` ne sert pas la 10.
 * @returns `{ ecarts, nonVerifies }` — les écarts ancrés `fichier:ligne`, et les
 *   surfaces qu'un import a rencontrées sans qu'on sache les lire.
 */
function confronterReadme({
  paquet,
  fichier,
  contenu,
  racinePaquet,
  fichiersTarball,
  publiables,
  surfaces,
  exigeCanal,
}) {
  const ecarts = [];
  const nonVerifies = new Set();
  const zones = zonesDeCode(contenu);
  const dansCode = (i) => zones.some(([d, f]) => i >= d && i < f);
  const ajoute = (famille, index, detail) =>
    ecarts.push({
      famille,
      paquet,
      fichier,
      ligne: ligneDe(contenu, index),
      detail,
    });

  // ── Liens relatifs ────────────────────────────────────────────────────────
  const dansLeTarball = (relatif) => {
    if (AJOUTES_DOFFICE.includes(relatif)) return true;
    if (fichiersTarball.has(relatif)) return true;
    // Un DOSSIER entre dans le tarball dès qu'un fichier vit dessous.
    const prefixe = relatif.endsWith("/") ? relatif : `${relatif}/`;
    for (const f of fichiersTarball) if (f.startsWith(prefixe)) return true;
    return false;
  };

  for (const motif of [neuf(LIEN), neuf(LIEN_REFERENCE)]) {
    for (const m of contenu.matchAll(motif)) {
      if (dansCode(m.index)) continue;
      const brut = m[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(brut)) continue;
      const cible = brut.split("#")[0].split("?")[0];
      if (!cible) continue;
      const absolu = path.resolve(racinePaquet, cible);
      const relatif = path
        .relative(racinePaquet, absolu)
        .split(path.sep)
        .join("/");
      if (!fs.existsSync(absolu)) {
        ajoute("LIEN-MORT", m.index, `« ${brut} » ne désigne aucun fichier`);
        continue;
      }
      if (relatif.startsWith("..") || !dansLeTarball(relatif)) {
        ajoute(
          "LIEN-HORS-TARBALL",
          m.index,
          `« ${brut} » existe au dépôt mais n'entre pas dans le tarball — mort sur npmjs.com`,
        );
      }
    }
  }

  // ── Commandes d'installation ──────────────────────────────────────────────
  for (const m of contenu.matchAll(neuf(COMMANDE))) {
    const [texte, cite, tag] = m;
    // `npm create nodefony` installe `create-nodefony` : c'est le VERBE qui dit
    // quel paquet part au registre, pas le nom écrit.
    const vise = /\bcreate\b/.test(texte) ? `create-${cite}` : cite;
    if (!publiables.has(vise)) {
      ajoute(
        "PAQUET-FANTOME",
        m.index,
        `« ${texte.trim()} » installe « ${vise} », que le registre ne sert pas`,
      );
      continue;
    }
    if (exigeCanal && !tag && dansCode(m.index)) {
      ajoute(
        "COMMANDE-SANS-CANAL",
        m.index,
        `« ${texte.trim()} » omet son dist-tag — « latest » sert encore la lignée 7`,
      );
    }
  }

  for (const m of contenu.matchAll(neuf(COMMANDE_DE_DEPOT))) {
    if (!dansCode(m.index)) continue;
    ajoute(
      "COMMANDE-DE-DEPOT",
      m.index,
      `« ${m[0].trim()} » vise un workspace du monorepo — injouable après « npm install »`,
    );
  }

  // ── Symboles importés ─────────────────────────────────────────────────────
  const juger = (specificateur, index, verifier) => {
    const vise = paquetDuSpecificateur(specificateur, surfaces);
    if (!vise) return;
    const surface = surfaces.get(vise);
    if (surface.aveugle) {
      nonVerifies.add(`${vise} — ${surface.aveugle}`);
      return;
    }
    verifier(surface, vise);
  };

  for (const m of contenu.matchAll(neuf(IMPORT_NOMME))) {
    if (!dansCode(m.index)) continue;
    juger(m[2], m.index, (surface, vise) => {
      for (const brut of m[1].split(",")) {
        const nom = brut
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0];
        if (!nom || surface.noms.has(nom.trim())) continue;
        ajoute(
          "SYMBOLE-ABSENT",
          m.index,
          `« ${nom.trim()} » n'est pas exporté par ${vise} — l'import documenté échoue`,
        );
      }
    });
  }

  for (const m of contenu.matchAll(neuf(IMPORT_DEFAUT))) {
    if (!dansCode(m.index)) continue;
    juger(m[2], m.index, (surface, vise) => {
      if (surface.defaut) return;
      ajoute(
        "IMPORT-DEFAUT",
        m.index,
        `« import ${m[1]} from "${vise}" » — ce paquet n'a pas d'export par défaut`,
      );
    });
  }

  return { ecarts, nonVerifies: [...nonVerifies] };
}

/**
 * Lance le contrôle sur les README publiables du dépôt.
 *
 * @param argv - arguments de ligne de commande.
 * @returns le code de sortie : 0, 1 ou 2.
 */
async function principal(argv) {
  const json = argv.includes("--json");
  const iTags = argv.indexOf("--dist-tags");
  const tags =
    iTags >= 0 && argv[iTags + 1]
      ? JSON.parse(argv[iTags + 1])
      : await lireDistTags("nodefony");

  const aveugles = [];
  // `latest` sert-il déjà la 10 ? Tant que non, toute commande doit nommer son
  // canal. La question se pose UNE fois : les quinze paquets basculent ensemble.
  let exigeCanal = true;
  if (!tags?.latest) {
    exigeCanal = false;
    aveugles.push(
      "le registre n'a rendu aucun dist-tag — la règle du canal n'a pas pu être appliquée",
    );
  } else if (tags.latest.startsWith("10.")) {
    exigeCanal = false;
  }

  const { publiables, prives } = paquetsPubliables(ROOT);
  const noms = new Set(publiables.map((p) => p.nom));
  const surfaces = new Map();
  for (const p of publiables) surfaces.set(p.nom, surfaceExportee(p.dossier));

  const ecarts = [];
  for (const p of publiables) {
    const readme = path.join(p.dossier, "README.md");
    if (!fs.existsSync(readme)) {
      ecarts.push({
        famille: "README-ABSENT",
        paquet: p.nom,
        fichier: path.relative(ROOT, readme).split(path.sep).join("/"),
        ligne: 0,
        detail: "un paquet publié SANS page npm",
      });
      continue;
    }
    const vu = confronterReadme({
      paquet: p.nom,
      fichier: path.relative(ROOT, readme).split(path.sep).join("/"),
      contenu: fs.readFileSync(readme, "utf8"),
      racinePaquet: p.dossier,
      fichiersTarball: fichiersDuTarball(p.dossier),
      publiables: noms,
      surfaces,
      exigeCanal,
    });
    ecarts.push(...vu.ecarts);
    aveugles.push(...vu.nonVerifies);
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          paquets: publiables.length,
          prives: prives.length,
          exigeCanal,
          aveugles,
          ecarts,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `README publiés — ${publiables.length} paquets contrôlés (${prives.length} privés écartés)`,
    );
    for (const e of ecarts) {
      console.error(`  ✗ ${e.famille}  ${e.fichier}:${e.ligne}  ${e.detail}`);
    }
    for (const a of aveugles) console.error(`  ? NON VÉRIFIÉ — ${a}`);
    if (!ecarts.length && !aveugles.length) {
      console.log(
        "\n✅ chaque page npm dit vrai — liens, commandes et imports.",
      );
    }
  }

  // Un écart CONSTATÉ prime sur une lecture incomplète : l'inverse masquerait la
  // faute qu'on vient de trouver derrière un « je n'ai pas pu regarder ».
  if (ecarts.length) {
    if (!json) {
      console.error(
        `\n${ecarts.length} écart(s). Un README est figé pour la version publiée : ` +
          `le corriger AVANT de publier, ou republier un cran pour rien.`,
      );
    }
    return 1;
  }
  return aveugles.length ? 2 : 0;
}

// Axiome de portabilité : on compare des URL, jamais des chemins — sous Windows
// `D:\…` se lirait comme un protocole, et la comparaison serait faussée sans erreur.
const lanceDirectement =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (lanceDirectement) {
  try {
    process.exitCode = await principal(process.argv.slice(2));
  } catch (erreur) {
    console.error(`\n✗ CONTRÔLE AVEUGLE — ${erreur.message}\n`);
    process.exitCode = 2;
  }
}

export {
  confronterReadme,
  surfaceExportee,
  paquetsPubliables,
  fichiersDuTarball,
  principal,
  AJOUTES_DOFFICE,
};
