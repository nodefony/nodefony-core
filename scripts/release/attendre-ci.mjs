#!/usr/bin/env node
/**
 * Attend le verdict de la CI du commit qu'on s'apprête à publier — et REFUSE
 * s'il n'est pas vert.
 *
 * 🔴 Pourquoi ce script existe. Le tag et le push de la branche déclenchent des
 * workflows SÉPARÉS, qui courent en parallèle et s'ignorent complètement.
 * `release.yml` n'exerce que le build, le cœur du script de publication et
 * l'installation vierge en conteneur : les suites unitaires et d'intégration,
 * le typecheck, les gates du dépôt, l'analyse de sécurité et le code généré
 * vivent dans les workflows de la BRANCHE. Sans cette garde, une CI rouge
 * n'empêche rien — les quinze paquets partent, et npm ne reprend jamais une
 * version publiée.
 *
 * Le RAISONNEMENT vit dans `release-core.mjs` (`verdictCiDuCommit`), pur et
 * éprouvé sans réseau ; ici il n'y a que l'accès au monde : interroger l'API,
 * boucler, et rendre un code de sortie.
 *
 * `@usage` node scripts/release/attendre-ci.mjs --sha <sha> --run-id <id>
 * `@option` --sha - le commit à juger (défaut : `GITHUB_SHA`)
 * `@option` --run-id - l'exécution courante, pour ne jamais s'attendre soi-même
 * `@option` --timeout-min - abandon après N minutes (défaut 45)
 * `@env` GITHUB_REPOSITORY - `org/dépôt`, posé par la forge
 * `@env` GH_TOKEN - jeton de lecture des exécutions
 * `@output` le verdict, et la liste NOMMÉE de ce qui a échoué
 */
import { execFileSync } from "node:child_process";
import { verdictCiDuCommit, WORKFLOWS_NON_BLOQUANTS } from "./release-core.mjs";

const arg = (nom, defaut = null) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
};

const SHA = arg("sha", process.env.GITHUB_SHA);
const MOI = arg("run-id", process.env.GITHUB_RUN_ID);
const DEPOT = process.env.GITHUB_REPOSITORY ?? "nodefony/nodefony-core";
const LIMITE_MS = Number(arg("timeout-min", "45")) * 60_000;
const PAUSE_MS = 30_000;

if (!SHA) {
  process.stderr.write(
    "attendre-ci : aucun sha à juger (--sha ou GITHUB_SHA).\n",
  );
  process.exit(2);
}

/** Les exécutions du même commit, telles que la forge les rapporte. */
const lireRuns = () => {
  const brut = execFileSync(
    "gh",
    [
      "api",
      `repos/${DEPOT}/actions/runs?head_sha=${SHA}&per_page=100`,
      "--jq",
      ".workflow_runs[] | {nom: .name, statut: .status, conclusion: .conclusion, id: .id}",
    ],
    { encoding: "utf8" },
  );
  return brut
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
};

process.stdout.write(
  `Garde — la CI de ${SHA.slice(0, 8)} doit être verte avant toute publication.\n` +
    `  Non bloquants, et pourquoi :\n` +
    WORKFLOWS_NON_BLOQUANTS.map((e) => `    · ${e.nom} — ${e.motif}`).join(
      "\n",
    ) +
    "\n\n",
);

const debut = Date.now();
for (;;) {
  let runs;
  try {
    runs = lireRuns();
  } catch (e) {
    // Une panne d'API n'est pas un vert : on réessaie, et le délai tranchera.
    process.stdout.write(
      `  … API injoignable (${e.message.split("\n")[0]}), on réessaie.\n`,
    );
    runs = null;
  }

  if (runs) {
    const v = verdictCiDuCommit({ runs, moiMeme: MOI });
    if (v.verdict === "vert") {
      process.stdout.write(
        `✓ CI verte — ${v.juges.length} exécution(s) jugée(s).\n`,
      );
      process.exit(0);
    }
    if (v.verdict === "rouge") {
      process.stderr.write(`\n✗ PUBLICATION REFUSÉE — ${v.motif}\n`);
      process.exit(1);
    }
    process.stdout.write(
      `  … ${v.enCours.length} en cours : ${v.enCours.map((r) => r.nom).join(", ")}\n`,
    );
  }

  if (Date.now() - debut > LIMITE_MS) {
    process.stderr.write(
      "\n✗ PUBLICATION REFUSÉE — la CI de ce commit n'a pas rendu son verdict dans le délai.\n" +
        "  Un délai dépassé ne vaut pas un vert : relancer le tag quand la CI a fini.\n",
    );
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, PAUSE_MS));
}
