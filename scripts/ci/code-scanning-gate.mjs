#!/usr/bin/env node
/**
 * Fait ROUGIR l'analyse de code tant qu'une alerte reste ouverte sur la branche analysée.
 *
 * 🔴 Le trou qu'il bouche : le job CodeQL finit VERT dès que son analyse est
 * téléversée, quel que soit le nombre d'alertes qu'elle ouvre. Tout ce qui lit
 * « la CI est verte » — la garde de publication (`attendre-ci.mjs`), la ligne CI
 * de la reprise de session, l'humain qui regarde la forge — passait donc sur des
 * alertes `high` ouvertes depuis neuf jours, découvertes au moment de taguer une
 * release. Une alerte doit se voir au PUSH qui l'introduit, sur `dev`.
 *
 * Une absence voulue s'ÉNONCE : un faux positif se ferme sur la forge
 * (« Dismiss », avec son motif), jamais en relâchant ce gate.
 *
 * Le RAISONNEMENT est pur (`verdictAlertes`), éprouvé sans réseau ; la CLI
 * n'est que l'accès au monde.
 *
 * @usage node scripts/ci/code-scanning-gate.mjs --ref refs/heads/dev
 * @option --ref - la branche dont on juge les alertes (défaut : `GITHUB_REF`)
 * @option --repo - `org/dépôt` (défaut : `GITHUB_REPOSITORY`)
 * @env GITHUB_REF - posé par la forge
 * @env GITHUB_REPOSITORY - posé par la forge
 * @env GH_TOKEN - jeton avec `security-events: read`
 * @output la liste NOMMÉE des alertes ouvertes ; sortie 1 s'il y en a, 2 s'il n'a pas pu regarder
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * Le verdict sur les alertes ouvertes d'une branche.
 *
 * @param alertes - les alertes telles que l'API les rend (`number`, `rule`, `most_recent_instance`)
 * @returns `{ verdict: "vert" | "rouge", lignes }` — une ligne lisible par alerte ouverte
 */
export function verdictAlertes(alertes) {
  const ouvertes = (alertes ?? []).filter((a) => a.state === "open");
  const lignes = ouvertes
    .map((a) => {
      const gravite =
        a.rule?.security_severity_level ?? a.rule?.severity ?? "inconnue";
      const lieu = a.most_recent_instance?.location;
      const ou = lieu ? `${lieu.path}:${lieu.start_line}` : "lieu inconnu";
      return {
        gravite,
        texte: `#${a.number} ${gravite} ${a.rule?.id} — ${ou}`,
      };
    })
    .sort((x, y) => rang(x.gravite) - rang(y.gravite))
    .map((l) => l.texte);
  return { verdict: lignes.length === 0 ? "vert" : "rouge", lignes };
}

const ORDRE = ["critical", "high", "error", "medium", "warning", "low", "note"];
const rang = (g) => {
  const i = ORDRE.indexOf(g);
  return i === -1 ? ORDRE.length : i;
};

const arg = (nom, defaut = null) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const ref = arg("ref", process.env.GITHUB_REF);
  const depot = arg(
    "repo",
    process.env.GITHUB_REPOSITORY ?? "nodefony/nodefony-core",
  );
  if (!ref) {
    process.stderr.write(
      "code-scanning-gate : aucune branche à juger (--ref ou GITHUB_REF).\n",
    );
    process.exit(2);
  }
  let alertes;
  try {
    const brut = execFileSync(
      "gh",
      [
        "api",
        "--paginate",
        `repos/${depot}/code-scanning/alerts?state=open&ref=${encodeURIComponent(ref)}&per_page=100`,
        "--jq",
        ".[]",
      ],
      { encoding: "utf8" },
    );
    alertes = brut
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch (e) {
    // Ne pas avoir pu regarder n'est pas un vert.
    process.stderr.write(
      `✗ code-scanning-gate : alertes illisibles pour ${ref} — ${String(e.message).split("\n")[0]}\n`,
    );
    process.exit(2);
  }
  const v = verdictAlertes(alertes);
  if (v.verdict === "vert") {
    process.stdout.write(
      `✓ aucune alerte d'analyse de code ouverte sur ${ref}.\n`,
    );
    process.exit(0);
  }
  process.stderr.write(
    `✗ ${v.lignes.length} alerte(s) d'analyse de code ouverte(s) sur ${ref} :\n` +
      v.lignes.map((l) => `   ${l}`).join("\n") +
      "\n  Corriger le code, ou fermer un faux positif sur la forge AVEC son motif —\n" +
      "  jamais relâcher ce gate.\n",
  );
  process.exit(1);
}
