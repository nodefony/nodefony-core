import fs from "node:fs";
import path from "node:path";
import { judgeIdentifier } from "../../nodefony-identifiers/scripts/check-identifier-language.mjs";

/**
 * Dérive des SYMBOLES cités par les fichiers d'instructions (`CLAUDE.md`,
 * `MEMORY.md`) après un renommage du français vers l'anglais.
 *
 * Le problème que ça ferme : `check:lang` a renommé le CODE, et les pages qui
 * le DÉCRIVENT sont restées sur l'ancien nom. Un agent lit « primitives pures :
 * `controlesSautes` », le cherche, et ne le trouve nulle part.
 *
 * **Pourquoi ce périmètre, et pas « tout symbole absent du code »** — c'est
 * mesuré, pas supposé. Sur 55 symboles cités qui n'existent nulle part, **49
 * étaient des mentions parfaitement légitimes** : un retrait énoncé en toutes
 * lettres (« moteur Eta — pas de `renderTwig`/`renderEjs` », « `getCspDirectives`
 * N'EXISTE PAS », « Drop au rétro-fit »), un travail futur (« aucun
 * `KafkaBackplane` n'est codé »), une faute de frappe corrigée dont la page garde
 * la trace (« ← was `ckeckPath` »), ou un nom venu d'ailleurs (`ServiceAccount`,
 * `PasswordAuthenticatedUserInterface`, emprunté à Symfony). Signaler ces 49-là
 * apprendrait à passer outre, y compris le jour où le gate a raison.
 *
 * Un identifiant FRANÇAIS absent du code, lui, n'a aucune de ces lectures : le
 * dépôt s'interdit d'en écrire, donc il a forcément été renommé — et la page ne
 * l'a pas suivi. Le dictionnaire est celui de `check:lang`, jamais une copie :
 * deux copies d'une règle divergent en silence.
 *
 * Le critère d'ABSENCE, lui, reste le plus large qui soit : le nom apparaît-il
 * quelque part dans les sources ? Chercher une déclaration (`class X`, `const X`)
 * raterait toute méthode (`onBoot() {}`) et tout champ (`createdAt: …`), qu'aucun
 * mot-clé n'introduit — mesuré, ce resserrement produisait 1140 faux positifs.
 */

const IGNORES = new Set([
  "node_modules",
  "dist",
  ".turbo",
  "coverage",
  ".coverage",
  ".vite",
  "session-retros",
  "archive",
  "archives",
]);

const SOURCES = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|json)$/u;
const MOT = /[A-Za-z_$][A-Za-z0-9_$]*/gu;

/**
 * Ce qu'un symbole absent du code peut légitimement être. Une exception se
 * DÉCLARE avec son motif : une liste de noms nus se périmerait sans que
 * personne sache pourquoi chacun y est.
 *
 * Ce qui n'a PAS sa place ici : un symbole qu'on a renommé ou supprimé, et dont
 * la page parle encore au présent. C'est précisément ce que le contrôle existe
 * pour attraper — l'inscrire ici le désarmerait.
 */
export const EXCEPTIONS = new Map([
  ["AskUserQuestion", "outil du harnais Claude Code, pas du code du dépôt"],
  ["maxTurns", "réglage d'un agent Claude Code, pas du code du dépôt"],
]);

/**
 * Tous les identifiants présents dans les sources, sous un dossier.
 *
 * @param dir - la racine à descendre.
 * @param index - le Set à remplir (créé si absent).
 * @returns le Set des identifiants rencontrés.
 */
export const indexerIdentifiants = (dir, index = new Set()) => {
  let entrees;
  try {
    entrees = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return index;
  }
  for (const e of entrees) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith(".") && !IGNORES.has(e.name))
        indexerIdentifiants(abs, index);
      continue;
    }
    if (!SOURCES.test(e.name)) continue;
    let src;
    try {
      src = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    for (const m of src.matchAll(MOT)) index.add(m[0]);
  }
  return index;
};

/**
 * Un candidat SYMBOLE : PascalCase d'au moins deux segments, ou camelCase avec
 * une majuscule interne. Exclut les mots d'une seule casse — français, noms de
 * commandes, clés de configuration —, qui ne se résolvent pas contre du code.
 */
const CANDIDAT =
  /^(?:[A-Z][a-z0-9]+){2,}$|^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)+$/u;

/**
 * Les symboles qu'une page cite et que le code ne porte plus.
 *
 * @param markdown - le contenu de la page.
 * @param index - les identifiants présents dans les sources.
 * @returns les noms fantômes, dédupliqués, dans l'ordre d'apparition.
 */
export const symbolesFantomes = (markdown, index) => {
  const vus = new Set();
  const fantomes = [];
  for (const m of markdown.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/gu)) {
    const nom = m[1];
    if (vus.has(nom)) continue;
    vus.add(nom);
    if (nom.length < 6 || !CANDIDAT.test(nom)) continue;
    if (EXCEPTIONS.has(nom) || index.has(nom)) continue;
    // Absent du code ET français : il a été renommé, la page ne l'a pas suivi.
    const { words, suggestion } = judgeIdentifier(nom);
    if (!words.length) continue;
    fantomes.push(suggestion ? `${nom} (renommé en \`${suggestion}\` ?)` : nom);
  }
  return fantomes;
};
