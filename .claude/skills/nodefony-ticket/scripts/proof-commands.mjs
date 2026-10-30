/**
 * proof-commands.mjs — exécute les PREUVES écrites en commande dans un ticket.
 *
 * Le problème qu'il ferme : un ticket écrit « Aucun encodeur CBOR à nous :
 * `rg -l -i cbor src --type ts` ne rend que la sécurité » ; un commit ajoute le
 * codec ; la phrase reste, et un plan entier se bâtit sur elle. Les ancres du
 * ticket, elles, résolvaient toutes : l'outil d'ancres vérifie qu'un symbole
 * EXISTE, jamais qu'une affirmation d'ABSENCE est encore vraie. Or la phrase
 * fausse portait sa propre commande — relancée, elle se dénonçait seule.
 *
 * Ce module relance ces commandes. Il ne JUGE que ce qui se compare à un
 * nombre : « → 0 », « ne rend rien », « rend **3** ». Une forme qualitative
 * (« ne rend que le contrat ») est rapportée comme NON JUGÉE, jamais tue.
 *
 * Sûreté : un corps de ticket s'édite sur GitHub, par n'importe qui. Aucune
 * commande ne passe par un shell ; seul `rg` est lancé, sans les options qui
 * exécutent un programme (`--pre`, `--hostname-bin`, `-z`) ni `--replace`
 * (`-r`, qui réécrit la sortie) ; le seul tube admis est `| wc -l`, compté ici.
 */
import fs from "node:fs";
import path from "node:path";

/** Programme seul admis : un lecteur, qui ne lance rien d'autre que lui-même. */
const PROGRAM = "rg";

/** Options de `rg` qui lancent un programme, ou mutilent la sortie. */
const FORBIDDEN_FLAGS = new Set([
  "--pre",
  "--pre-glob",
  "-z",
  "--search-zip",
  "--hostname-bin",
  "-r",
  "--replace",
]);

/** Formes d'un verdict d'ABSENCE, lues juste après la commande. */
const ZERO_TAIL = [
  /^\)?\s*(?:→|->)\s*(?:\*\*)?(?:0\b|aucun(?:e)?\s+(?:résultat|ligne|occurrence|correspondance)|vide|rien\b)/iu,
  /^(?:ne\s+)?(?:rend|renvoie)\s+(?:\*\*)?0\b(?!\s*·)/iu,
  /^(?:ne\s+)?(?:rend|renvoie|trouve)\s+(?:rien(?!\s+d['’]autre)|aucun(?:e)?\s+(?:ligne|résultat|occurrence|correspondance)|vide)/iu,
  /^(?:est\s+)?vide\b/iu,
];

/** Formes d'un verdict CHIFFRÉ (> 0) ; une liste « 18 · 3 · 51 » n'en est pas une. */
const COUNT_TAIL = [
  /^\)?\s*(?:→|->)\s*(?:\*\*)?(\d+)\b(?:\*\*)?(?!\s*·)/u,
  /^(?:en\s+)?(?:rend|renvoie)\s+(?:\*\*)?(\d+)\b(?:\*\*)?(?!\s*·)/iu,
];

/**
 * Ouvre une section qui décrit l'état VISÉ : ses commandes sont des critères à
 * atteindre, pas des affirmations sur le code d'aujourd'hui — les relancer
 * accuserait à tort tout ticket non encore fait.
 */
const TARGET_HEADER = /(?:\*\*|^#{1,6}\s+)(?:Fini quand|Critères de fin)\b/iu;

/** Ouvre toute autre section (titre, bloc en gras en tête de ligne, filet). */
const SECTION_HEADER = /^\s*(?:#{1,6}\s|\*\*[^*]+\*\*|---\s*$)/u;

/** Ce qui annonce un verdict qu'on ne sait pas chiffrer (rapporté, pas jugé). */
const VERDICT_WORD =
  /^\)?\s*(?:→|->|(?:ne\s+|en\s+)?(?:rend|renvoie|trouve)\b)/iu;

/**
 * Extrait les commandes `rg` d'un corps de ticket, avec le verdict annoncé.
 *
 * @param body - corps Markdown du ticket
 * @returns une entrée par commande suivie d'un verdict : `expected` vaut le
 *   nombre annoncé, ou `null` si le verdict est qualitatif (non jugé)
 */
export function extractProofs(body) {
  const proofs = [];
  const lines = body.split("\n");
  let fenceStart = -1; // ligne d'ouverture du bloc de code en cours, -1 hors bloc
  let inTarget = false; // dans un « Fini quand » : l'état VISÉ, pas l'état présent
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fenceStart === -1) {
      if (TARGET_HEADER.test(line)) inTarget = true;
      else if (SECTION_HEADER.test(line)) inTarget = false;
    }
    if (inTarget && fenceStart === -1 && !/^\s*```/u.test(line)) continue;
    if (/^\s*```/u.test(line)) {
      if (fenceStart === -1) {
        fenceStart = i;
        continue;
      }
      // Bloc refermé : une SEULE commande `rg`, et le verdict sur la ligne
      // non vide qui suit (« rend 0. ») — la forme que prend une preuve trop
      // longue pour tenir en ligne.
      const inner = [];
      for (let k = fenceStart + 1; k < i; k++)
        if (lines[k].trim()) inner.push(k);
      fenceStart = -1;
      const next = lines.slice(i + 1).find((l) => l.trim());
      if (inner.length !== 1 || next === undefined) continue;
      const command = lines[inner[0]].trim();
      if (!/^rg\s/u.test(command)) continue;
      const tail = next.trim();
      const expected = readExpected(tail);
      if (expected === undefined || inTarget) continue;
      proofs.push({
        command,
        expected,
        line: inner[0] + 1,
        tail: tail.slice(0, 60),
      });
      continue;
    }
    if (fenceStart !== -1) continue; // dans un bloc : pas de code en ligne
    // Dans un tableau Markdown, `|` s'échappe en `\|` même dans le code.
    const inTable = line.trimStart().startsWith("|");
    // « rend `0` » — la forme que ce skill enseigne : le nombre en code ne doit
    // pas couper la lecture du verdict.
    const scan = line.replace(/`(\d+)`/gu, "$1");
    for (const m of scan.matchAll(/`(rg\s[^`]+)`([^`]{0,80})/gu)) {
      const raw = inTable ? m[1].replaceAll("\\|", "|") : m[1];
      const tail = m[2].trim();
      const expected = readExpected(tail);
      if (expected === undefined) continue; // pas de verdict : simple mention
      proofs.push({
        command: raw,
        expected,
        line: i + 1,
        tail: tail.slice(0, 60),
      });
    }
  }
  return proofs;
}

/**
 * Lit le verdict qui suit une commande.
 *
 * @returns `0` ou N pour un verdict chiffré, `null` pour un verdict
 *   qualitatif, `undefined` s'il n'y a pas de verdict du tout
 */
export function readExpected(tail) {
  if (ZERO_TAIL.some((re) => re.test(tail))) return 0;
  for (const re of COUNT_TAIL) {
    const m = re.exec(tail);
    if (m) return Number(m[1]);
  }
  return VERDICT_WORD.test(tail) ? null : undefined;
}

/**
 * Découpe une commande en arguments, à la manière d'un shell POSIX, sans en
 * lancer aucun ; refuse tout ce qui n'est pas un `rg` simple.
 *
 * @returns `{ argv, countLines }` ou `{ refused }` avec la raison
 */
export function parseCommand(text) {
  let source = text.trim();
  let countLines = false;
  const wc = /\s*\|\s*wc\s+-l\s*$/u;
  if (wc.test(source)) {
    countLines = true;
    source = source.replace(wc, "");
  }
  const tokens = [];
  let cur = "";
  let started = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "'") {
      const end = source.indexOf("'", i + 1);
      if (end === -1) return { refused: "guillemet simple non fermé" };
      cur += source.slice(i + 1, end);
      started = true;
      i = end;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < source.length && source[j] !== '"'; j++) {
        if (source[j] === "\\" && '$`"\\'.includes(source[j + 1] ?? "")) j++;
        if (source[j] === "$" || source[j] === "`")
          return { refused: "substitution de shell" };
        cur += source[j];
      }
      if (j >= source.length) return { refused: "guillemet double non fermé" };
      started = true;
      i = j;
    } else if (c === "\\") {
      cur += source[i + 1] ?? "";
      started = true;
      i++;
    } else if (/\s/u.test(c)) {
      if (started) tokens.push(cur);
      cur = "";
      started = false;
    } else if ("|;&<>$`(){}".includes(c)) {
      return { refused: `opérateur de shell « ${c} »` };
    } else {
      cur += c;
      started = true;
    }
  }
  if (started) tokens.push(cur);
  if (tokens[0] !== PROGRAM)
    return { refused: `programme « ${tokens[0]} » (seul rg est exécuté)` };
  const args = tokens.slice(1);
  for (const { arg: a, role } of classifyArgs(args)) {
    if (role === "flag") {
      const flag = a.split("=")[0];
      if (FORBIDDEN_FLAGS.has(flag))
        return { refused: `option « ${flag} » interdite` };
      if (/^-[a-zA-Z]+$/u.test(a) && /[zr]/u.test(a.slice(1)))
        return { refused: `option « ${a} » interdite (-z ou -r)` };
    }
    // Seul ce que `rg` LIT est un chemin : pas le motif, pas la valeur de `-g`.
    if (
      role === "path" &&
      (path.isAbsolute(a) || a.split(/[\\/]/u).includes(".."))
    )
      return { refused: `chemin hors du dépôt « ${a} »` };
  }
  return { argv: args, countLines };
}

/**
 * Donne son rôle à chaque argument de `rg` : option, valeur d'option, motif,
 * ou chemin lu. Seule source de ce classement — la garde de chemin et le
 * développement des motifs de fichiers le lisent tous deux.
 *
 * @returns `[{ arg, role }]`, `role` ∈ `flag` · `value` · `pattern` · `path`
 */
export function classifyArgs(args) {
  const out = [];
  // Avec `-e`/`-f`, le motif est une valeur d'option : tout positionnel est un chemin.
  let patternSeen = args.some((a) =>
    ["-e", "--regexp", "-f", "--file"].includes(a),
  );
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("-")) {
      out.push({ arg: a, role: "flag" });
      if (OPTIONS_WITH_VALUE.has(a) && i + 1 < args.length) {
        // `-f motifs.txt`, `--ignore-file x` : la valeur est un fichier LU.
        out.push({
          arg: args[++i],
          role: OPTIONS_READING_FILE.has(a) ? "path" : "value",
        });
      }
      continue;
    }
    out.push({ arg: a, role: patternSeen ? "path" : "pattern" });
    patternSeen = true;
  }
  return out;
}

/**
 * Compte ce que rend une commande, selon ce qu'elle demande : la somme des
 * comptes pour `-c`/`--count`, sinon le nombre de lignes de la sortie.
 *
 * @param argv - arguments de `rg`
 * @param stdout - sortie de `rg`
 * @param countLines - la commande se terminait par `| wc -l`
 */
export function countOutput(argv, stdout, countLines) {
  const lines = stdout.split("\n").filter((l) => l.length > 0);
  if (countLines) return lines.length;
  const counts = argv.some(
    (a) =>
      a === "--count" ||
      a === "--count-matches" ||
      (/^-[a-zA-Z]+$/u.test(a) && a.includes("c")),
  );
  if (!counts) return lines.length;
  return lines.reduce(
    (sum, l) => sum + Number(l.slice(l.lastIndexOf(":") + 1) || 0),
    0,
  );
}

/**
 * Développe un argument de chemin à motif (`docs/*.md`) comme le ferait le
 * shell de l'auteur ; un argument sans motif passe tel quel.
 */
function expandGlobs(args, repo) {
  const out = [];
  for (const { arg, role } of classifyArgs(args)) {
    // Ni le motif ni la valeur d'une option (`-g '*.ts'`) ne sont des chemins.
    if (role !== "path" || !/[*?[]/u.test(arg)) {
      out.push(arg);
      continue;
    }
    const hits = fs.globSync(arg, { cwd: repo });
    out.push(...(hits.length ? hits.sort() : [arg]));
  }
  return out;
}

/** Options de `rg` dont la valeur est un fichier que `rg` LIT. */
const OPTIONS_READING_FILE = new Set(["-f", "--file", "--ignore-file"]);

/** Options de `rg` qui prennent une valeur dans l'argument suivant. */
const OPTIONS_WITH_VALUE = new Set([
  "--ignore-file",
  "--type-add",
  "--sort",
  "--sortr",
  "--engine",
  "--max-filesize",
  "-j",
  "--threads",
  "-g",
  "--glob",
  "--iglob",
  "-t",
  "--type",
  "-T",
  "--type-not",
  "-e",
  "--regexp",
  "-f",
  "--file",
  "-m",
  "--max-count",
  "-A",
  "-B",
  "-C",
  "--max-depth",
  "-M",
  "--max-columns",
]);

/**
 * Relance une preuve et rend son verdict.
 *
 * @param proof - une entrée d'{@link extractProofs}
 * @param opts.repo - racine du dépôt (répertoire courant de `rg`)
 * @param opts.exec - `(argv, cwd) => { status, stdout, stderr }`, injectable
 * @returns `{ verdict, actual?, reason? }` : `OK`, `DÉMENTIE` (une absence ne
 *   tient plus), `ÉCART` (un compte a bougé), `CASSÉE`, `REFUSÉE`, `NON JUGÉE`
 */
export function runProof(proof, { repo, exec }) {
  if (proof.expected === null) return { verdict: "NON JUGÉE" };
  const parsed = parseCommand(proof.command);
  if ("refused" in parsed)
    return { verdict: "REFUSÉE", reason: parsed.refused };
  const argv = [
    "--no-config",
    "--color",
    "never",
    ...expandGlobs(parsed.argv, repo),
  ];
  const res = exec(argv, repo);
  // `rg` : 0 = trouvé, 1 = rien trouvé, 2 = erreur (chemin absent, motif invalide).
  if (res.status === 2 || res.status === null) {
    return {
      verdict: "CASSÉE",
      reason: (res.stderr || "").split("\n")[0].slice(0, 120),
    };
  }
  const actual =
    res.status === 1
      ? 0
      : countOutput(parsed.argv, res.stdout, parsed.countLines);
  if (actual === proof.expected) return { verdict: "OK", actual };
  return { verdict: proof.expected === 0 ? "DÉMENTIE" : "ÉCART", actual };
}
