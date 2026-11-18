/**
 * Garde d'audit de la forge : échoue sur toute vulnérabilité de gravité haute
 * ou critique, sauf un avis inscrit dans `ACCEPTED_ADVISORIES` tant qu'aucune
 * version corrigée n'est publiée.
 *
 * Un audit IMPOSSIBLE n'est pas une vulnérabilité TROUVÉE : `npm audit` rend `1`
 * dans les deux cas. Vécu trois runs de suite : le registre a rendu 503 puis un
 * timeout, et la forge est restée rouge une nuit sur une panne qui ne nous
 * appartenait pas. On réessaie donc, puis un registre injoignable donne un
 * AVERTISSEMENT annoncé dans le résumé du job — jamais un vert muet.
 *
 * `--fetch-timeout` n'est pas un confort : le défaut de npm est de cinq minutes
 * par essai, et le job entier était abandonné avant d'imprimer l'avertissement.
 *
 * @usage node scripts/deps/audit-gate.mjs
 */

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { advisoriesOf, auditVerdicts } from "./lib/audit.mjs";

/** Signatures d'un registre injoignable, et non d'une faille trouvée. */
const UNREACHABLE =
  /audit endpoint returned an error|ENOTFOUND|ETIMEDOUT|network timeout|503 Service Unavailable/;

let needsShell;
try {
  ({ needsShell } = await import("nodefony"));
} catch {
  console.error(
    "audit-gate : impossible de charger `nodefony` — le cœur n'est pas bâti.\n" +
      "  Ce script en dépend pour lancer npm de façon portable. → npm run build",
  );
  process.exit(1);
}

/**
 * Lance npm et rend sa sortie standard et d'erreur.
 *
 * @param {string[]} args
 * @returns {{ stdout: string, stderr: string }}
 */
function npm(args) {
  const r = spawnSync("npm", args, {
    encoding: "utf8",
    shell: needsShell("npm"),
    maxBuffer: 64 * 1024 * 1024,
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * Rapport JSON de `npm audit`, ou `null` si le registre n'a pas répondu.
 *
 * @returns {Promise<object | null>}
 */
async function audit() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { stdout, stderr } = npm([
      "audit",
      "--json",
      "--fetch-timeout=60000",
    ]);
    let report;
    try {
      report = JSON.parse(stdout);
    } catch {
      report = null;
    }
    if (report !== null && report.vulnerabilities !== undefined) return report;
    const all = `${stdout}\n${stderr}`;
    if (!UNREACHABLE.test(all)) {
      console.error(all);
      console.error("::error::npm audit n'a rendu aucun rapport lisible");
      process.exit(1);
    }
    console.log(
      `essai ${attempt} : le registre npm n'a pas répondu à l'audit — nouvelle tentative`,
    );
    await sleep(attempt * 15_000);
  }
  return null;
}

/**
 * Dernière version publiée d'un paquet (`dist-tags.latest`), ou `null`.
 *
 * @param {string} name
 * @returns {string | null}
 */
function latestOf(name) {
  const { stdout } = npm(["view", name, "version"]);
  const v = stdout.trim();
  return v === "" ? null : v;
}

const report = await audit();
if (report === null) {
  console.log(
    "::warning::AUDIT NON EXÉCUTÉ — le registre npm est resté injoignable sur 3 essais. " +
      "Ce job ne dit donc RIEN des vulnérabilités de cet arbre ; Dependabot et la prochaine " +
      "poussée le rejoueront.",
  );
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      "### ⚠️ Audit des dépendances NON exécuté\n\n" +
        "Le registre npm n'a pas répondu (`/-/npm/v1/security/advisories/bulk`) sur trois essais.\n" +
        "**Ce job ne dit rien des vulnérabilités de cet arbre.**\n",
    );
  process.exit(0);
}

const verdicts = auditVerdicts(advisoriesOf(report), latestOf);
const ADVICE = {
  VULNÉRABLE:
    "poser un `overrides` vers la version corrigée ; sans correctif publié, inscrire l'avis dans ACCEPTED_ADVISORIES avec son motif",
  "CORRECTIF-PUBLIÉ":
    "une version corrigée existe : poser l'`overrides`, puis retirer l'exception",
  "CORRECTIF-INCONNU": "dernière version illisible sur le registre — rejouer",
  "EXCEPTION-SANS-OBJET":
    "l'avis ne touche plus l'arbre : retirer l'exception de scripts/deps/lib/audit.mjs",
};
let fatal = 0;
for (const v of verdicts) {
  const what = v.name ? `${v.name} ${v.range} — ${v.title}` : "";
  if (v.verdict === "toléré") {
    console.log(
      `toléré   ${v.id}  ${what}\n         dernière version publiée ${v.latest}, toujours vulnérable — ${v.reason}`,
    );
    continue;
  }
  fatal++;
  console.log(
    `${v.verdict}  ${v.id}  ${what}\n         → ${ADVICE[v.verdict]}`,
  );
}
const counts = report.metadata?.vulnerabilities ?? {};
console.log(
  `\naudit : ${counts.high ?? 0} high, ${counts.critical ?? 0} critical (paquets touchés) — ` +
    `${verdicts.length - fatal} avis toléré(s), ${fatal} bloquant(s)`,
);
if (fatal > 0) {
  // Le titre dit la VRAIE cause : une exception devenue sans objet n'est pas
  // une faille — « vulnérabilités trouvées » a fait chercher une alerte qui
  // n'existait pas (avis retiré par GitHub, exception restée en place).
  const vulnerable = verdicts.some(
    (v) => v.verdict !== "toléré" && v.verdict !== "EXCEPTION-SANS-OBJET",
  );
  console.log(
    vulnerable
      ? "::error::npm audit a TROUVÉ des vulnérabilités de niveau high ou plus"
      : "::error::aucune vulnérabilité — une exception d'audit est devenue sans objet, la retirer",
  );
  process.exit(1);
}
