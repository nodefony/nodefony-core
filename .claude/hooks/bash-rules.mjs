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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const v = bashVerdict(fs.readFileSync(0, "utf8"));
  if (v) process.stdout.write(`${v.decision} ${v.reason}`);
}
