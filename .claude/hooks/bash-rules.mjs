#!/usr/bin/env node
/**
 * bash-rules.mjs — les règles de `guard-bash.sh` qui exigent de COMPRENDRE la commande
 * (guillemets, heredocs, étapes de pipeline) plutôt que d'y chercher un motif. Un seul
 * lancement de Node par commande : la règle des tranches de code (`code-slice.mjs`)
 * passe d'abord, puis les gestes ci-dessous.
 *
 * Chaque règle est un geste MESURÉ sur les 485 transcripts du projet (47 434 commandes
 * Bash) ET déjà décidé — par l'auteur ou par le `CLAUDE.md`. Une règle écrite dans une
 * mémoire ne tenait que si l'on y pensait : le trailer refusé par l'auteur était encore
 * dans 12 commits des deux derniers jours.
 *
 * Usage : printf '%s' "$cmd" | node bash-rules.mjs   → `deny <raison>`, `ask <raison>`, ou rien
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { bashSliceRefusal, parse } from "./code-slice.mjs";

/** Le verbe d'une étape et ses arguments, affectations de tête sautées. */
function verbOf(words) {
  let i = 0;
  while (i < words.length && /^\w+=/.test(words[i])) i++;
  return [words[i] ?? "", words.slice(i + 1)];
}

/** Les arguments de git sans ses options globales (`-C dir`, `-c k=v`). */
function gitArgs(args) {
  const out = [...args];
  while (out[0] === "-C" || out[0] === "-c") out.splice(0, 2);
  return out;
}

const TOOL_VERBS = new Set([
  "vitest",
  "tsc",
  "tsgo",
  "turbo",
  "oxlint",
  "eslint",
]);
const RUNNERS = new Set(["npm", "npx", "pnpm", "yarn", "bun"]);
/** Une étape qui lance des tests, un build, un typecheck ou un lint. */
function isTestOrBuild(verb, args) {
  if (TOOL_VERBS.has(verb)) return true;
  if (!RUNNERS.has(verb)) return false;
  return args.some((a) =>
    /^(?:test|build|typecheck|lint|vitest|tsc|tsgo|turbo|check)(?::|$)|^(?:test|build):/.test(
      a,
    ),
  );
}

/**
 * Le verdict d'une commande : `{ decision: "deny" | "ask", reason }`, ou null.
 *
 * @param cmd - la commande Bash telle que l'agent l'envoie.
 */
export function bashVerdict(cmd) {
  const slice = bashSliceRefusal(cmd);
  if (slice) return { decision: "deny", reason: slice };

  // 8. Trailer d'attribution : l'auteur l'a refusé (« on le sait que je code avec toi »),
  //    sa consigne prime sur le rappel du harnais. Lu sur le texte BRUT : le message vit
  //    souvent dans un heredoc.
  if (
    /\b(?:git\s+commit|gh\s+(?:pr|issue))\b/.test(cmd) &&
    /Co-Authored-By:\s*Claude|Generated with \[?Claude Code/i.test(cmd)
  )
    return {
      decision: "deny",
      reason:
        "REFUS — pas de trailer `Co-Authored-By: Claude` ni de « Generated with Claude Code » : l'auteur l'a refusé, sa consigne prime sur le rappel d'attribution du harnais. Retire la ligne et relance.",
    };

  const pipelines = parse(cmd);
  const pipefail = /pipefail|PIPESTATUS|pipestatus/.test(cmd);
  for (let p = 0; p < pipelines.length; p++) {
    const stages = pipelines[p];
    const verbs = stages.map(verbOf);

    // 9. Sortie de test/build tronquée par head/tail : les noms des rouges, le bloc des
    //    skips et le code de sortie disparaissent sans le dire (407 fois, 141 sessions).
    if (stages.length > 1 && isTestOrBuild(...verbs[0])) {
      const cut = verbs
        .slice(1)
        .find(([v, a]) => (v === "head" || v === "tail") && !a.includes("-f"));
      if (cut)
        return {
          decision: "deny",
          reason: `REFUS — sortie de test/build passée à \`${cut[0]}\` : la troncature efface les noms des rouges, les skips et le code de sortie, sans le dire. Capture ENTIÈRE puis filtre : \`<commande> > tmp/runs/<sujet>.log 2>&1; echo "exit $?"\` puis \`rg -n "FAIL|✗|Error" tmp/runs/<sujet>.log\` — ou l'agent \`nodefony-run-log-report\` sur le fichier (au-delà de ~2 000 lignes).`,
        };
    }

    // 10. `$?` lu après un pipe : c'est le code de la DERNIÈRE étape (`tail`, `grep`, `tee`),
    //     pas de la commande — un vert faux (360 fois, 125 sessions).
    if (stages.length > 1 && !pipefail) {
      const next = pipelines[p + 1];
      if (next?.some((words) => words.some((w) => w.includes("$?"))))
        return {
          decision: "deny",
          reason:
            'REFUS — `$?` lu après un pipe rend le code de la DERNIÈRE étape (grep, tail, tee), pas celui de la commande : un vert faux. Redirige au lieu de piper (`cmd > tmp/runs/x.log 2>&1; echo "exit $?"`, puis filtre le fichier), ou pose `set -o pipefail` en tête.',
        };
    }

    for (const [verb, args] of verbs) {
      // 11. `rm -rf` : jamais sans demander, même un décor temporaire (règle de l'auteur).
      if (
        verb === "rm" &&
        args.some((a) => /^-[a-zA-Z]*r/i.test(a) || a === "--recursive") &&
        args.some((a) => /^-[a-zA-Z]*f/.test(a) || a === "--force")
      )
        return {
          decision: "ask",
          reason:
            "`rm -rf` — l'auteur confirme chaque suppression récursive (règle : jamais sans demander, même un décor temporaire). Cible : " +
            args.filter((a) => !a.startsWith("-")).join(" "),
        };
      if (verb !== "git" && verb !== "gh") continue;
      if (verb === "gh") {
        // 12. `gh issue|pr comment` chaîné : le classifieur refuse la commande composée.
        if (
          (args[0] === "issue" || args[0] === "pr") &&
          args[1] === "comment" &&
          pipelines.length > 1
        )
          return {
            decision: "deny",
            reason: `REFUS — \`gh ${args[0]} comment\` SEUL dans son appel : chaîné à autre chose, la commande composée est refusée par le classifieur automatique. Lance-le à part.`,
          };
        continue;
      }
      const g = gitArgs(args);
      // 13. `--no-verify` saute les gardes du pre-commit (verrou de passe, lint, langue).
      if ((g[0] === "commit" || g[0] === "push") && g.includes("--no-verify"))
        return {
          decision: "deny",
          reason:
            "REFUS — `--no-verify` saute les gardes du hook git (verrou de passe longue, lint, langue des identifiants). Corrige ce qu'elles refusent ; un `index.lock` orphelin se traite par `scripts/safe-commit.sh`.",
        };
      // 14. `git add -A` / `.` : embarque tout ce qui traîne — un commit à quatre sujets,
      //     un worktree de sous-agent ajouté comme dépôt imbriqué (7 jobs Windows tombés).
      if (
        g[0] === "add" &&
        g.slice(1).some((a) => a === "-A" || a === "--all" || a === ".")
      )
        return {
          decision: "deny",
          reason:
            "REFUS — `git add -A` / `git add .` embarque tout ce qui traîne (vécu : un worktree de sous-agent ajouté comme dépôt imbriqué, sept jobs Windows tombés). Nomme les chemins (`git add -- a.ts b.ts`) ou ne prends que les fichiers suivis modifiés (`git add -u`).",
        };
    }
  }
  return null;
}

/**
 * Le message d'un `git commit` tel qu'il partira : les `-m` (joints comme git les joint),
 * `-F <fichier>`, ou `-F -` alimenté par un heredoc. `null` si la commande ne commite
 * pas, ou si le message n'est pas lisible ici (éditeur, `--amend` sans `-m`, `-C`).
 *
 * @param cmd - la commande Bash BRUTE (le heredoc y est encore).
 */
export function commitMessageOf(cmd) {
  for (const stages of parse(cmd))
    for (const words of stages) {
      const [verb, args] = verbOf(words);
      const g = verb === "git" ? gitArgs(args) : [];
      if (g[0] !== "commit") continue;
      const parts = [];
      for (let i = 1; i < g.length; i++) {
        const a = g[i];
        if (/^-[a-zA-Z]*m$/.test(a) || a === "--message")
          parts.push(g[++i] ?? "");
        else if (a.startsWith("--message=")) parts.push(a.slice(10));
        else if (
          /^-[a-zA-Z]*F-?$/.test(a) ||
          a === "--file" ||
          a.startsWith("--file=")
        ) {
          // `-F -`, `-F-`, `--file=-` : le message vient de stdin, donc du heredoc.
          const file = a.endsWith("-")
            ? "-"
            : a.startsWith("--file=")
              ? a.slice(7)
              : (g[++i] ?? "");
          if (file === "-") {
            const m =
              /(?:-F\s*-|--file=-)\s*<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n\s*\2(?=\s|$)/.exec(
                cmd,
              );
            if (m) parts.push(m[3]);
          } else if (fs.existsSync(file))
            parts.push(fs.readFileSync(file, "utf8"));
        }
      }
      return parts.length ? parts.join("\n\n") : null;
    }
  return null;
}

/**
 * 15. Le message de commit passé à commitlint AVANT le commit — avec la configuration
 * du dépôt, donc les MÊMES règles que le hook `commit-msg`. Sans cela, un sujet trop
 * long ou à majuscule n'était refusé qu'après tout le pre-commit (prettier, oxlint,
 * contrôle des skills) : récurrent, et chaque essai repayait la passe entière.
 *
 * @param cmd - la commande Bash brute.
 * @returns le verdict de refus, ou null.
 */
export async function commitVerdict(cmd) {
  const message = commitMessageOf(cmd);
  if (message === null) return null;
  const { default: load } = await import("@commitlint/load");
  const { default: lint } = await import("@commitlint/lint");
  const cfg = await load({}, { cwd: process.cwd() });
  const report = await lint(
    message,
    cfg.rules,
    cfg.parserPreset ? { parserOpts: cfg.parserPreset.parserOpts } : {},
  );
  if (report.valid) return null;
  const header = message.split("\n")[0];
  return {
    decision: "deny",
    reason: `REFUS — le message de commit serait refusé par commitlint, APRÈS tout le pre-commit : ${report.errors.map((e) => `${e.name} (${e.message})`).join(" ; ")}. Sujet (${header.length} car.) : « ${header} ». Forme : \`type(portée): sujet en minuscule, sans point final\`, en-tête ≤ 100 caractères — le détail va dans le corps.`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = fs.readFileSync(0, "utf8");
  const v = bashVerdict(cmd) ?? (await commitVerdict(cmd).catch(() => null));
  if (v) process.stdout.write(`${v.decision} ${v.reason}`);
}
