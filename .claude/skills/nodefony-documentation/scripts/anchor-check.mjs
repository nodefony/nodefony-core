#!/usr/bin/env node
/**
 * anchor-check.mjs — vérifie l'EXACTITUDE des ancres `fichier:ligne` du corpus doc.
 *
 * doc-lint ne contrôle que la PRÉSENCE d'ancres ; ce check résout chacune contre le
 * code réel (la devise : « la confiance n'exclut pas le contrôle ») :
 *   - FILE_NOT_FOUND  : aucun fichier du repo ne correspond
 *   - LINE_OUT        : la ligne pointée dépasse la fin du fichier
 *   - SUSPECT         : fichier+ligne OK mais AUCUN des symboles cités autour de
 *                       l'ancre n'apparaît dans la fenêtre [début-10 .. fin+15]
 *   - OK              : fichier + ligne + au moins un symbole du contexte retrouvés
 *
 * Usage : node anchor-check.mjs <page.md> [...]   (exit 1 si FILE_NOT_FOUND/LINE_OUT)
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const REPO = execSync("git rev-parse --show-toplevel", {
  encoding: "utf8",
}).trim();
const args = process.argv.slice(2);
if (!args.length) {
  console.error("usage: node anchor-check.mjs <page.md> [...]");
  process.exit(2);
}

// Index de tous les .ts/.mjs/.tsx du repo (hors dist/node_modules) pour la
// résolution par suffixe/basename.
const allFiles = execSync(
  `find src docs bin . -maxdepth 1 -type f \\( -name '*.ts' -o -name '*.mjs' -o -name '*.tsx' \\) 2>/dev/null ; ` +
    `find src docs bin -type f \\( -name '*.ts' -o -name '*.mjs' -o -name '*.tsx' \\) ` +
    `-not -path '*/dist/*' -not -path '*/node_modules/*' 2>/dev/null`,
  { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)
  .trim()
  .split("\n")
  .filter(Boolean);

const byBasename = new Map();
for (const f of allFiles) {
  const b = path.basename(f);
  if (!byBasename.has(b)) byBasename.set(b, []);
  byBasename.get(b).push(f);
}

/** La page vit dans <module>/docs/ → prioriser les fichiers du module. */
function moduleRootOf(mdPath) {
  const m = mdPath.match(/(src\/(?:packages\/@nodefony\/[^/]+|nodefony))\//);
  return m ? m[1] : null;
}

function resolveCandidates(ref, moduleRoot) {
  // Chemin avec des dossiers → essai direct puis par suffixe.
  if (ref.includes("/")) {
    for (const base of [
      REPO,
      moduleRoot ? path.join(REPO, moduleRoot) : null,
    ]) {
      if (base && fs.existsSync(path.join(base, ref))) {
        return [path.relative(REPO, path.join(base, ref))];
      }
    }
    const suffix = allFiles.filter(
      (f) => f.endsWith(ref) || f.endsWith("/" + ref),
    );
    if (suffix.length) return suffix;
    // dernier recours : basename du chemin
    ref = path.basename(ref);
  }
  const cands = byBasename.get(ref) ?? [];
  if (cands.length > 1 && moduleRoot) {
    const inModule = cands.filter((f) => f.startsWith(moduleRoot));
    if (inModule.length) return inModule;
  }
  return cands;
}

/**
 * Symboles cités en `backticks` sur la ligne MD autour de l'ancre.
 *
 * `base` = nom du fichier visé, SANS extension (`Module` pour `Module.ts`). Il
 * est retiré des tokens : c'est le mot le moins informatif du lot, et il
 * apparaît partout dans son propre fichier — l'accepter revient à valider
 * n'importe quelle ligne. Vécu : les 16 ancres `Module.ts` d'une page étaient
 * toutes décalées d'une vingtaine de lignes, et le gate les rendait toutes OK
 * parce que le mot « Module » se lit à chaque page de `Module.ts`. Un gate qui
 * ne peut pas échouer ne prouve rien.
 */
function contextTokens(mdLine, anchorRaw, base, voisins = []) {
  const tokens = [...mdLine.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1])
    .filter((t) => t !== anchorRaw && !/\.(ts|mjs|tsx):\d/.test(t))
    .flatMap((t) => t.match(/[A-Za-z_$#][A-Za-z0-9_$]{2,}/g) ?? [])
    .filter(
      (t) =>
        ![
          "ts",
          "mjs",
          "tsx",
          "true",
          "false",
          "null",
          "undefined",
          "string",
          "number",
          "boolean",
          "const",
          "await",
          "async",
          "return",
          "export",
          "import",
          "this",
          "new",
        ].includes(t),
    )
    .filter((t) => t.toLowerCase() !== String(base ?? "").toLowerCase())
    // Une ligne porte souvent PLUSIEURS ancres — une rangée de tableau qui
    // aligne trois transports, une phrase qui oppose deux contextes. Les
    // symboles cités appartiennent alors à des fichiers DIFFÉRENTS : chercher
    // `WebsocketContext` dans `HttpContext.ts` fabrique un faux SUSPECT, et
    // c'est un faux qui apprend à ignorer le gate.
    .filter((t) => !voisins.some((v) => v.toLowerCase() === t.toLowerCase()));
  return [...new Set(tokens)];
}

const ANCHOR_RE =
  /`?([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:ts|mjs|tsx)):(\d+)(?:-(\d+))?`?/g;

/**
 * Noms des AUTRES fichiers cités par des ancres de la même ligne (sans
 * extension). Ils ne sont pas du contexte pour l'ancre courante : ils sont le
 * contexte de leur propre ancre.
 */
function voisinsDeLaLigne(mdLine, refCourante) {
  const out = new Set();
  for (const m of mdLine.matchAll(ANCHOR_RE)) {
    if (m[1] === refCourante) continue;
    out.add(path.basename(m[1]).replace(/\.(ts|mjs|tsx)$/, ""));
  }
  return [...out];
}

/**
 * Le symbole que l'ancre PROUVE : le dernier identifiant entre backticks placé
 * AVANT elle. Sert au DIAGNOSTIC (`--prouve`), pas au verdict : en faire le seul
 * critère a rendu 694 suspects sur 4 514 ancres, la plupart parce qu'une méthode
 * est citée par un nom que sa ligne de déclaration ne porte pas telle quelle.
 *
 * Une phrase cite volontiers plusieurs symboles, chacun avec sa propre ancre —
 * « `RealtimeClient` (`RealtimeClient.ts:194`) et côté serveur par
 * `ServerRealtimeSocket` (`ServerRealtimeSocket.ts:44`) ». Chercher TOUS les
 * symboles de la ligne dans CHAQUE fichier cible fabrique des suspects : on
 * exigeait de `RealtimeClient.ts` qu'il contienne `ServerRealtimeSocket`. Le
 * seul symbole qu'une ancre engage est celui qui la précède immédiatement ;
 * les autres ont la leur.
 *
 * Quand aucun symbole ne précède l'ancre, on retombe sur l'ensemble des
 * symboles de la ligne — mieux vaut un contexte large que pas de contrôle.
 */
function symboleProuve(mdLine, anchorRaw) {
  const at = mdLine.indexOf(anchorRaw);
  const avant = at > 0 ? mdLine.slice(0, at) : "";
  const ticks = [...avant.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  for (let i = ticks.length - 1; i >= 0; i--) {
    const brut = ticks[i];
    if (/\.(ts|mjs|tsx):\d/.test(brut)) continue; // c'est une autre ancre
    const nom = brut
      .replace(/\(.*$/, "")
      .split(".")
      .pop()
      ?.replace(/[^A-Za-z0-9_$#]/g, "");
    if (nom && nom.length > 2) return nom;
  }
  return null;
}

/**
 * Le symbole cité est-il DÉCLARÉ à la ligne pointée (à trois lignes près) ?
 *
 * C'est un critère d'ACCEPTATION, jamais de rejet. Une phrase cite plusieurs
 * symboles — « `RealtimeClient` (`RealtimeClient.ts:194`) et côté serveur
 * `ServerRealtimeSocket` (`ServerRealtimeSocket.ts:44`) » — et chercher TOUS les
 * mots de la phrase dans CHAQUE fichier faisait déclarer suspectes une vingtaine
 * d'ancres parfaitement justes. Quand le symbole que l'ancre PROUVE est là où
 * elle pointe, il n'y a rien à corriger, et le rapport doit se taire.
 *
 * L'inverse — n'exiger QUE ce symbole — a été essayé : 694 suspects sur 4 514,
 * parce qu'une méthode est souvent citée sous une forme que sa ligne de
 * déclaration ne porte pas. D'où l'asymétrie.
 */
function declareIci(code, sym, start) {
  const bare = sym.replace(/^#/, "");
  const esc = bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const motifs = [
    new RegExp(`^\\s*(export\\s+)?(abstract\\s+)?class\\s+${esc}\\b`),
    new RegExp(`^\\s*(export\\s+)?interface\\s+${esc}\\b`),
    new RegExp(`^\\s*(export\\s+)?(async\\s+)?function\\s+${esc}\\b`),
    new RegExp(`^\\s*(export\\s+)?(declare\\s+)?const\\s+${esc}\\b`),
    new RegExp(`^\\s*(export\\s+)?type\\s+${esc}\\b`),
    new RegExp(
      `^\\s{2,}(public |private |protected |static |readonly )*(async )?(get |set )?#?${esc}\\??\\s*[(<:=]`,
    ),
  ];
  for (
    let i = Math.max(0, start - 4);
    i < Math.min(code.length, start + 3);
    i++
  ) {
    if (motifs.some((m) => m.test(code[i] ?? ""))) return true;
  }
  return false;
}

let total = 0;
const problems = { FILE_NOT_FOUND: [], LINE_OUT: [], SUSPECT: [], INDECIS: [] };
const fileCache = new Map();
function linesOf(rel) {
  if (!fileCache.has(rel)) {
    fileCache.set(
      rel,
      fs.readFileSync(path.join(REPO, rel), "utf8").split("\n"),
    );
  }
  return fileCache.get(rel);
}

/**
 * Une page REMPLACÉE (`status: superseded`) est une PHOTO, pas une référence.
 *
 * Ses ancres décrivent le code tel qu'il était le jour de sa rédaction — c'est
 * exactement ce qui fait sa valeur. Les recaler sur le code d'aujourd'hui
 * falsifierait ce qu'elle rapporte, et les laisser signalées transforme le
 * rapport de ce gate en bruit permanent. Vécu : les neuf dernières ancres
 * suspectes du corpus appartenaient toutes à un seul rapport de mesure daté,
 * explicitement remplacé par une page vivante.
 *
 * La règle vit ICI, dans l'outil, et pas dans la liste de fichiers que la forge
 * lui passe : écrite dans l'invocation, elle serait à répéter à chaque appel et
 * n'existerait pas pour qui lance le script à la main.
 */
const estRemplacee = (contenu) => {
  const entete = contenu.match(/^---\n([\s\S]*?)\n---/);
  return entete ? /^status:\s*superseded\s*$/m.test(entete[1]) : false;
};

for (const md of args) {
  const moduleRoot = moduleRootOf(md.replace(/^tmp\/doc-corpus\//, ""));
  const brut = fs.readFileSync(md, "utf8");
  if (estRemplacee(brut)) {
    console.log(`\x1b[2m⏭  ${md} — page remplacée (status: superseded)\x1b[0m`);
    continue;
  }
  const mdLines = brut.split("\n");
  const pageProblems = [];

  mdLines.forEach((line, i) => {
    // Contexte = la ligne + la précédente : prettier wrappe les phrases, l'ancre
    // peut être séparée du symbole qu'elle prouve par un retour à la ligne.
    // SAUF dans un tableau : chaque rangée est autonome — hériter de la rangée
    // du dessus fabriquerait de faux symboles de contexte.
    const isTableRow = line.trimStart().startsWith("|");
    const mdLine = !isTableRow && i > 0 ? mdLines[i - 1] + " " + line : line;
    for (const m of line.matchAll(ANCHOR_RE)) {
      const [raw, ref, startS, endS] = m;
      total++;
      const start = Number(startS);
      const end = endS ? Number(endS) : start;
      const cands = resolveCandidates(ref, moduleRoot);
      if (!cands.length) {
        pageProblems.push({
          kind: "FILE_NOT_FOUND",
          ref: raw.replaceAll("`", ""),
          line: i + 1,
        });
        continue;
      }
      const tokens = contextTokens(
        mdLine,
        raw.replaceAll("`", ""),
        path.basename(ref).replace(/\.(ts|mjs|tsx)$/, ""),
        voisinsDeLaLigne(mdLine, ref),
      );
      let best = null; // "LINE_OUT" < "SUSPECT" < "OK"
      for (const cand of cands) {
        const code = linesOf(cand);
        if (start > code.length) {
          best ??= { kind: "LINE_OUT", cand, max: code.length };
          continue;
        }
        if (!tokens.length) {
          best = { kind: "OK", cand };
          break;
        }
        // Le symbole que l'ancre engage est là où elle pointe : c'est réglé.
        const prouve = symboleProuve(mdLine, raw.replaceAll("`", ""));
        if (prouve && declareIci(code, prouve, start)) {
          best = { kind: "OK", cand };
          break;
        }
        // Match insensible à la casse : `setFrameAuthorizer` doit satisfaire le
        // token `frameAuthorizer` (conventions camelCase vs nom de propriété).
        const win = code
          .slice(Math.max(0, start - 11), Math.min(code.length, end + 15))
          .join("\n")
          .toLowerCase();
        if (tokens.some((t) => win.includes(t.toLowerCase()))) {
          best = { kind: "OK", cand };
          break;
        }
        if (!best || best.kind === "LINE_OUT") {
          // Deux échecs très différents se cachaient sous un seul mot.
          //
          // Si un des symboles cherchés existe AILLEURS dans le fichier, l'ancre
          // vise le bon fichier et la mauvaise ligne : c'est actionnable, et le
          // rapport dit où aller. Si aucun ne s'y trouve, le gate ne sait tout
          // simplement pas ce qu'il cherche — le symbole appartient à l'ancre
          // voisine de la même phrase, ou c'est un littéral (`INFO`, un code
          // d'erreur) qui n'a pas de ligne de déclaration. Le classer SUSPECT
          // faisait crier le gate sur des ancres justes, et un gate qui crie
          // faux finit par ne plus être lu.
          const tout = code.join("\n").toLowerCase();
          const ailleurs = tokens.filter((t) => tout.includes(t.toLowerCase()));
          best = {
            kind: ailleurs.length ? "SUSPECT" : "INDECIS",
            cand,
            tokens,
            ailleurs,
          };
        }
      }
      if (best.kind !== "OK") {
        pageProblems.push({
          kind: best.kind,
          ref: raw.replaceAll("`", ""),
          line: i + 1,
          detail:
            best.kind === "LINE_OUT"
              ? `${best.cand} ne fait que ${best.max} lignes`
              : best.kind === "SUSPECT"
                ? `${best.cand} — symboles introuvables autour: ${best.tokens.slice(0, 4).join(", ")}` +
                  ` (mais « ${best.ailleurs[0]} » existe ailleurs dans le fichier)`
                : `${best.cand} — contexte non résolvable (${best.tokens.slice(0, 3).join(", ")}) :` +
                  ` littéral, ou symbole prouvé par une ancre voisine`,
        });
      }
    }
  });

  if (pageProblems.length) {
    console.log(`\n❌ ${md}`);
    for (const p of pageProblems) {
      problems[p.kind].push(`${md}: ${p.ref}`);
      console.log(
        `   [${p.kind}] l.${p.line} ${p.ref}${p.detail ? " → " + p.detail : ""}`,
      );
    }
  } else {
    console.log(`✅ ${md}`);
  }
}

const nf = problems.FILE_NOT_FOUND.length;
const lo = problems.LINE_OUT.length;
const su = problems.SUSPECT.length;
const ind = problems.INDECIS.length;
console.log(
  `\n${total} ancres — ${total - nf - lo - su - ind} OK · ${su} SUSPECT · ${ind} INDÉCIS` +
    ` · ${lo} LINE_OUT · ${nf} FILE_NOT_FOUND`,
);
if (ind) {
  console.log(
    `   (INDÉCIS = le gate ne sait pas quoi chercher — littéral, ou symbole que prouve l'ancre voisine.\n` +
      `    Ce n'est pas un défaut de la doc : ne pas « corriger » ces ancres sans les avoir lues.)`,
  );
}
process.exit(nf + lo ? 1 : 0);
