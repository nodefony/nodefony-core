#!/usr/bin/env node
/**
 * Gate — les IDENTIFIANTS du code de production s'écrivent en anglais.
 *
 * La règle vit dans le `CLAUDE.md` racine (« LE CODE S'ÉCRIT EN ANGLAIS — la
 * prose en français ») : classe, méthode, fonction, variable, type, champ,
 * constante, clé de configuration → anglais ; TSDoc, commentaires, titres de
 * test, messages affichés → français. Le code part sur npm, entre dans les
 * `.d.ts`, s'affiche dans l'autocomplétion de gens qui ne parlent pas français
 * et se cherche au `grep` par des agents entraînés sur de l'anglais :
 * `controlesSautes` ne se trouve pas en cherchant `skipped`.
 *
 * Pourquoi pas `cspell` : il juge l'ORTHOGRAPHE, pas la LANGUE. `rendreRapport`
 * est composé de deux mots français parfaitement orthographiés ; et un
 * dictionnaire anglais seul crierait sur `argv`, `oxlint`, `rolldown` et des
 * centaines de noms propres. La question posée ici est « ce mot est-il du
 * français qu'un développeur francophone emploie en NOMMANT du code ? » — elle
 * se répond avec un dictionnaire de mots DISCRIMINANTS, constitué à la main.
 *
 * Ce que le script fait, dans l'ordre :
 *  1. balaie les sources de PRODUCTION — TypeScript, JavaScript et shell : la
 *     règle porte sur le CODE, pas sur un langage (les tests, `dist`,
 *     `node_modules`,
 *     `templates` et `coverage` sont hors périmètre — les tests sont EXEMPTÉS
 *     pour leurs identifiants locaux, les gabarits portent des balises) ;
 *  2. BLANCHIT commentaires, chaînes et littéraux de gabarit — c'est là que le
 *     français est légitime, et c'est le faux positif qui tuerait l'outil ;
 *  3. extrait les identifiants DÉCLARÉS (fonction, classe, interface, type,
 *     enum, const/let/var, méthode, propriété, paramètre, membre de
 *     destructuration, clause `catch`) — jamais les accès `obj.x`, qui peuvent
 *     venir d'une bibliothèque tierce ;
 *  4. découpe chaque identifiant en mots (camelCase, PascalCase, snake_case,
 *     SCREAMING_SNAKE, acronymes, chiffres) et confronte chaque mot au
 *     dictionnaire — formes sans accent, pluriels en `s`/`x` compris ;
 *  5. applique les exceptions déclarées et DIT combien il en a appliquées :
 *     une exception muette est une règle qu'on croit appliquée et qui ne l'est
 *     plus.
 *
 * Zéro dépendance : pas de parseur TypeScript. Le blanchiment est un petit
 * automate à états (il sait qu'une chaîne ne franchit pas une ligne, qu'un
 * littéral de gabarit contient du code dans ses `${}`, et qu'un `/` après une
 * parenthèse fermante divise au lieu d'ouvrir une expression régulière) ; le
 * reste est de l'expression régulière sur du texte débarrassé de sa prose.
 *
 * @usage   node scripts/check-identifier-language.mjs [chemins…]
 * @usage   node scripts/check-identifier-language.mjs --json
 * @usage   node scripts/check-identifier-language.mjs --exceptions mes-exceptions.json
 * @output  `fichier:ligne  identifiant  ← mot(s) français  → suggestion` ;
 *          sortie 1 dès qu'un identifiant sort, 0 sinon, 2 sur erreur d'usage.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tables du dictionnaire, chargées depuis le JSON voisin.
 *
 * `readFileSync` plutôt qu'un `import ... with { type: "json" }` : le chemin
 * est résolu depuis `import.meta.url`, donc juste quel que soit le répertoire
 * courant de l'appelant, et sans dépendre du support d'attributs d'import.
 */
const DICTIONARY = JSON.parse(
  readFileSync(
    new URL("./identifier-language-dictionary.json", import.meta.url),
    "utf8",
  ),
);

// ═══════════════════════════════════════════════════════════════════════════
// 1. DICTIONNAIRE — le cœur du gate, et le seul endroit où l'on JUGE.
//
// 🔴 Les tables vivent dans `identifier-language-dictionary.json`, PAS ici, et
// c'est une nécessité, pas un rangement. Écrites en JavaScript, leurs clés
// (`rendre: "render"`) sont des DÉCLARATIONS de propriété : le gate les
// extrayait comme des identifiants et se dénonçait lui-même — 404 constats,
// tous sur son propre corpus de traduction. Les quoter ne tient pas non plus,
// le formateur du dépôt retire les guillemets superflus (vérifié). En JSON,
// un mot du dictionnaire redevient ce qu'il est : une DONNÉE.
//
// Critère d'entrée d'un mot : un développeur francophone l'emploie VRAIMENT en
// nommant du code, ET un développeur anglophone ne l'emploierait PAS, seul,
// dans un identifiant. Le second critère est le discriminant : `content`,
// `page`, `route`, `format` sont français ET anglais avec le même sens — les
// garder ferait crier le gate sur du code irréprochable, et un gate qui crie
// faux apprend à passer outre.
//
// Les mots sont écrits SANS accent : un identifiant n'en porte jamais en
// pratique (`controle`, `sautes`, `donnees`), et le mot lu est lui aussi
// désaccentué avant la comparaison — les deux graphies se rejoignent.
//
// Les pluriels ne sont pas listés : `s` et `x` finaux sont retirés à la lecture
// (`controles` → `controle`, `jeux` → `jeu`). Les féminins et participes le
// sont quand ils diffèrent (`saute`/`sautee`, `ouvert`/`ouverte`).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mots français discriminants, par famille d'usage. Chaque famille est un
 * tableau pour pouvoir être relue et discutée ; l'ensemble est aplati en un
 * `Set` juste après.
 */
const FRENCH_WORDS = DICTIONARY.frenchWords;

/**
 * Mots français que le dictionnaire REFUSE délibérément, avec la raison : ils
 * existent aussi en anglais (même sens ou sens différent), ou un développeur
 * anglophone les emploie seuls dans un identifiant. La liste est éprouvée par
 * le test (« aucun exclu ne réapparaît ») pour qu'un ajout distrait ne fasse
 * pas crier le gate sur du code irréprochable.
 *
 * Elle documente le JUGEMENT ; le code ne la lit pas.
 */
export const EXCLUDED_HOMOGRAPHS = DICTIONARY.excludedHomographs;

/** Le dictionnaire aplati : mots sans accent, en minuscules. */
export const FRENCH_DICTIONARY = new Set(
  Object.values(FRENCH_WORDS)
    .flat()
    .map((w) => normalizeWord(w)),
);

/**
 * Formes anglaises qu'un retrait de pluriel ramènerait par ACCIDENT sur un mot
 * du dictionnaire : `classes` → `classe`, `branches` → `branche`, `indices` →
 * `indice`. Vérifiées AVANT la règle du pluriel, jamais après. Deux cas sont
 * traités par STRUCTURE plutôt que par liste : un mot en `-ss` n'est jamais un
 * pluriel français (`success` ≠ `succes` + s, `gross` ≠ `gros` + s), et un mot
 * en `-ies` est presque toujours un pluriel anglais (cf `FRENCH_IES_PLURALS`).
 */
const ENGLISH_INFLECTIONS = new Set(DICTIONARY.englishInflections);

/**
 * Pluriels français en `-ies` acceptés — ailleurs, `-ies` est le pluriel
 * ANGLAIS d'un mot en `-y` (`copies`, `categories`, `strategies`, `replies`),
 * et le stem en `-ie` qu'il laisse (`copie`, `categorie`) est aussi du français.
 * L'ambiguïté est symétrique ; on tranche pour l'anglais, sauf ici.
 */
const FRENCH_IES_PLURALS = new Set(DICTIONARY.frenchIesPlurals);

/**
 * Suggestions de traduction, mot à mot, pour les cas où elle est évidente. Une
 * suggestion n'est proposée pour un identifiant ENTIER que si chacun de ses
 * mots français en a une — une traduction à moitié induirait en erreur.
 */
const SUGGESTIONS = DICTIONARY.suggestions;

/**
 * Exceptions appliquées par DÉFAUT, chacune avec sa raison — ce que le JSON
 * d'un `--exceptions` ne peut pas porter et qu'on garde ici.
 *
 * `path` : préfixe de chemin (en `/`, relatif à la racine du dépôt) dont TOUS
 * les identifiants sont tolérés. `identifier` : un nom exact toléré partout.
 * Les deux combinés : ce nom, dans ce préfixe.
 */
export const DEFAULT_EXCEPTIONS = [
  {
    path: "src/modules/test/nodefony/entity/benchOrm.ts",
    reason:
      "tables `llx_societe` / `llx_facture` du banc ORM : noms de tables et de " +
      "colonnes Dolibarr, contrat avec la base adoptée (même raison que le dossier).",
  },
  {
    path: "src/modules/test/nodefony/entity/dolibarr/",
    reason:
      "miroir du schéma Dolibarr (ERP français) — les colonnes `datec`, " +
      "`fk_user_creat`, `libelle` sont un CONTRAT avec la base adoptée, pas un " +
      "choix de nommage ; le banc ORM les lit telles quelles.",
  },
  {
    path: "src/nodefony/src/cli/helpReport.ts",
    identifier: "LANCER",
    reason:
      "clé de DONNÉES, pas identifiant : chaque commande déclare son groupe " +
      'par la chaîne `group: "LANCER"`, que rien ne relie à la clé — ni ' +
      "TypeScript, ni ce gate. La renommer a fait disparaître deux groupes du " +
      "menu interactif. L'angliciser suppose de changer un contrat de données.",
  },
  {
    path: "src/nodefony/src/cli/helpReport.ts",
    identifier: "COMPRENDRE",
    reason: "même contrat de données que `LANCER` ci-dessus.",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 2. MOTS — normalisation, découpage, décision.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ramène un mot à sa forme comparable : minuscules, sans diacritique.
 *
 * @param word - mot brut, accentué ou non
 * @returns le mot en minuscules ASCII (`contrôlé` → `controle`)
 */
export function normalizeWord(word) {
  return word.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Découpe un identifiant en mots, quelle que soit sa convention.
 *
 * `renderReport` → `["render", "Report"]` ; `HTTPServer` → `["HTTP", "Server"]` ;
 * `MAX_RETRY_COUNT` → `["MAX", "RETRY", "COUNT"]` ; `utf8Decode` →
 * `["utf", "8", "Decode"]`. Les préfixes `_`, `$`, `#` sont ignorés, les
 * chiffres deviennent des mots à part (qu'aucun dictionnaire ne contient).
 *
 * @param identifier - l'identifiant tel qu'écrit dans le code
 * @returns les mots, dans l'ordre, avec leur casse d'origine
 */
export function splitIdentifier(identifier) {
  const words = [];
  for (const part of identifier.split(/[_$#]+/)) {
    if (!part) continue;
    // Acronyme (suivi d'une minuscule ou de la fin), mot capitalisé ou
    // minuscule, suite de chiffres — les trois alternatives sont disjointes.
    for (const m of part.matchAll(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g))
      words.push(m[0]);
  }
  return words;
}

/**
 * Dit si un mot est du français discriminant, et lequel.
 *
 * Retourne le mot du dictionnaire atteint (forme de base, sans accent) ou
 * `null`. Un mot de moins de trois lettres n'est jamais retenu ; une forme
 * anglaise connue (`series`) n'est jamais ramenée à un mot français par la
 * règle du pluriel.
 *
 * @param word - un mot issu de `splitIdentifier`
 * @returns le mot du dictionnaire, ou `null`
 */
export function frenchWordOf(word) {
  const w = normalizeWord(word);
  if (w.length < 3) return null;
  if (FRENCH_DICTIONARY.has(w)) return w;
  if (ENGLISH_INFLECTIONS.has(w)) return null;
  // Pluriel régulier (`controles`) — jamais sur `-ss`, ni sur `-ies` hors liste.
  const pluralCandidate =
    w.endsWith("s") &&
    w.length > 3 &&
    !w.endsWith("ss") &&
    (!w.endsWith("ies") || FRENCH_IES_PLURALS.has(w));
  if (pluralCandidate && FRENCH_DICTIONARY.has(w.slice(0, -1)))
    return w.slice(0, -1);
  // Pluriel en `x` (`jeux`), et `-aux` d'un `-al` (`canaux`).
  if (w.endsWith("x") && w.length > 3 && FRENCH_DICTIONARY.has(w.slice(0, -1)))
    return w.slice(0, -1);
  if (w.endsWith("aux") && FRENCH_DICTIONARY.has(w.slice(0, -3) + "al"))
    return w.slice(0, -3) + "al";
  return null;
}

/**
 * Juge un identifiant : retourne les mots français qu'il contient, avec leur
 * traduction quand elle est connue.
 *
 * @param identifier - l'identifiant déclaré
 * @returns `{ words: [{ word, french, suggestion }], suggestion }` ; `words`
 *   vide quand l'identifiant est en anglais. `suggestion` n'est posée que si
 *   CHAQUE mot français a une traduction.
 */
export function judgeIdentifier(identifier) {
  const parts = splitIdentifier(identifier);
  const words = [];
  const translated = [];
  let complete = true;
  for (const part of parts) {
    const french = frenchWordOf(part);
    if (french === null) {
      translated.push(part);
      continue;
    }
    let suggestion = SUGGESTIONS[french] ?? null;
    if (suggestion !== null) {
      // Pluriel français → pluriel anglais, sauf pour un participe déjà en -ed.
      const n = normalizeWord(part);
      if (
        n !== french &&
        n.endsWith("s") &&
        !suggestion.endsWith("ed") &&
        !suggestion.endsWith("s")
      )
        suggestion = /[^aeiou]y$/.test(suggestion)
          ? suggestion.slice(0, -1) + "ies"
          : suggestion + "s";
      translated.push(matchCase(part, suggestion));
    } else complete = false;
    words.push({ word: part, french, suggestion });
  }
  if (words.length === 0) return { words, suggestion: null };
  let suggestion = null;
  if (complete) {
    const prefix = /^[_$#]*/.exec(identifier)[0];
    const glue = identifier.includes("_") ? "_" : "";
    suggestion = prefix + translated.join(glue);
  }
  return { words, suggestion };
}

/** Reproduit la casse du mot d'origine sur sa traduction. */
function matchCase(original, translation) {
  if (/^[A-Z0-9]+$/.test(original) && original.length > 1)
    return translation.toUpperCase();
  if (/^[A-Z]/.test(original))
    return translation[0].toUpperCase() + translation.slice(1);
  return translation;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. BLANCHIMENT — retirer la prose (commentaires, chaînes, gabarits, regex)
//    en préservant les positions, donc les numéros de ligne.
// ═══════════════════════════════════════════════════════════════════════════

/** Mots-clés après lesquels un `/` ouvre une expression régulière. */
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "yield",
  "await",
  "instanceof",
]);

/**
 * Remplace commentaires, chaînes, littéraux de gabarit et expressions
 * régulières par des espaces, en gardant chaque retour à la ligne à sa place.
 *
 * Le code des `${…}` d'un gabarit est CONSERVÉ (il peut déclarer des
 * identifiants). Une chaîne ou une regex qui ne se referme pas avant la fin de
 * sa ligne est traitée comme du code ordinaire — c'est ce qui rend l'automate
 * tolérant au texte JSX (`It's here`) et aux divisions.
 *
 * @param source - le texte d'un fichier TypeScript
 * @returns le même texte, la prose remplacée par des blancs
 */
export function stripProse(source) {
  const out = source.split("");
  const n = source.length;
  // Pile des gabarits ouverts : profondeur d'accolades de l'expression courante.
  const templateStack = [];
  let i = 0;

  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const lastCodeChar = (pos) => {
    for (let k = pos - 1; k >= 0; k--) {
      const c = out[k];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") continue;
      return { char: c, index: k };
    }
    return null;
  };
  const regexAllowedAt = (pos) => {
    const prev = lastCodeChar(pos);
    if (prev === null) return true;
    const { char, index } = prev;
    if (char === ")" || char === "]" || char === "}") return false;
    if (/[\w$]/.test(char)) {
      let s = index;
      while (s >= 0 && /[\w$]/.test(out[s])) s--;
      const word = out.slice(s + 1, index + 1).join("");
      return REGEX_PRECEDING_KEYWORDS.has(word);
    }
    // `</` : balise JSX fermante, jamais une regex.
    if (char === "<") return false;
    return true;
  };

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      let j = i;
      while (j < n && source[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && next === "*") {
      let j = source.indexOf("*/", i + 2);
      j = j === -1 ? n : j + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== "\n") {
        if (source[j] === "\\") j++;
        j++;
      }
      if (source[j] === c) {
        blank(i, j + 1);
        i = j + 1;
      } else i++; // non refermée sur la ligne : un simple caractère (JSX, apostrophe)
      continue;
    }
    if (c === "`") {
      templateStack.push(0);
      i = consumeTemplateText(i + 1);
      continue;
    }
    if (templateStack.length > 0) {
      const top = templateStack.length - 1;
      if (c === "{") templateStack[top]++;
      else if (c === "}") {
        if (templateStack[top] === 0) {
          i = consumeTemplateText(i + 1); // referme le gabarit ou s'arrête au `${` suivant
          continue;
        }
        templateStack[top]--;
      }
    }
    if (c === "/" && regexAllowedAt(i)) {
      let j = i + 1;
      let inClass = false;
      while (j < n && source[j] !== "\n") {
        const d = source[j];
        if (d === "\\") {
          j += 2;
          continue;
        }
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) break;
        j++;
      }
      if (source[j] === "/") {
        j++;
        while (j < n && /[a-z]/.test(source[j])) j++;
        blank(i, j);
        i = j;
        continue;
      }
      // pas refermée : une division, on avance d'un caractère
    }
    i++;
  }
  return out.join("");

  /** Blanchit la partie TEXTE d'un gabarit jusqu'au prochain `${` ou `` ` ``. */
  function consumeTemplateText(from) {
    let j = from;
    while (j < n) {
      const d = source[j];
      if (d === "\\") {
        j += 2;
        continue;
      }
      if (d === "`") {
        blank(from, j + 1);
        templateStack.pop();
        return j + 1;
      }
      if (d === "$" && source[j + 1] === "{") {
        blank(from, j + 2);
        return j + 2; // le code de l'expression reste visible
      }
      j++;
    }
    blank(from, n);
    templateStack.pop();
    return n;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. EXTRACTION — les identifiants DÉCLARÉS, et eux seuls.
// ═══════════════════════════════════════════════════════════════════════════

const KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "return",
  "new",
  "typeof",
  "instanceof",
  "void",
  "delete",
  "throw",
  "case",
  "default",
  "else",
  "do",
  "try",
  "finally",
  "class",
  "const",
  "let",
  "var",
  "import",
  "export",
  "from",
  "as",
  "in",
  "of",
  "this",
  "super",
  "constructor",
  "await",
  "async",
  "yield",
  "static",
  "get",
  "set",
  "public",
  "private",
  "protected",
  "readonly",
  "abstract",
  "override",
  "declare",
  "type",
  "interface",
  "enum",
  "namespace",
  "extends",
  "implements",
  "true",
  "false",
  "null",
  "undefined",
  "with",
  "debugger",
  "satisfies",
  "keyof",
  "infer",
  "is",
  "asserts",
  "unique",
  "symbol",
  "any",
  "unknown",
  "never",
  "string",
  "number",
  "boolean",
  "object",
  "bigint",
  "accessor",
  "module",
  "require",
  "global",
  "break",
  "continue",
  "label",
  "out",
]);

const MODIFIERS =
  "(?:(?:export|default|declare|abstract|public|private|protected|static|readonly|override|accessor|async|get|set)\\s+)*";
const IDENT = "[A-Za-z_$][\\w$]*";

const ARROW_PRECEDING_WORDS = new Set([
  ...REGEX_PRECEDING_KEYWORDS,
  "async",
  "default",
  "export",
  "as",
  "satisfies",
  "extends",
  "implements",
]);

/** Dernier caractère non blanc avant `pos`, avec sa position. */
function lastNonBlank(text, pos) {
  for (let k = pos - 1; k >= 0; k--)
    if (!/\s/.test(text[k])) return { char: text[k], index: k };
  return null;
}

/** Le mot (`[\w$]+`) qui se termine à `index` inclus. */
function wordEndingAt(text, index) {
  let s = index;
  while (s >= 0 && /[\w$]/.test(text[s])) s--;
  return text.slice(s + 1, index + 1);
}

/** Position → numéro de ligne (1-based), par table des retours à la ligne. */
function lineIndexer(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++)
    if (text[i] === "\n") starts.push(i + 1);
  return (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** Index de la parenthèse/accolade/crochet fermant `open` ouvert à `from`. */
function matchBracket(text, from, open, close) {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return i;
  }
  return -1;
}

/** Sépare une liste sur les virgules de profondeur zéro (tous crochets confondus). */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[" || c === "{" || c === "<") depth++;
    else if (c === ")" || c === "]" || c === "}" || c === ">") depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Coupe `text` au premier `sep` de profondeur zéro ; `[avant, après|null]`. */
function cutTopLevel(text, sep) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[" || c === "{" || c === "<") depth++;
    else if (c === ")" || c === "]" || c === "}" || c === ">") depth--;
    else if (
      c === sep &&
      depth === 0 &&
      !(sep === "=" && (text[i + 1] === ">" || text[i + 1] === "="))
    )
      return [text.slice(0, i), text.slice(i + 1)];
  }
  return [text, null];
}

/**
 * Extrait les identifiants LIÉS par un motif de paramètre ou de destructuration.
 *
 * `{ a, b: c, ...rest } = x` lie `a`, `c`, `rest` ; `[d, e = 1]` lie `d`, `e` ;
 * `private readonly f: T` lie `f`. Un motif imbriqué est parcouru récursivement.
 *
 * @param pattern - le texte du motif, sans parenthèses englobantes
 * @param offset - position du motif dans le fichier (pour la ligne)
 * @param push - collecteur `(name, position)`
 */
function bindingsOf(pattern, offset, push) {
  for (const raw of splitTopLevel(pattern)) {
    let local = offset;
    let part = raw;
    // Défaut, puis annotation de type — toujours dans cet ordre : `a: T = 1`.
    [part] = cutTopLevel(part, "=");
    [part] = cutTopLevel(part, ":");
    // Sauf destructuration `{ key: alias }`, où la partie droite est le nom lié.
    const trimmed = part.trim();
    const leading = raw.indexOf(trimmed);
    local += leading < 0 ? 0 : leading;
    if (trimmed === "") {
      offset += raw.length + 1;
      continue;
    }
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const close = trimmed.startsWith("{") ? "}" : "]";
      const end = matchBracket(trimmed, 0, trimmed[0], close);
      const inner = trimmed.slice(1, end < 0 ? undefined : end);
      // Dans `{ key: alias }`, on veut l'alias : la coupe sur `:` ci-dessus a
      // été faite sur la partie AVANT le motif, donc `inner` est intact.
      for (const entry of splitTopLevel(inner)) {
        let [lhs, rhs] = cutTopLevel(entry, ":");
        const entryOffset = local + 1 + inner.indexOf(entry);
        if (rhs !== null) {
          [rhs] = cutTopLevel(rhs, "=");
          bindingsOf(rhs, entryOffset + lhs.length + 1, push);
        } else bindingsOf(lhs, entryOffset, push);
      }
    } else {
      const m =
        /^(?:\.\.\.)?\s*(?:(?:public|private|protected|readonly|override)\s+)*(?:this\b)?\s*(#?[A-Za-z_$][\w$]*)\s*[?!]?\s*$/.exec(
          trimmed,
        );
      if (m && m[1] !== "this") push(m[1], local + trimmed.indexOf(m[1]));
    }
    offset += raw.length + 1;
  }
}

/**
 * Extrait les identifiants déclarés d'un source DÉJÀ blanchi.
 *
 * Reconnaît : `function f(`, `class C`, `interface I`, `type T`, `enum E` et
 * ses membres, `const|let|var` (avec destructuration), les méthodes et
 * signatures de méthode (`f(…) {` / `f(…): T;`), les propriétés et membres
 * typés (`x: T`, `x?: T`, `private x = …`), les paramètres de fonctions,
 * méthodes et flèches, et la clause `catch (e)`.
 *
 * @param stripped - le source sans prose (cf `stripProse`)
 * @returns `[{ name, line }]`, dans l'ordre du fichier, sans dédoublonnage
 */
export function extractDeclaredIdentifiers(stripped) {
  const found = [];
  const lineOf = lineIndexer(stripped);
  const push = (name, pos) => {
    const bare = name.replace(/^#/, "");
    if (KEYWORDS.has(bare)) return;
    found.push({ name, line: lineOf(pos) });
  };
  // Zones de MOTIFS (paramètres, destructurations) : leurs noms sont liés par
  // `bindingsOf` ; la règle des propriétés ne doit pas y relire une clé
  // `{ raison: motif }` comme une déclaration — `raison` appartient à l'objet
  // source, déclaré ailleurs (ou dans une bibliothèque tierce).
  const masked = [];
  const params = (openParen) => {
    const close = matchBracket(stripped, openParen, "(", ")");
    if (close < 0) return close;
    bindingsOf(stripped.slice(openParen + 1, close), openParen + 1, push);
    masked.push([openParen, close + 1]);
    return close;
  };

  // function / class / interface / type / enum / namespace
  for (const m of stripped.matchAll(
    new RegExp(
      `\\b(function\\s*\\*?|class|interface|type|enum|namespace)\\s+(${IDENT})`,
      "g",
    ),
  )) {
    const kind = m[1].replace(/\s*\*$/, "").trim();
    const name = m[2];
    const namePos = m.index + m[0].length - name.length;
    if (kind === "type" && stripped[m.index + m[0].length] === "(") continue; // `type(...)` appel
    push(name, namePos);
    if (kind === "function") {
      const paren = stripped.indexOf("(", m.index + m[0].length);
      if (paren > 0) params(paren);
    }
    if (kind === "enum") {
      const brace = stripped.indexOf("{", m.index + m[0].length);
      const end = brace < 0 ? -1 : matchBracket(stripped, brace, "{", "}");
      if (end > 0) bindingsOf(stripped.slice(brace + 1, end), brace + 1, push);
    }
  }
  // fonctions anonymes / expressions : `function (a, b)`
  for (const m of stripped.matchAll(/\bfunction\s*\*?\s*\(/g))
    params(m.index + m[0].length - 1);

  // const / let / var — y compris destructuration multi-ligne
  for (const m of stripped.matchAll(/\b(?:const|let|var)\s+/g)) {
    const start = m.index + m[0].length;
    const c = stripped[start];
    let end;
    if (c === "{" || c === "[") {
      end = matchBracket(stripped, start, c, c === "{" ? "}" : "]") + 1;
      if (end <= 0) continue;
      masked.push([start, end]);
    } else {
      const id = /^#?[A-Za-z_$][\w$]*/.exec(stripped.slice(start));
      if (!id) continue;
      end = start + id[0].length;
    }
    bindingsOf(stripped.slice(start, end), start, push);
  }

  // catch (e)
  for (const m of stripped.matchAll(
    new RegExp(`\\bcatch\\s*\\(\\s*(${IDENT})`, "g"),
  ))
    push(m[1], m.index + m[0].length - m[1].length);

  // méthodes et signatures : `name(…) {` ou `name(…): T {` ou `name(…): T;`
  for (const m of stripped.matchAll(
    new RegExp(
      `^[ \\t]*${MODIFIERS}\\*?\\s*(#?${IDENT})\\s*(?:<[^>()]*>)?\\s*\\(`,
      "gm",
    ),
  )) {
    const name = m[1];
    const bare = name.replace(/^#/, "");
    if (KEYWORDS.has(bare) && bare !== "constructor") continue;
    const paren = m.index + m[0].length - 1;
    const close = matchBracket(stripped, paren, "(", ")");
    if (close < 0) continue;
    const after = stripped.slice(close + 1, close + 400);
    // Corps `{`, ou type de retour puis `{` / `;` / fin de ligne — jamais un
    // appel `f(x);`, dont la parenthèse fermante est suivie de `;` ou `.`.
    const isDeclaration =
      /^\s*\{/.test(after) || /^\s*:\s*[^;{=]*?(?:\{|;|\n)/.test(after);
    if (!isDeclaration) continue;
    // `constructor(private readonly x: T)` : les propriétés de paramètre sont
    // des membres déclarés, le nom `constructor` ne l'est pas.
    if (bare !== "constructor") push(name, m.index + m[0].indexOf(name));
    params(paren);
  }

  // flèches : `(a, b) => …`, `(a): T => …`, `a => …`
  for (const m of stripped.matchAll(/\(/g)) {
    const close = matchBracket(stripped, m.index, "(", ")");
    if (close < 0) continue;
    const after = stripped.slice(close + 1, close + 200);
    if (!/^\s*(?::\s*[^=;{]*?)?=>/.test(after)) continue;
    // Un `(` précédé d'un nom est un appel `f(a)` ou une méthode `m(a)`, sauf
    // derrière `async`, `return`, `default`… ; précédé de `)` ou `]`, un appel.
    const prev = lastNonBlank(stripped, m.index);
    if (prev !== null) {
      if (prev.char === ")" || prev.char === "]") continue;
      if (
        /[\w$]/.test(prev.char) &&
        !ARROW_PRECEDING_WORDS.has(wordEndingAt(stripped, prev.index))
      )
        continue;
    }
    bindingsOf(stripped.slice(m.index + 1, close), m.index + 1, push);
    masked.push([m.index, close + 1]);
  }
  for (const m of stripped.matchAll(
    new RegExp(`(?<![\\w$)\\]])\\s*(${IDENT})\\s*=>`, "g"),
  ))
    push(m[1], m.index + m[0].indexOf(m[1]));

  // propriétés / membres typés / clés d'objet : `name: T`, `name?: T`, `mod name = …`
  // — sur le source où les motifs déjà liés sont blanchis (positions conservées).
  const chars = stripped.split("");
  for (const [from, to] of masked)
    for (let k = from; k < to; k++) if (chars[k] !== "\n") chars[k] = " ";
  const unpatterned = chars.join("");
  for (const m of unpatterned.matchAll(
    new RegExp(`(^|[{,;])[ \\t]*${MODIFIERS}(#?${IDENT})[?!]?:(?!:)`, "gm"),
  )) {
    const name = m[2];
    if (KEYWORDS.has(name.replace(/^#/, ""))) continue;
    // Le `:` est exigé COLLÉ au nom, comme prettier l'écrit : c'est ce qui
    // écarte la typographie française d'un texte JSX (« Lignes : {n} ») et le
    // ternaire `a ? b : c`. Une étiquette `case x:` tombe sur le mot-clé.
    push(name, m.index + m[0].lastIndexOf(name));
  }
  for (const m of unpatterned.matchAll(
    new RegExp(
      `^[ \\t]*(?:(?:public|private|protected|static|readonly|override|accessor|declare)\\s+)+(#?${IDENT})\\s*[?!]?\\s*=(?!=)`,
      "gm",
    ),
  ))
    push(m[1], m.index + m[0].indexOf(m[1]));
  for (const m of unpatterned.matchAll(
    new RegExp(`^[ \\t]*(#${IDENT})\\s*=(?!=)`, "gm"),
  ))
    push(m[1], m.index + m[0].indexOf(m[1]));

  return found;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 bis. SHELL — un AUTRE langage, donc un autre automate.
//
// Bash n'est pas du JavaScript sans les types : ses commentaires s'ouvrent par
// `#`, ses chaînes simples n'échappent RIEN, et une variable se déclare par une
// affectation nue. Réutiliser l'automate TypeScript aurait rendu des verdicts
// au hasard — d'où deux fonctions dédiées, volontairement PRUDENTES : ce qu'on
// ne sait pas lire (documents en ligne) est blanchi plutôt que deviné. Un gate
// qui rate un identifiant coûte un identifiant ; un gate qui en invente coûte
// la confiance qu'on lui accorde.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Blanchit la prose d'un script shell en gardant les lignes et les colonnes.
 *
 * Traite les commentaires `#` (jamais ceux collés à un mot, qui font partie
 * d'une expansion comme `${#tab[@]}`), les chaînes `'…'` — où RIEN ne
 * s'échappe, contrairement à JavaScript — et `"…"`, où seul `\` échappe. Les
 * documents en ligne (`<<EOF … EOF`) sont blanchis en entier : ils portent du
 * texte, parfois plusieurs langues, et jamais de déclaration.
 *
 * @param source - texte du script
 * @returns le même texte, prose remplacée par des espaces
 */
export function stripShellProse(source) {
  const out = source.split("");
  const n = source.length;
  let i = 0;
  let heredocTag = null;
  let lineStart = 0;
  while (i < n) {
    const c = source[i];
    if (c === "\n") {
      // Fin de ligne : un document en ligne s'ouvre à la ligne SUIVANTE.
      lineStart = i + 1;
      i++;
      if (heredocTag !== null) {
        // Blanchit jusqu'au marqueur de fermeture, seul sur sa ligne.
        while (i < n) {
          let end = source.indexOf("\n", i);
          if (end === -1) end = n;
          if (source.slice(i, end).trim() === heredocTag) {
            heredocTag = null;
            i = end;
            break;
          }
          for (let k = i; k < end; k++) out[k] = " ";
          i = end + 1;
          if (i >= n) break;
        }
      }
      continue;
    }
    if (c === "#") {
      // `#` ouvre un commentaire seulement en début de mot — `${#a}` et `a#b`
      // n'en sont pas.
      const prev = i > lineStart ? source[i - 1] : " ";
      if (/\s/.test(prev) || i === lineStart) {
        let end = source.indexOf("\n", i);
        if (end === -1) end = n;
        for (let k = i; k < end; k++) out[k] = " ";
        i = end;
        continue;
      }
      i++;
      continue;
    }
    if (c === "'") {
      // Chaîne forte : aucun échappement, elle court jusqu'à la prochaine `'`.
      let end = source.indexOf("'", i + 1);
      if (end === -1) end = n;
      for (let k = i + 1; k < end && k < n; k++) out[k] = " ";
      i = end + 1;
      continue;
    }
    if (c === '"') {
      let k = i + 1;
      while (k < n && source[k] !== '"') {
        if (source[k] === "\\") k++;
        k++;
      }
      for (let j = i + 1; j < k && j < n; j++)
        if (source[j] !== "\n") out[j] = " ";
      i = k + 1;
      continue;
    }
    if (c === "<" && source[i + 1] === "<") {
      // `<<EOF`, `<<-EOF`, `<<'EOF'`, `<<"EOF"` — le marqueur est le mot suivant.
      const m = /^<<-?\s*(['"]?)([A-Za-z_][\w]*)\1/.exec(source.slice(i));
      if (m) {
        heredocTag = m[2];
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  return out.join("");
}

/** Déclarations shell reconnues, chacune capturant le nom en groupe 1. */
const SHELL_DECLARATIONS = [
  // `nom() {` — la fonction, forme POSIX.
  /(?:^|[;&|]\s*)\s*([A-Za-z_]\w*)\s*\(\s*\)/gm,
  // `function nom` — forme ksh/bash.
  /(?:^|[;&|]\s*)\s*function\s+([A-Za-z_]\w*)/gm,
  // `local x=`, `readonly X=`, `export X=`, `declare -a X=`, `typeset X=`.
  /(?:^|[;&|]\s*)\s*(?:local|readonly|export|declare|typeset)\s+(?:-\w+\s+)*([A-Za-z_]\w*)\s*=/gm,
  // Affectation nue en tête d'instruction — jamais une comparaison (`==`).
  /(?:^|[;&|]\s*)\s*([A-Za-z_]\w*)=(?!=)/gm,
  // `for x in …`, `select x in …` — la variable de boucle est déclarée là.
  /(?:^|[;&|]\s*)\s*(?:for|select)\s+([A-Za-z_]\w*)\s+in\b/gm,
  // `read -r a b c` — chaque nom lu est une variable déclarée.
  /(?:^|[;&|]\s*)\s*read\s+((?:-\w+\s+)*[A-Za-z_][\w\s]*)$/gm,
];

/** Mots réservés du shell, jamais des identifiants de l'auteur. */
const SHELL_KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "while",
  "until",
  "do",
  "done",
  "case",
  "esac",
  "in",
  "function",
  "select",
  "time",
  "coproc",
  "return",
  "break",
  "continue",
  "local",
  "readonly",
  "export",
  "declare",
  "typeset",
  "echo",
  "read",
  "set",
  "unset",
  "shift",
  "exit",
  "eval",
  "exec",
  "trap",
  "true",
  "false",
  "test",
  "cd",
  "printf",
  "source",
]);

/**
 * Extrait les identifiants DÉCLARÉS d'un script shell blanchi.
 *
 * @param stripped - sortie de {@link stripShellProse}
 * @returns `[{ name, line }]`, dans l'ordre de rencontre
 */
export function extractShellIdentifiers(stripped) {
  const index = lineIndexer(stripped);
  const found = [];
  for (const pattern of SHELL_DECLARATIONS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(stripped)) !== null) {
      // `read -r a b c` capture plusieurs noms d'un coup ; les autres, un seul.
      for (const raw of m[1].split(/\s+/)) {
        if (raw.startsWith("-") || raw === "") continue;
        if (SHELL_KEYWORDS.has(raw)) continue;
        found.push({ name: raw, line: index(m.index) });
      }
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. FICHIERS — périmètre de production, chemins normalisés AVANT de filtrer.
// ═══════════════════════════════════════════════════════════════════════════

const EXCLUDED_SEGMENTS = new Set([
  "tests",
  "__tests__",
  "__mocks__",
  "mocks",
  "fixtures",
  "dist",
  "node_modules",
  "templates",
  "coverage",
  ".coverage",
  ".git",
]);

/**
 * Extensions contrôlées : TypeScript ET JavaScript.
 *
 * La règle du `CLAUDE.md` parle du CODE, pas d'un langage — un `monterDecor`
 * dans un `.mjs` d'outillage est aussi introuvable au `grep` anglais qu'un
 * `rendreRapport` dans un `.ts`. Le blanchiment de la prose et l'extraction des
 * déclarations valent tels quels : JavaScript est TypeScript sans les types,
 * les motifs propres aux types ne trouvent simplement rien.
 */
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?|sh|bash)$/;

/**
 * Fichiers de test, hors périmètre quelle que soit leur extension.
 *
 * Les tests sont EXEMPTÉS par la règle pour leurs identifiants locaux : ils ne
 * partent pas sur npm et n'entrent dans aucun `.d.ts`.
 */
const TEST_FILE = /\.(?:test|spec|selftest)\.(?:[cm]?[jt]sx?|sh|bash)$/;

/**
 * Dit si un chemin (relatif, en `/`) est un fichier de PRODUCTION à contrôler.
 *
 * Contrôlés : `.ts` `.tsx` `.mts` `.cts` `.js` `.jsx` `.mjs` `.cjs` `.sh`
 * `.bash`. Hors périmètre : tout segment `tests`/`__tests__`/`fixtures`/`dist`/
 * `node_modules`/`templates`/`coverage`, les `*.test.ts`, `*.spec.ts`,
 * `*.selftest.ts`, les `.d.ts` générés, et les configs `vitest.*`. Le segment
 * `test` au singulier reste DANS le périmètre : c'est le nom d'un module.
 *
 * @param relPath - chemin relatif à la racine, séparateur `/`
 * @returns `true` si le fichier doit être contrôlé
 */
export function isProductionFile(relPath) {
  const p = relPath.replace(/\\/g, "/");
  if (!SOURCE_EXTENSION.test(p)) return false;
  if (p.endsWith(".d.ts")) return false;
  if (TEST_FILE.test(p)) return false;
  const base = p.slice(p.lastIndexOf("/") + 1);
  if (base.startsWith("vitest.")) return false;
  for (const seg of p.split("/").slice(0, -1))
    if (EXCLUDED_SEGMENTS.has(seg)) return false;
  return true;
}

/** Marche récursive, chemins rendus en `/` relatifs à `root`. */
function walk(root, entry, out) {
  const abs = path.join(root, entry);
  let st;
  try {
    st = statSync(abs);
  } catch {
    return;
  }
  if (st.isDirectory()) {
    const name = path.basename(abs);
    if (EXCLUDED_SEGMENTS.has(name)) return;
    for (const child of readdirSync(abs).sort())
      walk(root, path.join(entry, child), out);
  } else if (isProductionFile(entry.split(path.sep).join("/")))
    out.push(entry.split(path.sep).join("/"));
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. ANALYSE — d'un source à des constats, puis les exceptions, puis le rapport.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Analyse un source et rend ses constats, dédoublonnés par identifiant.
 *
 * @param source - texte brut du fichier ; son LANGAGE est lu sur l'extension
 *   de `file` (shell pour `.sh`/`.bash`, sinon TypeScript/JavaScript)
 * @param file - chemin relatif (en `/`) porté dans chaque constat
 * @returns `[{ file, line, identifier, occurrences, words, suggestion }]`
 */
export function analyzeSource(source, file = "<memory>") {
  // Le LANGAGE se lit sur l'extension, et il décide des DEUX automates : un
  // script shell blanchi par les règles de JavaScript rendrait des verdicts au
  // hasard (`#` y ouvre un commentaire, `'…'` n'y échappe rien).
  const shell = /\.(?:sh|bash)$/.test(file);
  const stripped = shell ? stripShellProse(source) : stripProse(source);
  // nom → constat, ou `null` pour un identifiant jugé anglais (vu une fois).
  const seen = new Map();
  const declarations = shell
    ? extractShellIdentifiers(stripped)
    : extractDeclaredIdentifiers(stripped);
  for (const { name, line } of declarations) {
    const known = seen.get(name);
    if (known !== undefined) {
      if (known !== null) known.occurrences++;
      continue;
    }
    const verdict = judgeIdentifier(name);
    seen.set(
      name,
      verdict.words.length
        ? { file, line, identifier: name, occurrences: 1, ...verdict }
        : null,
    );
  }
  return [...seen.values()].filter((f) => f !== null);
}

/**
 * Applique une liste d'exceptions et COMPTE ce que chacune absorbe.
 *
 * Une entrée est `{ path?, identifier?, reason? }` — au moins l'un des deux
 * premiers. Une exception qui n'absorbe rien est rendue dans `unused` : elle
 * protège un défaut disparu, ou un chemin qui n'existe plus.
 *
 * @param findings - constats bruts
 * @param exceptions - entrées déclarées (défauts + fichier `--exceptions`)
 * @returns `{ kept, applied: [{ exception, absorbed }], unused }`
 */
export function applyExceptions(findings, exceptions) {
  const counts = exceptions.map(() => 0);
  const kept = [];
  for (const f of findings) {
    let absorbedBy = -1;
    for (let i = 0; i < exceptions.length && absorbedBy < 0; i++) {
      const e = exceptions[i];
      const pathOk = e.path === undefined || pathMatches(f.file, e.path);
      const idOk = e.identifier === undefined || f.identifier === e.identifier;
      if (
        (e.path !== undefined || e.identifier !== undefined) &&
        pathOk &&
        idOk
      )
        absorbedBy = i;
    }
    if (absorbedBy >= 0) counts[absorbedBy]++;
    else kept.push(f);
  }
  const applied = [];
  const unused = [];
  exceptions.forEach((exception, i) => {
    if (counts[i] > 0) applied.push({ exception, absorbed: counts[i] });
    else unused.push(exception);
  });
  return { kept, applied, unused };
}

/** `prefix` désigne un fichier exact ou un dossier (avec ou sans `/` final). */
function pathMatches(file, prefix) {
  const p = prefix.replace(/\\/g, "/");
  return file === p || file.startsWith(p.endsWith("/") ? p : p + "/");
}

/** Lit un fichier `--exceptions` : un tableau JSON d'entrées `{ path?, identifier?, reason? }`. */
export function readExceptionsFile(file) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const list = Array.isArray(parsed) ? parsed : parsed.exceptions;
  if (!Array.isArray(list))
    throw new Error(`${file} : un tableau d'exceptions est attendu`);
  return list.map((e) => (typeof e === "string" ? { identifier: e } : e));
}

/**
 * Balaie un dépôt et rend le rapport complet.
 *
 * @param options.root - racine du dépôt (chemin natif)
 * @param options.paths - dossiers ou fichiers à balayer, relatifs à `root` (défaut `["src"]`)
 * @param options.exceptions - exceptions, en plus des défauts
 * @returns `{ scanned, findings, exceptions: { declared, applied, absorbed, unused } }`
 */
export function scanRepo({ root, paths = ["src"], exceptions = [] } = {}) {
  const files = [];
  for (const p of paths) walk(root, p, files);
  const raw = [];
  for (const rel of files) {
    const source = readFileSync(path.join(root, ...rel.split("/")), "utf8");
    raw.push(...analyzeSource(source, rel));
  }
  const all = [...DEFAULT_EXCEPTIONS, ...exceptions];
  const { kept, applied, unused } = applyExceptions(raw, all);
  return {
    scanned: files.length,
    findings: kept,
    exceptions: {
      declared: all.length,
      applied: applied.length,
      absorbed: applied.reduce((n, a) => n + a.absorbed, 0),
      unused,
      detail: applied,
    },
  };
}

/** Rendu texte du rapport, pour un humain devant son terminal. */
export function formatReport(result) {
  const out = [];
  const { findings, exceptions } = result;
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, list] of byFile) {
    out.push(file);
    for (const f of list.sort((a, b) => a.line - b.line)) {
      const words = f.words.map((w) => `${w.word}→${w.french}`).join(", ");
      const times = f.occurrences > 1 ? ` (×${f.occurrences})` : "";
      const hint = f.suggestion ? `  → ${f.suggestion}` : "";
      out.push(`  :${f.line}  ${f.identifier}${times}  ← ${words}${hint}`);
    }
  }
  const ex = `${exceptions.applied}/${exceptions.declared} exception(s) appliquée(s), ${exceptions.absorbed} identifiant(s) absorbé(s)`;
  if (exceptions.unused.length)
    out.push(
      "",
      `⚠️  ${exceptions.unused.length} exception(s) SANS EFFET — à retirer ou à corriger :`,
      ...exceptions.unused.map(
        (e) =>
          `   ${e.path ?? ""}${e.path && e.identifier ? "#" : ""}${e.identifier ?? ""}`,
      ),
    );
  if (findings.length === 0) {
    out.push(`✓ ${result.scanned} fichiers, 0 identifiant français (${ex}).`);
  } else {
    const files = byFile.size;
    out.push(
      "",
      `✗ ${findings.length} identifiant(s) français dans ${files} fichier(s) sur ${result.scanned} balayés (${ex}).`,
      "  Règle : CLAUDE.md « LE CODE S'ÉCRIT EN ANGLAIS — la prose en français ».",
    );
  }
  return out.join("\n");
}

const HELP = `check-identifier-language — les identifiants du code de production sont en anglais.

Usage : node scripts/check-identifier-language.mjs [options] [chemins…]

  chemins…              dossiers ou fichiers, relatifs à la racine du dépôt (défaut : src)
  --json                rapport JSON sur la sortie standard
  --exceptions <f.json> tableau d'entrées { "path"?, "identifier"?, "reason"? } ou de noms
  --help                cette aide

Sortie : 0 si aucun identifiant ne sort, 1 sinon, 2 sur erreur d'usage.
Contrôlés : .ts .tsx .mts .cts .js .jsx .mjs .cjs .sh .bash — la règle porte sur le CODE,
pas sur un langage. Les scripts shell sont lus par leur propre automate.
Hors périmètre : tests (*.test.*, **/tests/**), dist, node_modules, templates, coverage.`;

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const paths = [];
  let exceptions = [];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--exceptions") {
      const f = argv[++i];
      if (!f) {
        console.error("--exceptions attend un chemin de fichier");
        process.exit(2);
      }
      try {
        exceptions = readExceptionsFile(path.resolve(f));
      } catch (e) {
        console.error(`exceptions illisibles : ${e.message}`);
        process.exit(2);
      }
    } else if (a.startsWith("-")) {
      console.error(`option inconnue : ${a}\n\n${HELP}`);
      process.exit(2);
    } else paths.push(a);
  }
  const result = scanRepo({
    root,
    paths: paths.length ? paths : undefined,
    exceptions,
  });
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatReport(result));
  // 🔴 `process.exitCode`, JAMAIS `process.exit()` : vers un PIPE, `stdout` est
  // asynchrone (tampon de 64 Ko) et `exit()` tue le processus avant le vidage —
  // le rapport JSON arrivait TRONQUÉ, donc invalide, à `jq`. Vers un fichier
  // l'écriture est synchrone : le défaut ne se montrait pas, et se déclenchait
  // seulement au-delà du tampon. Poser le code laisse Node sortir de lui-même,
  // une fois la sortie écrite.
  process.exitCode = result.findings.length ? 1 : 0;
}
