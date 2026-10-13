#!/usr/bin/env node
/**
 * Relit le diff d'une application Nodefony et nomme les fautes de sécurité qu'un motif suffit à voir — fichier, ligne, raison et geste qui corrige.
 *
 * Une relecture « à l'œil » d'un diff passe à côté de ce qui ne se voit pas :
 * une route ajoutée sous une zone qui laisse passer l'anonyme a l'air parfaite,
 * une mutation sans jeton anti-falsification aussi. Ce script lit chaque ligne
 * AJOUTÉE, applique les règles qu'un motif tranche, et croise chaque route
 * nouvelle avec les zones du pare-feu déclarées dans `nodefony/config/` — ce
 * que ni `doctor` ni `inspect` ne font.
 *
 * Il ne remplace pas le jugement : une route publique peut être voulue, une
 * variable lue hors de `env.ts` peut être anodine. Il rend la LISTE à trancher,
 * et dit ce qu'il ne voit pas (dépendances, autorisation sur l'objet).
 *
 * Par défaut il relit le travail en cours (`git diff HEAD` + fichiers non
 * suivis) ; s'il n'y en a pas, le dernier commit — et il le dit.
 *
 * `@usage` node node_modules/@nodefony/devkit/skills/nodefony-security-review/scripts/review-diff.mjs
 * `@usage` node node_modules/@nodefony/devkit/skills/nodefony-security-review/scripts/review-diff.mjs --base main
 * `@usage` node node_modules/@nodefony/devkit/skills/nodefony-security-review/scripts/review-diff.mjs --staged
 * `@option` --base - relit tout ce qui a changé depuis cette référence git, commits ET travail en cours
 * `@option` --staged - relit seulement ce qui est indexé (`git add`)
 * `@option` --diff - relit un fichier de patch (`git diff > x.patch`) au lieu du dépôt
 * `@option` --json - la même réponse, sérialisée, pour rechaîner
 * `@option` --root - racine de l'application (défaut : le dossier courant)
 * `@output` les points relevés, fautes d'abord, chacun avec fichier:ligne, la raison et le geste ; puis ce que le script ne voit pas
 *
 * Sorties : `0` rien à signaler · `1` au moins un point · `64` usage · `66` aucun diff lisible.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { findProjectRoot } from "nodefony";

/**
 * Racine de l'APPLICATION vue depuis `cwd` — le dossier qui porte
 * `nodefony.config.ts` —, ou `cwd` lui-même hors application. Un script lancé
 * depuis `frontend/` ou `modules/blog/` travaille ainsi sur l'app entière.
 * Une seule définition de « où commence l'app » : `findProjectRoot` du cœur.
 *
 * @param {string} cwd - le dossier de lancement.
 * @returns {string} la racine retenue.
 */
const appRoot = (cwd) => findProjectRoot(cwd) ?? cwd;

/** Une faute : à corriger, sauf raison écrite. */
const FAULT = "FAUTE";
/** Un point à justifier : légitime parfois, jamais par accident. */
const CHECK = "À JUSTIFIER";

/** Arbre vide de git — la base d'un dépôt qui n'a qu'un commit. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Extensions relues : le code, pas la documentation. */
const CODE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte)$/u;

/** Un test, un décor de test : ses identifiants en dur sont des fixtures. */
const TEST_FILE =
  /(?:^|\/)(?:tests?|__tests__|e2e|fixtures?)\/|\.(?:test|spec|selftest)\.[cm]?[jt]sx?$/u;

/**
 * Ce qui n'est pas le code de l'application : dépendances, produits de build,
 * et les dossiers CACHÉS (`.claude/`, `.github/`, `.agents/`) — outillage du
 * poste et de la forge, qui ne part pas avec l'application.
 */
const FOREIGN = /(?:^|\/)(?:node_modules|dist|coverage|\.[^/]+)\//u;

/** Un `.env` qui porte des valeurs — la notice `.env.example` n'en porte pas. */
const ENV_FILE = /(?:^|\/)\.env(?:\.(?!example$)[\w.-]+)?$/u;

/** La forme d'une requête SQL, pas un mot isolé dans un message. */
const SQL_SHAPE =
  /\bSELECT\b[\s\S]*\bFROM\b|\bINSERT\s+INTO\b|\bUPDATE\s+\S+\s+SET\b|\bDELETE\s+FROM\b|\bWHERE\s+[\w."]+\s*(?:=|<|>|\bLIKE\b|\bIN\b)/iu;

/** Une donnée qui vient de la requête. */
const REQUEST_INPUT =
  /\b(?:query|params|body|searchParams|getParameter|getQuery)\b/u;

/**
 * Le code d'une ligne, chaînes vidées — les expressions `${…}` d'un gabarit
 * restent, parce que c'est par elles qu'une donnée entre.
 *
 * Sans ce filtre, le mot `token` d'un message (« jeton renouvelé ») ou le
 * `from` d'une URL écrite en dur déclenchent une règle sur un texte inerte.
 *
 * @param text - la ligne.
 * @returns la ligne, littéraux vidés.
 */
export function codeOnly(text) {
  let out = "";
  let quote = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === null) {
      if (c === '"' || c === "'" || c === "`") {
        quote = c;
        out += c;
      } else out += c;
      continue;
    }
    if (c === "\\") {
      i++;
      continue;
    }
    if (quote === "`" && depth === 0 && c === "$" && text[i + 1] === "{") {
      depth = 1;
      out += "${";
      i++;
      continue;
    }
    if (depth > 0) {
      if (c === "{") depth++;
      else if (c === "}") depth--;
      out += depth === 0 ? "}" : c;
      continue;
    }
    if (c === quote) {
      quote = null;
      out += c;
    }
  }
  return out;
}

/**
 * Une ligne de code sans son commentaire — vide si la ligne n'est QUE commentaire.
 *
 * Les règles cherchent des GESTES ; un commentaire qui en parle (« la CSP par
 * défaut porte `'unsafe-inline'` », « `@Anonymous` rend l'action publique »)
 * n'en est pas un. Mesuré sur un diff réel : la moitié des points levés
 * l'étaient sur de la prose. Une ligne qui commence par `*` est une ligne de
 * bloc de documentation.
 *
 * @param text - la ligne.
 * @returns le code de la ligne, sans `// …` final.
 */
export function withoutLineComment(text) {
  const s = text.trimStart();
  if (s.startsWith("//") || s.startsWith("*") || s.startsWith("/*")) return "";
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "/" && text[i + 1] === "/") return text.slice(0, i);
  }
  return text;
}

/**
 * Une interpolation de requête SQL hors du gabarit `sql`…`` de drizzle.
 *
 * Le gabarit étiqueté LIE ses valeurs (paramètres) : `sql\`… ${id}\`` est sûr.
 * Le même texte sans l'étiquette, ou assemblé par `+`, ne l'est pas. Une
 * requête sur plusieurs lignes s'ouvre plus haut : on remonte jusqu'à six
 * lignes chercher l'accent grave qui l'ouvre, et ce qui le précède.
 *
 * @param text - la ligne ajoutée.
 * @param lines - les lignes du fichier (ou celles connues).
 * @param index - l'indice de la ligne dans `lines`.
 * @returns vrai si une donnée est interpolée dans du SQL brut.
 */
function sqlInterpolated(text, lines, index) {
  // Cherché dans le CODE : « jamais sql.raw() » écrit dans un message n'est pas un appel.
  const raw = /\bsql\.raw\(\s*/u.exec(text);
  if (raw && /\bsql\.raw\(/u.test(codeOnly(text))) {
    const rest = text.slice(raw.index + raw[0].length);
    const literal = /^(["'`])((?:\\.|(?!\1)[^\\])*)\1\s*\)/u.exec(rest);
    if (!literal || literal[2].includes("${")) return true;
  }
  if (/["'`][^"'`]*["'`]\s*\+\s*[\w$]/u.test(text)) {
    const strings = text.match(/["'`][^"'`]*["'`]/gu) ?? [];
    if (strings.some((s) => SQL_SHAPE.test(s))) return true;
  }
  const at = text.indexOf("${");
  if (at === -1) return false;
  const above = lines.slice(Math.max(0, index - 6), index).join("\n");
  const ctx = `${above}\n${text}`;
  const pos = above.length + 1 + at;
  if (!SQL_SHAPE.test(ctx.slice(Math.max(0, ctx.lastIndexOf("`", pos))))) {
    return false;
  }
  const open = ctx.lastIndexOf("`", pos);
  if (open === -1) return false;
  return ctx.slice(Math.max(0, open - 3), open) !== "sql";
}

/** Une valeur qui a la forme d'un secret, pas d'un libellé. */
function looksSecret(value) {
  if (value.includes("${") || /^(?:https?:|\/|\.)/u.test(value)) return false;
  if (value.length >= 20 && !/\s/u.test(value)) return true;
  return value.length >= 8 && /\d/u.test(value) && /[a-z]/iu.test(value);
}

/**
 * Les règles qu'une ligne ajoutée suffit à trancher.
 *
 * `test` reçoit la ligne, les lignes du fichier, l'indice, et le chemin.
 */
export const LINE_RULES = [
  {
    id: "sql-interpolated",
    level: FAULT,
    title: "donnée interpolée dans du SQL brut",
    why: "une valeur concaténée à la requête en change le SENS : injection SQL",
    fix: "le gabarit sql`… ${valeur}` de drizzle LIE la valeur ; jamais sql.raw() ni une chaîne assemblée sur une donnée reçue",
    test: (t, lines, i) => sqlInterpolated(t, lines, i),
  },
  {
    id: "code-exec",
    level: FAULT,
    title: "texte exécuté comme code ou comme commande",
    why: "une donnée qui atteint eval, new Function ou un shell s'exécute avec les droits du serveur",
    fix: "execFile()/spawn() avec un TABLEAU d'arguments et sans shell ; jamais eval ni new Function",
    test: (t) =>
      /\beval\s*\(|\bnew\s+Function\s*\(/u.test(codeOnly(t)) ||
      /\b(?:exec|execSync)\s*\(\s*`[^`]*\$\{/u.test(t) ||
      /\bshell\s*:\s*true\b/u.test(t),
  },
  {
    id: "secret-hardcoded",
    level: FAULT,
    title: "secret écrit dans le source",
    why: "le source part dans git, dans les images et chez chaque contributeur : un secret écrit ici est publié",
    fix: "déclare une variable NF_… dans env.ts (defineEnv), valeur dans le .env du poste (jamais commité) ; npx nodefony env prouve qu'elle est lue et d'où, --example met la notice à jour → skill nodefony-dev",
    test: (t) => {
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(t)) return true;
      if (
        /\b(?:sk_live_[\w]{8,}|ghp_[\w]{20,}|xox[bp]-[\w-]{10,}|AKIA[0-9A-Z]{16})/u.test(
          t,
        )
      )
        return true;
      const m =
        /([\w$]*(?:password|passwd|secret|api_?key|apikey|token|private_?key)[\w$]*)["']?\s*[:=]\s*(["'`])((?:\\.|(?!\2)[^\\])*)\2/iu.exec(
          t,
        );
      return m !== null && looksSecret(m[3]);
    },
  },
  {
    id: "secret-logged",
    level: CHECK,
    title: "valeur sensible envoyée au journal",
    why: "le journal est lu, copié et expédié vers des collecteurs : un mot de passe, un jeton ou un cookie n'y a pas sa place",
    fix: "journalise l'identifiant de l'objet, jamais la valeur du secret",
    test: (t) => {
      const call = /\b(?:console\.\w+|this\.log|logger\.\w+|log)\s*\(/u.exec(t);
      if (!call) return false;
      return /[\w$.]*(?:password|passwd|secret|token|apikey|api_key|authorization|cookie|otp)\b/iu.test(
        codeOnly(t.slice(call.index + call[0].length)),
      );
    },
  },
  {
    id: "env-outside-envts",
    level: CHECK,
    title: "process.env lu hors de env.ts",
    why: "une variable lue ailleurs échappe au catalogue : ni doctor ni .env.example ne la connaissent, et son absence passe en silence",
    fix: "déclare-la dans env.ts (defineEnv, seul lecteur de process.env) et fais-la passer par la configuration ; npx nodefony env montre ensuite qu'elle est lue → skill nodefony-dev",
    test: (t, _l, _i, file) =>
      /\bprocess\.env\b/u.test(codeOnly(t)) &&
      !/(?:^|\/)env\.[cm]?[jt]s$/u.test(file) &&
      // Un script AUTONOME (`scripts/`) ne charge pas l'application : il n'a
      // pas d'`env.ts` à qui demander, et lit son environnement lui-même.
      !file.startsWith("scripts/"),
  },
  {
    id: "raw-identity",
    level: FAULT,
    title: "identité BRUTE de la requête",
    why: "getUser() rend aussi l'anonyme (anon.) d'une zone anonymous : tester « connecté » dessus laisse passer tout le monde",
    fix: "this.user dans un controller, RequestContext.getAuthenticatedUser() ailleurs → skill nodefony-authentication",
    test: (t) =>
      /\b(?:RequestContext|context|ctx|this\.context)\??\.getUser\s*\(/u.test(
        codeOnly(t),
      ),
  },
  {
    id: "firewall-opening",
    level: CHECK,
    title: "route ou zone sortie du pare-feu",
    why: "aucune identité n'y est établie et aucun rôle n'y est exigé",
    fix: "voulu public ? écris-le dans la relecture. Sinon retire-le → skill nodefony-protect-route",
    test: (t) =>
      /@(?:BypassFirewall|Anonymous)\b|\bbypassFirewall\s*:\s*true\b|\bareaRoleExempt\s*:\s*true\b|\bsecurity\s*:\s*false\b|\bauthenticators\s*:\s*\[[^\]]*["']anonymous["']/u.test(
        t,
      ),
  },
  {
    id: "csrf-off",
    level: FAULT,
    title: "défense anti-falsification coupée",
    why: "n'importe quel site peut alors déclencher la mutation au nom de l'utilisateur connecté",
    fix: "une origine tierce se DÉCLARE (csrf.trustedOrigins) ; le client rejoue le jeton dans x-csrf-token → skill nodefony-protect-route",
    test: (t) =>
      /@CsrfExempt\b|\bcsrf\s*:\s*(?:false\b|\{[^}]*\benabled\s*:\s*false)|\btrustedOrigins\s*:\s*\[[^\]]*["']\*["']/u.test(
        t,
      ),
  },
  {
    id: "guard-off",
    level: FAULT,
    title: "garde éteinte au lieu d'être réglée",
    why: "la protection disparaît sans erreur ni trace : limite de tentatives, script injecté, secret en clair",
    fix: "relever un seuil est un réglage, l'éteindre ne l'est pas → skill nodefony-protect-route",
    test: (t) =>
      /\brateLimit\s*:\s*(?:false\b|\{[^}]*\benabled\s*:\s*false)|["']unsafe-inline["']|\ballowInsecureCredentials\s*:\s*true\b/u.test(
        t,
      ),
  },
  {
    id: "open-redirect",
    level: FAULT,
    title: "redirection vers une adresse reçue",
    why: "une adresse de retour lue dans la requête renvoie vers n'importe quel site : redirection ouverte, base d'un hameçonnage",
    fix: 'safeRedirectPath(valeur) (import { safeRedirectPath } from "nodefony") — la garde qui refuse ce qui sort de l\'application',
    test: (t) => {
      const code = codeOnly(t);
      return (
        /\bredirect\w*\s*\(/iu.test(code) &&
        /\b(?:query|params|body|searchParams|from|returnTo|redirectTo|next)\b/u.test(
          code.slice(code.search(/\bredirect\w*\s*\(/iu)),
        ) &&
        !/\bsafeRedirectPath\b/u.test(code)
      );
    },
  },
  {
    id: "path-from-input",
    level: CHECK,
    title: "chemin de fichier composé avec une donnée reçue",
    why: "un « ../../ » dans la donnée fait sortir du dossier prévu : lecture ou écriture n'importe où",
    fix: "résous le chemin, puis vérifie que path.relative(racine, chemin) ne commence pas par « .. »",
    test: (t) => {
      const code = codeOnly(t);
      return (
        /\b(?:readFile\w*|createReadStream|createWriteStream|sendFile|unlink\w*|writeFile\w*|rm\w*|path\.(?:join|resolve))\s*\(/u.test(
          code,
        ) && REQUEST_INPUT.test(code)
      );
    },
  },
  {
    id: "mcp-tool-exposed",
    level: CHECK,
    title: "outil MCP publié par un module",
    why: "il est servi par /nodefony/mcp, qui échappe aux zones du pare-feu : sans mcp.authorization, seules l'adresse locale et l'origine le gardent",
    fix: "un outil en lecture seule, qui ne rend que ce qui supporterait d'être lu sans compte ; sinon des scopes sur l'outil et mcp.authorization déclaré (node_modules/@nodefony/devkit/docs/index.md)",
    test: (t) => /\bgetMcpTools\s*\(/u.test(codeOnly(t)),
  },
  {
    id: "mcp-opened",
    level: CHECK,
    title: "porte MCP ouverte au-delà du poste",
    why: "la porte répond alors à une autre machine, ou à toute page web — ce qui ferme le détournement DNS, c'est précisément l'origine",
    fix: "déclare mcp.authorization AVANT d'ouvrir ; une origine se nomme, jamais « * »",
    test: (t) =>
      /\ballowRemote\s*:\s*true\b|\ballowedOrigins\s*:\s*\[[^\]]*["']\*["']/u.test(
        t,
      ),
  },
];

/** Les règles qui portent sur un FICHIER entier. */
export const FILE_RULES = [
  {
    id: "env-file-versioned",
    level: FAULT,
    title: "fichier .env dans le diff",
    why: "il porte les valeurs du poste, secrets compris : versionné, il part chez tous ceux qui clonent",
    fix: "git rm --cached <fichier> (il reste sur le disque) ; la notice versionnée est .env.example",
    test: (file) => ENV_FILE.test(file),
  },
];

/**
 * L'extrait d'une ligne, chaque littéral long réduit à ses quatre premiers caractères.
 *
 * La relecture est LUE — par l'agent, recopiée dans un compte rendu, versée au
 * journal d'une forge. Un extrait qui portait la valeur d'un secret écrit en
 * dur le publiait une fois de plus à chaque passage ; quatre caractères
 * suffisent à le reconnaître.
 *
 * @param text - la ligne.
 * @returns la ligne, valeurs masquées.
 */
export function redact(text) {
  return text.replace(
    /(["'`])([^"'`\s]{4})[^"'`\s]{4,}\1/gu,
    (_m, q, debut) => `${q}${debut}…${q}`,
  );
}

/** Règle « mutation sans jeton », croisée avec la zone. */
export const MUTATION_RULE = {
  id: "mutation-without-csrf",
  level: FAULT,
  title: "mutation sans @CsrfProtect sous une zone à session",
  why: "le cookie de session part avec toute requête, y compris celle qu'une autre page déclenche : la provenance n'est pas une preuve d'intention",
  fix: "@CsrfProtect() sur l'action (ou la classe) ; le client sème le jeton par un GET et le rejoue dans x-csrf-token → skill nodefony-protect-route",
};

/** Règle « route ouverte », croisée avec la zone. */
export const OPEN_ROUTE_RULE = {
  id: "route-open",
  level: CHECK,
  title: "route atteignable par un anonyme",
  why: "aucune garde ne la protège : n'importe qui l'appelle, sans compte",
  fix: 'voulue publique ? écris-le dans la relecture. Sinon @IsGranted("ROLE_…") sur l\'action ou la classe, ou une zone qui exige une session → skill nodefony-protect-route',
};

/**
 * Le texte d'un source, commentaires retirés — chaînes intactes.
 *
 * Indispensable pour lire les zones : le gabarit de `security.ts` porte des
 * exemples de zones en commentaire, qu'il ne faut pas prendre pour des zones.
 *
 * @param src - le source.
 * @returns le source sans commentaires (longueur non conservée).
 */
export function stripComments(src) {
  let out = "";
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote !== null) {
      out += c;
      if (c === "\\") {
        out += src[++i] ?? "";
      } else if (c === quote) quote = null;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    out += c;
  }
  return out;
}

/**
 * Les zones du pare-feu déclarées dans un source de configuration.
 *
 * Chaque `pattern:` littéral est rattaché à l'objet qui le porte, et l'on y lit
 * ses authentificateurs et un éventuel `security: false`.
 *
 * @param src - le source d'un fichier de configuration.
 * @returns les zones lues : nom, motif, authentificateurs, publique ou non.
 */
export function readZones(src) {
  const text = stripComments(src);
  const zones = [];
  const re = /\bpattern\s*:\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/gu;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    let depth = 0;
    let start = -1;
    for (let i = m.index; i >= 0; i--) {
      if (text[i] === "}") depth++;
      else if (text[i] === "{") {
        if (depth === 0) {
          start = i;
          break;
        }
        depth--;
      }
    }
    if (start === -1) continue;
    depth = 0;
    let end = text.length;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    const block = text.slice(start, end + 1);
    const name =
      /([\w$]+|"[^"]+"|'[^']+')\s*:\s*$/u
        .exec(text.slice(Math.max(0, start - 80), start))?.[1]
        ?.replace(/["']/gu, "") ?? "?";
    const auth = /\bauthenticators\s*:\s*\[([^\]]*)\]/u.exec(block);
    const authenticators = auth
      ? [...auth[1].matchAll(/["']([^"']+)["']/gu)].map((a) => a[1])
      : [];
    let regex = null;
    try {
      regex = new RegExp(m[2].replace(/\\\\/gu, "\\"), "u");
    } catch {
      regex = null;
    }
    if (regex === null) continue;
    zones.push({
      name,
      pattern: m[2],
      regex,
      authenticators,
      open:
        /\bsecurity\s*:\s*false\b/u.test(block) ||
        authenticators.includes("anonymous"),
    });
  }
  return zones;
}

/**
 * Les zones de l'application : `nodefony/config/**` et `nodefony.config.ts`.
 *
 * @param root - racine de l'application.
 * @returns les zones lues, et les fichiers lus.
 */
export function appZones(root) {
  const files = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.[cm]?[jt]s$/u.test(e.name)) files.push(full);
    }
  };
  walk(path.join(root, "nodefony", "config"));
  for (const f of ["nodefony.config.ts", "nodefony.config.js"]) {
    const full = path.join(root, f);
    if (existsSync(full)) files.push(full);
  }
  const zones = [];
  for (const f of files) {
    try {
      zones.push(...readZones(readFileSync(f, "utf8")));
    } catch {
      // illisible : la zone manquera, et la route sera dite hors zone — visible.
    }
  }
  return zones.sort((a, b) => b.pattern.length - a.pattern.length);
}

/**
 * Les lignes ajoutées par un diff unifié, rangées par fichier.
 *
 * @param diff - la sortie de `git diff` (n'importe quel contexte).
 * @returns `Map<chemin, { added: {line, text}[], isNew }>`.
 */
export function parseDiff(diff) {
  const files = new Map();
  let current = null;
  let line = 0;
  let isNew = false;
  for (const raw of diff.split(/\r?\n/u)) {
    if (raw.startsWith("diff --git ")) {
      current = null;
      isNew = false;
      continue;
    }
    if (raw.startsWith("new file mode")) {
      isNew = true;
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const p = raw
        .slice(4)
        .trim()
        .replace(/^"(.*)"$/u, "$1");
      if (p === "/dev/null") {
        current = null;
        continue;
      }
      const file = p.replace(/^b\//u, "");
      current = files.get(file) ?? { added: [], isNew };
      files.set(file, current);
      continue;
    }
    if (raw.startsWith("--- ")) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (current === null) continue;
    if (raw.startsWith("+")) {
      current.added.push({ line, text: raw.slice(1) });
      line++;
    } else if (raw.startsWith(" ")) line++;
  }
  return files;
}

/** Une ligne qui CLÔT le membre précédent : on ne remonte pas au-delà. */
const MEMBER_BOUNDARY = (s) =>
  s === "}" || s === "};" || s.endsWith("{") || s.endsWith("*/") || s === "";

/** Une signature de méthode ou de classe : fin du bloc de décorateurs. */
const SIGNATURE =
  /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:class\s|(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*[\w$]+\s*\()/u;

/**
 * Les décorateurs qui précèdent une ligne de route : du membre précédent à la
 * signature qui suit.
 *
 * @param lines - lignes du fichier.
 * @param i - indice d'une ligne de décorateur.
 * @returns `{ from, to, text }` — `to` est l'indice de la signature.
 */
function decoratorGroup(lines, i) {
  let from = i;
  while (from > 0 && !MEMBER_BOUNDARY((lines[from - 1] ?? "").trim())) from--;
  let to = i;
  while (to < lines.length - 1) {
    const s = (lines[to] ?? "").trim();
    if (!s.startsWith("@") && SIGNATURE.test(s)) break;
    to++;
  }
  return { from, to, text: lines.slice(from, to + 1).join("\n") };
}

/**
 * Les routes d'un fichier de controller, avec le bloc de décorateurs de chaque action.
 *
 * @param lines - lignes du fichier.
 * @returns préfixe, garde de classe, et les actions : chemin, méthodes, ligne, bloc.
 */
export function controllerRoutes(lines) {
  const prefix =
    /@controller\(\s*["'`]([^"'`]*)["'`]/u.exec(lines.join("\n"))?.[1] ?? "";
  const classAt = lines.findIndex((l) =>
    /^(?:export\s+)?(?:default\s+)?class\s/u.test(l.trim()),
  );
  const classGroup = classAt > 0 ? decoratorGroup(lines, classAt - 1).text : "";
  const actions = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i] ?? "";
    const routeDeco = /@route\(\s*["'`][^"'`]*["'`]\s*,/u.test(t);
    const verbDeco = /@(Get|Post|Put|Patch|Delete)\s*\(/u.exec(t);
    if (!routeDeco && !verbDeco) continue;
    const group = decoratorGroup(lines, i);
    if (seen.has(group.to)) continue;
    seen.add(group.to);
    let routePath = "";
    let methods = [];
    if (verbDeco) {
      routePath =
        new RegExp(
          `@${verbDeco[1]}\\s*\\(\\s*["'\`]([^"'\`]*)["'\`]`,
          "u",
        ).exec(group.text)?.[1] ?? "";
      methods = [verbDeco[1].toUpperCase()];
    } else {
      routePath =
        /\bpath\s*:\s*["'`]([^"'`]*)["'`]/u.exec(group.text)?.[1] ?? "";
      const one = /\bmethod\s*:\s*["'`](\w+)["'`]/u.exec(group.text);
      const many = /\bmethods?\s*:\s*\[([^\]]*)\]/u.exec(group.text);
      methods = one
        ? [one[1].toUpperCase()]
        : many
          ? [...many[1].matchAll(/["'`](\w+)["'`]/gu)].map((x) =>
              x[1].toUpperCase(),
            )
          : ["GET"];
    }
    const full = `/${[prefix, routePath]
      .map((s) => s.replace(/^\/+|\/+$/gu, ""))
      .filter(Boolean)
      .join("/")}`;
    actions.push({
      line: i,
      from: group.from,
      to: group.to,
      path: full,
      methods,
      text: group.text,
    });
  }
  return {
    prefix,
    classGuarded: /@IsGranted\b/u.test(classGroup),
    classCsrf: /@CsrfProtect\b/u.test(classGroup),
    actions,
  };
}

/** La zone retenue pour un chemin : le motif le plus LONG qui le couvre (règle du pare-feu). */
export function zoneFor(zones, urlPath) {
  return zones.find((z) => z.regex.test(urlPath)) ?? null;
}

/**
 * Relit les fichiers donnés et rend les points relevés.
 *
 * @param files - `Map<chemin, { added, isNew }>` (sortie de `parseDiff`).
 * @param opts - `root` (racine de l'application : ses zones), `filesRoot` (racine
 *   du dépôt, à laquelle les chemins du diff sont relatifs ; défaut `root`),
 *   `readDisk` (relire le fichier entier ; faux pour un patch), `zones` (sinon lues sous `root`).
 * @returns `{ findings, reviewed, skippedTests, zonesRead }`.
 */
export function review(files, opts = {}) {
  const root = opts.root ?? process.cwd();
  const zones = opts.zones ?? appZones(root);
  const findings = [];
  const reviewed = [];
  const skippedTests = [];
  const push = (rule, file, line, excerpt, extra = "") => {
    findings.push({
      rule: rule.id,
      level: rule.level,
      file,
      line,
      excerpt: (rule.id === "secret-hardcoded" ? redact(excerpt) : excerpt)
        .trim()
        .slice(0, 160),
      title: rule.title,
      why: extra ? `${rule.why} — ${extra}` : rule.why,
      fix: rule.fix,
    });
  };
  for (const [file, { added, isNew }] of files) {
    const posix = file.split(path.sep).join("/");
    if (FOREIGN.test(posix)) continue;
    for (const r of FILE_RULES) {
      if (r.test(posix)) push(r, posix, added[0]?.line ?? 1, posix);
    }
    if (!CODE_FILE.test(posix)) continue;
    if (TEST_FILE.test(posix)) {
      skippedTests.push(posix);
      continue;
    }
    reviewed.push(posix);
    // Le fichier entier quand il est sur le disque — sinon les seules lignes connues.
    let lines = null;
    const onDisk = path.join(opts.filesRoot ?? root, file);
    if (opts.readDisk !== false && existsSync(onDisk)) {
      try {
        lines = readFileSync(onDisk, "utf8").split(/\r?\n/u);
      } catch {
        lines = null;
      }
    }
    if (lines === null) {
      lines = [];
      for (const a of added) lines[a.line - 1] = a.text;
      for (let i = 0; i < lines.length; i++) lines[i] ??= "";
    }
    // Le code seul : un commentaire qui PARLE d'un décorateur ou d'une garde
    // ne la pose pas — ni pour lever un point, ni pour en éteindre un.
    const code = lines.map(withoutLineComment);
    const addedAt = new Set(added.map((a) => a.line - 1));
    for (const a of added) {
      const t = code[a.line - 1] ?? withoutLineComment(a.text);
      if (t.trim() === "") continue;
      for (const r of LINE_RULES) {
        if (r.test(t, code, a.line - 1, posix)) push(r, posix, a.line, a.text);
      }
    }
    if (!/@controller\s*\(/u.test(code.join("\n"))) continue;
    const ctl = controllerRoutes(code);
    for (const act of ctl.actions) {
      let touched = isNew;
      for (let k = act.from; k <= act.to && !touched; k++)
        if (addedAt.has(k)) touched = true;
      if (!touched) continue;
      const zone = zoneFor(zones, act.path);
      const verbs = act.methods.join(",");
      const guarded = ctl.classGuarded || /@IsGranted\b/u.test(act.text);
      const excerpt = `${verbs} ${act.path}`;
      if (!guarded) {
        if (zone === null)
          push(
            OPEN_ROUTE_RULE,
            posix,
            act.line + 1,
            excerpt,
            zones.length === 0
              ? "aucune zone de pare-feu lue dans nodefony/config/ : chaque route est publique"
              : `aucune zone ne couvre ${act.path} : this.user y vaut toujours null`,
          );
        else if (zone.open)
          push(
            OPEN_ROUTE_RULE,
            posix,
            act.line + 1,
            excerpt,
            `elle tombe dans la zone « ${zone.name} » (${zone.pattern}), qui laisse passer l'anonyme, et l'action ne porte aucun @IsGranted`,
          );
      }
      const mutates = act.methods.some((m) =>
        ["POST", "PUT", "PATCH", "DELETE"].includes(m),
      );
      const cookieZone =
        zone === null
          ? zones.length === 0
          : zone.authenticators.includes("session");
      if (
        mutates &&
        cookieZone &&
        !ctl.classCsrf &&
        !/@CsrfProtect\b/u.test(act.text)
      )
        push(
          MUTATION_RULE,
          posix,
          act.line + 1,
          excerpt,
          zone ? `zone « ${zone.name} »` : "",
        );
    }
  }
  findings.sort(
    (a, b) =>
      (a.level === FAULT ? 0 : 1) - (b.level === FAULT ? 0 : 1) ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );
  return { findings, reviewed, skippedTests, zonesRead: zones.length };
}

const FLAGS = new Set([
  "--base",
  "--staged",
  "--diff",
  "--json",
  "--root",
  "--help",
  "-h",
]);

/**
 * Lit les arguments, et REFUSE ce qu'il ne comprend pas.
 *
 * Un drapeau mal tapé qu'on ignorerait rendrait « rien à signaler » — la pire
 * réponse possible d'une relecture.
 *
 * @param argv - les arguments, sans `node` ni le chemin du script.
 * @returns {{base: string|null, staged: boolean, diff: string|null, json: boolean, root: string, help: boolean}} les options lues.
 * @throws Error quand un drapeau est inconnu ou qu'une valeur manque.
 */
export function parseArgs(argv, cwd = process.cwd()) {
  const opts = {
    base: null,
    staged: false,
    diff: null,
    json: false,
    root: appRoot(cwd),
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!FLAGS.has(a)) throw new Error(`option inconnue : ${a}`);
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--staged") opts.staged = true;
    else if (a === "--json") opts.json = true;
    else {
      const v = argv[++i];
      if (v === undefined || v.startsWith("-"))
        throw new Error(`${a} attend une valeur`);
      if (a === "--root") opts.root = path.resolve(v);
      else if (a === "--diff") opts.diff = v;
      else opts.base = v;
    }
  }
  if (opts.staged && opts.base !== null)
    throw new Error("--staged et --base s'excluent : choisis l'un ou l'autre");
  return opts;
}

/** Lance git dans la racine ; `null` si git manque ou refuse. */
function git(root, args) {
  const r = spawnSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return r.status === 0 ? r.stdout : null;
}

/**
 * Le diff à relire, et la phrase qui dit lequel.
 *
 * @param opts - options lues.
 * @returns `{ files, source, top }` — `top` est la racine du dépôt, à laquelle
 *   les chemins sont relatifs — ou `null` si aucun diff n'est lisible.
 */
export function collect(opts) {
  if (opts.diff !== null) {
    const file = path.resolve(opts.root, opts.diff);
    if (!existsSync(file)) return null;
    return {
      files: parseDiff(readFileSync(file, "utf8")),
      source: `le patch ${opts.diff}`,
    };
  }
  const topOut = git(opts.root, ["rev-parse", "--show-toplevel"]);
  if (topOut === null) return null;
  // Les chemins de `git diff` sont relatifs à la racine du DÉPÔT, quel que soit
  // le dossier courant : c'est d'elle qu'on relit les fichiers.
  const top = path.resolve(topOut.trim());
  const diffArgs = ["diff", "--no-color", "--no-ext-diff", "-U0"];
  if (opts.staged) {
    const out = git(opts.root, [...diffArgs, "--cached"]);
    return out === null
      ? null
      : { files: parseDiff(out), source: "ce qui est indexé (git add)", top };
  }
  const hasHead = git(opts.root, ["rev-parse", "--verify", "HEAD"]) !== null;
  const base = opts.base ?? (hasHead ? "HEAD" : EMPTY_TREE);
  const out = git(opts.root, [...diffArgs, base]);
  if (out === null) return null;
  const files = parseDiff(out);
  const untracked = (
    git(opts.root, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "--full-name",
    ]) ?? ""
  )
    .split(/\r?\n/u)
    .filter(Boolean);
  for (const f of untracked) {
    const full = path.join(top, f);
    let text = "";
    try {
      if (statSync(full).size > 1024 * 1024) continue;
      text = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    files.set(f, {
      added: text.split(/\r?\n/u).map((t, i) => ({ line: i + 1, text: t })),
      isNew: true,
    });
  }
  if (files.size > 0 || opts.base !== null) {
    return {
      files,
      source:
        opts.base !== null
          ? `tout ce qui a changé depuis ${opts.base}`
          : "le travail en cours (non commité, fichiers non suivis compris)",
      top,
    };
  }
  if (!hasHead) return { files, source: "le dépôt (vide)", top };
  const prev = git(opts.root, ["rev-parse", "--verify", "HEAD~1"]) !== null;
  const last = git(opts.root, [
    ...diffArgs,
    prev ? "HEAD~1" : EMPTY_TREE,
    "HEAD",
  ]);
  if (last === null) return null;
  return {
    files: parseDiff(last),
    source:
      "le DERNIER COMMIT — rien n'était en cours (autre périmètre : --base <réf>)",
    top,
  };
}

/** Ce que le script ne voit pas, et la commande qui le montre. */
const NOT_SEEN = [
  "npx nodefony doctor          → Surface ouverte, Secrets hors de git, Cohérence du firewall",
  "npm audit --omit=dev         → dépendances à vulnérabilité connue",
  "l'autorisation sur l'OBJET   → cet utilisateur a-t-il droit à CET enregistrement ? (voter, skill nodefony-protect-route)",
  "les entrées non bornées      → une liste, une taille, une pagination sans plafond",
];

const USAGE = `Usage : node review-diff.mjs [--base REF | --staged] [--diff PATCH] [--json] [--root DIR]

Sans option : le travail en cours (git diff HEAD + fichiers non suivis), sinon le dernier commit.
Sorties : 0 rien à signaler · 1 au moins un point · 64 usage · 66 aucun diff lisible.`;

/**
 * Point d'entrée.
 *
 * @returns le code de sortie.
 */
export function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${e.message}\n\n${USAGE}\n`);
    return 64;
  }
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const got = collect(opts);
  if (got === null) {
    process.stderr.write(
      opts.diff !== null
        ? `Patch introuvable : ${opts.diff}\n`
        : `Aucun diff lisible : ${opts.root} n'est pas un dépôt git (ou git manque, ou la référence n'existe pas).\n` +
            "Passe un patch : git diff > relecture.patch, puis --diff relecture.patch.\n",
    );
    return 66;
  }
  const result = review(got.files, {
    root: opts.root,
    filesRoot: got.top ?? opts.root,
    readDisk: opts.diff === null,
  });
  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({ source: got.source, ...result, notSeen: NOT_SEEN }, null, 2)}\n`,
    );
    return result.findings.length > 0 ? 1 : 0;
  }
  const { findings, reviewed, skippedTests, zonesRead } = result;
  process.stdout.write(
    `Relu : ${got.source}\n` +
      `${reviewed.length} fichier(s) de code · ${zonesRead} zone(s) de pare-feu lue(s)` +
      `${skippedTests.length ? ` · ${skippedTests.length} fichier(s) de test non relu(s)` : ""}\n\n`,
  );
  if (findings.length === 0) {
    process.stdout.write("Rien à signaler sur ce que le script sait voir.\n\n");
  } else {
    const faults = findings.filter((f) => f.level === FAULT).length;
    process.stdout.write(
      `${findings.length} point(s) : ${faults} faute(s), ${findings.length - faults} à justifier\n\n`,
    );
    for (const f of findings) {
      process.stdout.write(
        `${f.level} ${f.file}:${f.line} — ${f.title} [${f.rule}]\n` +
          `  ${f.excerpt}\n  pourquoi : ${f.why}\n  ➜ ${f.fix}\n\n`,
      );
    }
  }
  process.stdout.write(
    `Ce que ce script ne voit pas :\n${NOT_SEEN.map((l) => `  ${l}`).join("\n")}\n`,
  );
  return findings.length > 0 ? 1 : 0;
}

// Exécuté directement (et non importé par son test) : rendre le code.
// La comparaison passe par une URL, jamais par un chemin : sous Windows, `D:\…`
// verrait son `d:` lu comme un protocole.
if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  process.exitCode = main();
}
