#!/usr/bin/env node
/**
 * code-slice.mjs — la SEULE implémentation de la règle « on ne lit pas du code par
 * tranche », lue par les deux hooks : `guard-bash.sh` (une commande) et
 * `guard-read.sh` (l'outil Read borné).
 *
 * Pourquoi aucune tolérance. Lire par tranche, c'est deviner des bornes : on imprime
 * trop, ou pas assez, et la sortie se repaie à chaque tour suivant (premier poste de
 * dépense mesuré sur les sessions du dépôt). Les versions précédentes de la garde
 * toléraient la tranche courte, celle qui ne coupait aucune déclaration, la cible en
 * `$VAR` : chaque tolérance couvrait un trou de `show-symbol` (blocs de test, barrels,
 * ligne d'une erreur), et chaque tolérance est devenue la fuite — neuf sessions de
 * suite à compter et « surveiller » un réflexe qu'une règle laissait passer. Les trous
 * sont fermés dans l'OUTIL (`F.ts:LIGNE`, blocs sans nom au plan) ; la garde, elle,
 * refuse tout.
 *
 * Ce qui reste libre : un fichier qui n'est pas du code (journal, Markdown, JSON),
 * la recherche (`rg`, `grep`, même tronquée par `| head`), le fichier ENTIER par
 * l'outil Read, sciemment.
 *
 * Usage (stdin) :
 *   printf '%s' "$cmd" | node code-slice.mjs           → raison du refus, ou rien
 *   node code-slice.mjs --read <fichier> <offset> <limit>  → idem pour Read
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/** Ce que `show-symbol` sait découper : la famille TS/JS. */
export const CODE_FILE = /\.(?:ts|tsx|mts|cts|mjs|cjs|js)$/;
const SHOW = ".claude/skills/nodefony-inspect/scripts/show-symbol.mjs";

/** Retire le corps des heredocs : ce qu'on ÉCRIT dans un fichier n'est pas une lecture. */
function stripHeredocs(cmd) {
  return cmd.replace(
    /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$)/g,
    "",
  );
}

/**
 * Découpe une commande en étapes de pipeline, chacune en mots — guillemets respectés,
 * séparateurs `;` `&&` `||` `&` `(` `)` `$(` et saut de ligne.
 *
 * @returns {string[][][]} des pipelines, chacun une liste d'étapes, chacune une liste de mots.
 */
export function parse(cmd) {
  const pipelines = [];
  let stages = [];
  let words = [];
  let word = null;
  let quote = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endStage = () => {
    endWord();
    if (words.length) stages.push(words);
    words = [];
  };
  const endPipeline = () => {
    endStage();
    if (stages.length) pipelines.push(stages);
    stages = [];
  };
  const s = stripHeredocs(cmd);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < s.length) word += s[++i];
      else word += c;
      continue;
    }
    // `2>&1`, `&>f`, `<&3` : une redirection, pas un séparateur.
    if (
      c === "&" &&
      (s[i - 1] === ">" || s[i - 1] === "<" || s[i + 1] === ">")
    ) {
      word = (word ?? "") + c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      word ??= "";
    } else if (c === "\\" && i + 1 < s.length) {
      word = (word ?? "") + s[++i];
    } else if (c === "|" && s[i + 1] !== "|") {
      endStage();
    } else if (
      c === ";" ||
      c === "\n" ||
      c === "&" ||
      c === "|" ||
      c === "(" ||
      c === ")" ||
      c === "`"
    ) {
      if ((c === "&" || c === "|") && s[i + 1] === c) i++;
      if (c === "(" && word === "$") word = null;
      endPipeline();
    } else if (c === " " || c === "\t") {
      endWord();
    } else {
      word = (word ?? "") + c;
    }
  }
  endPipeline();
  return pipelines;
}

/** Affectations `VAR=valeur` d'une commande : de quoi résoudre une cible `$VAR`. */
function assignments(pipelines) {
  const vars = Object.create(null);
  for (const stages of pipelines)
    for (const words of stages)
      for (const w of words) {
        const m = /^([A-Za-z_]\w*)=(.+)$/.exec(w);
        if (m) vars[m[1]] = m[2];
      }
  return vars;
}

/** Une adresse de `sed -n` qui découpe : `10,40p`, `10,+5p`, `10,$p`, `12p`. */
const SED_ADDR = /^(\d+)(?:,(\d+|\+\d+|\$))?p$/;
const READERS = new Set(["cat", "nl", "bat", "less", "more"]);

/** Le verbe d'une étape, affectations de tête et `command`/`env` sautés. */
function verbOf(words) {
  let i = 0;
  while (
    i < words.length &&
    (/^\w+=/.test(words[i]) || words[i] === "env" || words[i] === "command")
  )
    i++;
  return [words[i] ?? "", words.slice(i + 1)];
}

/** Ce que l'étape découpe : `{ kind, range }`, ou null si ce n'est pas un découpeur. */
function slicerOf(verb, args) {
  if (verb === "sed" && args.includes("-n")) {
    const addr = args.find((a) => SED_ADDR.test(a));
    if (!addr) return null;
    const [, a, b] = SED_ADDR.exec(addr);
    const from = Number(a);
    const to =
      b === undefined
        ? from
        : b === "$"
          ? null
          : b.startsWith("+")
            ? from + Number(b)
            : Number(b);
    return { kind: `sed -n ${addr}`, range: [from, to], script: addr };
  }
  if (verb === "head" || verb === "tail")
    return { kind: verb, range: null, script: null };
  if (verb === "awk") {
    const script = args.find((a) => !a.startsWith("-"));
    if (script && /\bNR\b/.test(script))
      return { kind: "awk NR", range: null, script };
  }
  return null;
}

/** Options qui consomment leur valeur, par verbe (`head -n 40`, `sed -e …`). */
const VALUED = {
  sed: /^-[ef]$/,
  head: /^-[nc]$/,
  tail: /^-[nc]$/,
  awk: /^-[fv]$/,
};

/** Les opérandes fichiers d'une étape (options, script et redirections écartés). */
function fileArgs(verb, args, script) {
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === script) continue;
    if (/^[<>]|^\d>/.test(a)) {
      if (/^[<>]+$|^\d>+$/.test(a)) i++;
      continue;
    }
    if (a.startsWith("-")) {
      if (VALUED[verb]?.test(a)) i++;
      continue;
    }
    if (/^\+?\d+$/.test(a)) continue;
    files.push(a);
  }
  return files;
}

/** Résout `$F`, `${F}`, `"$F"` par les affectations de la commande. */
function resolve(arg, vars) {
  const m = /^\$\{?([A-Za-z_]\w*)\}?$/.exec(arg);
  if (!m) return { path: arg, variable: false };
  return { path: vars[m[1]] ?? null, variable: true, name: m[1] };
}

const target = (file, range) =>
  range && range[1] !== null
    ? `\`node ${SHOW} '${file}:${range[0]}-${range[1]}'\` rend l'unité qui contient ces lignes, ENTIÈRE`
    : `\`node ${SHOW} '${file}:<ligne>'\` rend l'unité qui contient la ligne, ENTIÈRE`;

const refusal = (what, file, range) =>
  `REFUS — lire du code par tranche (${what} sur ${file}) : les bornes sont devinées, et la sortie se repaie à CHAQUE tour suivant. Aucune tranche de code n'est permise, courte ou non — toute ligne appartient à une unité que \`show-symbol\` imprime entière : ${target(file, range)} (méthode, fonction, bloc \`it\`/\`describe\`, instruction d'import ou d'export, \`if\` de premier niveau). Plan du fichier, blocs sans nom compris : \`node ${SHOW} --outline ${file}\`. Une déclaration par son nom : \`node ${SHOW} '${file}#Classe.methode'\` (plusieurs d'un coup). Chercher un nom dans un barrel : \`rg -n nom ${file}\`. Le fichier ENTIER : l'outil Read, sans offset ni limit.`;

/**
 * La raison de refuser une commande, ou null si elle ne lit pas de code par tranche.
 *
 * @param cmd - la commande Bash telle que l'agent l'envoie.
 */
export function bashSliceRefusal(cmd) {
  const pipelines = parse(cmd);
  const vars = assignments(pipelines);
  for (const stages of pipelines) {
    for (let k = 0; k < stages.length; k++) {
      const [verb, args] = verbOf(stages[k]);
      const slicer = slicerOf(verb, args);
      if (slicer) {
        for (const arg of fileArgs(verb, args, slicer.script)) {
          const r = resolve(arg, vars);
          if (r.path !== null && CODE_FILE.test(r.path))
            return refusal(slicer.kind, r.path, slicer.range);
          // Une cible en variable non résolue : la garde ne peut pas voir le fichier.
          // Un `sed -n N,Mp` sur une variable est le contournement vécu (`$F`) ; un
          // `tail "$LOG"` lit un journal, il passe.
          if (r.path === null && slicer.kind.startsWith("sed"))
            return `REFUS — \`${slicer.kind} $${r.name}\` : la garde ne lit pas tes variables, et c'est par là que la tranche de code passait. Écris le chemin en clair. Un journal : \`rg\` ou l'agent \`nodefony-run-log-report\` ; du code : \`node ${SHOW} 'F.ts:<ligne>'\` ou \`--outline F.ts\`.`;
        }
        continue;
      }
      if (!READERS.has(verb)) continue;
      // `cat a.ts > b.ts` copie : rien n'entre dans la sortie.
      if (args.some((a) => /^(?:1?>|>>)/.test(a))) continue;
      const files = fileArgs(verb, args, null)
        .map((a) => resolve(a, vars).path)
        .filter((p) => p !== null && CODE_FILE.test(p));
      if (!files.length) continue;
      const next = stages[k + 1] ? verbOf(stages[k + 1]) : null;
      const nextSlicer = next ? slicerOf(next[0], next[1]) : null;
      if (nextSlicer)
        return refusal(
          `${verb} | ${nextSlicer.kind}`,
          files[0],
          nextSlicer.range,
        );
      // Lu seul (rien derrière, ou un `less`) : le fichier entier imprimé dans la sortie.
      if (!next) return refusal(`${verb} du fichier entier`, files[0], null);
    }
  }
  return null;
}

/**
 * La raison de refuser une lecture Read bornée d'un fichier de code, ou null.
 *
 * @param file - `tool_input.file_path`.
 * @param offset - `tool_input.offset` (vide si absent).
 * @param limit - `tool_input.limit` (vide si absent).
 */
export function readSliceRefusal(file, offset, limit) {
  if (!CODE_FILE.test(file) || (!offset && !limit)) return null;
  const from = Number(offset) || 1;
  const to = limit ? from + Number(limit) - 1 : null;
  return refusal(`Read offset=${offset || "∅"} limit=${limit || "∅"}`, file, [
    from,
    to,
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const reason =
    argv[0] === "--read"
      ? readSliceRefusal(argv[1] ?? "", argv[2] ?? "", argv[3] ?? "")
      : bashSliceRefusal(fs.readFileSync(0, "utf8"));
  if (reason) process.stdout.write(reason);
}
