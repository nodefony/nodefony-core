#!/usr/bin/env node
/**
 * Juge du vérificateur du framework — et il NOMME le manquement.
 *
 * Le défaut qu'il corrige, mesuré sur une nuit entière de banc : le gate
 * lançait `npm run doctor` et jugeait sur le seul code de sortie. La cause
 * partait alors dans `expliquerEchec`, qui devine une ligne dans un rapport
 * écrit pour un HUMAIN — et rendait la bannière de l'outil
 * (`nodefony doctor · <app> <version>`), puis, cette bannière écartée, sa ligne
 * de RÉSUMÉ (`✗ 1 PROBLÈME 4 angles morts`). Aucune des deux ne dit LEQUEL.
 * Dix rouges sur treize, tous muets, et le décor remis à zéro entre chaque
 * tâche : rien n'était rejouable.
 *
 * `nodefony doctor --json` rend le MÊME document, structuré. Il n'y a donc plus
 * rien à deviner — l'automate produit, le juge lit.
 *
 * | Sortie | Cause                | Ce que ça dit                                       |
 * | -----: | -------------------- | --------------------------------------------------- |
 * |    `0` | conforme             | le vérificateur ne signale rien                     |
 * |    `1` | `doctor-manquement`  | il signale, et le juge NOMME le premier manquement  |
 * |    `2` | `doctor-illisible`   | la sortie n'est pas du JSON — l'INSTRUMENT a lâché  |
 *
 * 🔴 La distinction des deux dernières n'est pas cosmétique : `doctor-illisible`
 * est imputé au DÉCOR et retire au run le droit de conclure, quand
 * `doctor-manquement` est opposable à l'agent. Un juge qui les confond condamne
 * l'agent pour une panne d'outil — et un slug ABSENT de la table des
 * imputations serait pire encore : `imputationDe` rendrait `null`, donc
 * `estOpposable` faux, et le rouge cesserait SILENCIEUSEMENT de compter.
 *
 * La règle est PURE ({@link analyser}) et le monde reste dehors : c'est ce qui
 * permet de l'éprouver sans monter d'application, y compris sur les rapports
 * qu'aucun décor ne sait produire à la demande.
 *
 *   node gate-doctor.mjs            # juge l'application du répertoire courant
 *   node gate-doctor.selftest.mjs   # sa règle, sans application
 *
 * @module
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Profondeur maximale de traversée du rapport — garde-fou anti-cycle. */
const PROFONDEUR_MAX = 6;

/**
 * Tous les `findings` du rapport, à quelque profondeur qu'ils soient.
 *
 * Le document range ses constats par section (`freshness`, `readiness`,
 * `wiring`, `surface`, `guards`, `deep`) et en garde à la racine. Les énumérer
 * à la main daterait le juge à la première section ajoutée : un manquement
 * neuf serait alors invisible, et le juge rendrait « aucun constat » sur un
 * rapport qui en porte — le pire des verdicts, puisqu'il a l'air d'un verdict.
 *
 * @param {unknown} noeud - le rapport, ou l'une de ses sections.
 * @param {string} section - le nom de la section traversée.
 * @param {number} profondeur - garde-fou contre un document cyclique.
 * @returns {{section: string, kind: string, message: string}[]}
 */
export function tousLesConstats(noeud, section = "racine", profondeur = 0) {
  if (profondeur > PROFONDEUR_MAX || !noeud || typeof noeud !== "object") {
    return [];
  }
  const out = [];
  if (Array.isArray(noeud.findings)) {
    for (const f of noeud.findings) {
      out.push({
        section,
        kind: String(f?.kind ?? "?"),
        // Un message multiligne casserait le contrat `CAUSE=` de `lireCause`,
        // qui lit UNE ligne : on aplatit ici plutôt que chez le lecteur.
        message: String(f?.message ?? "")
          .replace(/\s+/gu, " ")
          .trim(),
      });
    }
  }
  for (const [cle, valeur] of Object.entries(noeud)) {
    if (cle === "findings" || !valeur || typeof valeur !== "object") continue;
    out.push(...tousLesConstats(valeur, cle, profondeur + 1));
  }
  return out;
}

/**
 * Le VERDICT, rendu sans toucher au monde.
 *
 * @param {{status: number|null, stdout: string, stderr: string}} execution -
 *   ce que le vérificateur a rendu.
 * @returns {{code: 0|1|2, cause: string, details: string[]}} le code de sortie,
 *   la ligne à écrire (au contrat `CAUSE=` dès que ce n'est pas un succès), et
 *   les constats suivants, un par ligne.
 */
export function analyser({ status, stdout, stderr }) {
  if (status === 0) {
    return {
      code: 0,
      cause: "ok — le vérificateur ne signale rien",
      details: [],
    };
  }
  let rapport;
  try {
    rapport = JSON.parse(stdout ?? "");
  } catch {
    const extrait = (stdout || stderr || "")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 160);
    return {
      code: 2,
      cause:
        `CAUSE=doctor-illisible — \`doctor --json\` n'a pas rendu de JSON ` +
        `(exit ${status}) : ${extrait || "sortie vide"}`,
      details: [],
    };
  }
  const constats = tousLesConstats(rapport);
  if (constats.length === 0) {
    return {
      code: 1,
      cause:
        `CAUSE=doctor-manquement — le vérificateur sort en ${status} sans nommer ` +
        `de constat (sections lues : ${Object.keys(rapport).join(", ") || "aucune"})`,
      details: [],
    };
  }
  const [premier, ...suivants] = constats;
  const reste = suivants.length > 0 ? ` — et ${suivants.length} autre(s)` : "";
  return {
    code: 1,
    cause:
      `CAUSE=doctor-manquement — ${premier.section}/${premier.kind} : ` +
      `${premier.message}${reste}`,
    details: suivants.map((c) => `  · ${c.section}/${c.kind} : ${c.message}`),
  };
}

// ─── Le monde, et lui seul ───────────────────────────────────────────────────
// Ce fichier est AUSSI importé par son auto-contrôle : n'exécuter que lancé
// directement, sans quoi le selftest monterait un `npm run doctor` à l'import.
// Comparaison de chemins RÉSOLUS : un test de suffixe ferait passer pour « lancé
// directement » tout script au nom identique dans un autre dossier — et sous
// Windows les séparateurs diffèrent des deux côtés.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  // `--` transmet l'option au binaire, le script de l'app étant
  // `nodefony doctor`. Le JSON sort sur la sortie standard ; npm garde ses
  // annonces sur le canal d'erreur, qui n'est donc pas lu pour le document.
  const r = spawnSync("npm", ["run", "doctor", "--", "--json"], {
    encoding: "utf8",
    timeout: 300_000,
  });
  const verdict = analyser({
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  });
  if (verdict.code === 0) console.log(verdict.cause);
  else {
    console.error(verdict.cause);
    for (const d of verdict.details) console.error(d);
  }
  process.exit(verdict.code);
}
