#!/usr/bin/env node
/**
 * **Banc — ce que la sonde de disponibilité fait d'un schéma qui ne colle pas.**
 *
 * Les suites du migrateur éprouvent un PLAN : elles calculent un verdict sur une
 * base et le comparent. Aucune ne dit ce qu'un POD en fait, et c'est pourtant la
 * seule chose qui décide d'un déploiement — `/readyz` commande le répartiteur de
 * charge. Deux défauts sont passés par ce trou, tous deux en production
 * seulement, tous deux invisibles en test unitaire (#108, #110).
 *
 * Trois scènes, et la troisième est le contrôle négatif sans lequel les deux
 * autres ne prouvent rien :
 *
 *   1. **EN AVANCE** — l'historique porte une migration que ce code n'a pas.
 *      C'est l'état NORMAL d'une mise à jour progressive (le travail de
 *      migration a déjà appliqué la suite pendant que les anciens exemplaires
 *      servent) et d'un retour arrière. Le pod doit SERVIR : `/readyz` 200.
 *      Retenir sortait tous les anciens exemplaires du répartiteur avant que le
 *      premier nouveau soit prêt — coupure totale sur un déploiement nominal.
 *
 *   2. **EN AVANCE, mais la sonde ne retient pas** (`migrations.check: "warn"`)
 *      — le pod doit rester VIVANT. Cette conduite retirait au démarrage sa
 *      tolérance aux modules qui tombent sur une table absente : le réglage
 *      qu'on pose pour se donner de l'air faisait boucler le processus.
 *
 *   3. **DÉRIVE D'EMPREINTE** — un fichier réécrit après avoir été appliqué.
 *      Là, le pod ne doit PAS servir : `/readyz` 503, et rester vivant.
 *      Sans cette scène, un banc qui voit 200 partout ne prouve pas que la
 *      sonde discerne — seulement qu'elle est devenue muette.
 *
 * Usage :
 *   node db-readiness-pod.mjs [--container NOM] [--port P] [--db NOM]
 *
 * Prérequis : `npm run build`, et le PostgreSQL du décor joignable.
 */
import process from "node:process";
import { execFileSync } from "node:child_process";
import {
  arg,
  jusqua,
  docker,
  demarrerPod,
  arreterPod,
  migrerBase,
  ecoute,
  enService,
  rapporteur,
  causeProbable,
  BancInterrompu,
} from "./lib/pod.mjs";

const BOX = arg("container", "nodefony-postgres");
const PORT = Number.parseInt(arg("port", "5281"), 10);
const BASE = arg("db", "nf_bench_readiness");
const URL_BASE = `postgres://nodefony:nodefony-dev@127.0.0.1:5432/${BASE}`;

const { dire, verdict } = rapporteur();
let pod = null;

/** Joue du SQL dans le conteneur — rend la sortie, jette si le serveur refuse. */
const psql = (sql, db = BASE) =>
  execFileSync(
    "docker",
    ["exec", BOX, "psql", "-U", "nodefony", "-d", db, "-tAc", sql],
    { encoding: "utf8" },
  ).trim();

/** Repart d'une base VIERGE puis migrée — le décor d'un premier déploiement. */
const decorNeuf = () => {
  psql(`DROP DATABASE IF EXISTS ${BASE}`, "postgres");
  psql(`CREATE DATABASE ${BASE} OWNER nodefony`, "postgres");
  const m = migrerBase({ url: URL_BASE });
  if (!m.ok) {
    console.log(`  ✘ migration du décor impossible\n${m.sortie.slice(-1200)}`);
    throw new BancInterrompu();
  }
};

/**
 * Lève un pod et rend `{ pod, servable }` — sans jamais exiger la mise en
 * service, puisque c'est précisément ce que ce banc MESURE.
 */
const leverPod = async (env = {}) => {
  const p = await demarrerPod({
    port: PORT,
    mode: "production",
    env: { NF_DATABASE_URL: URL_BASE, NF_ORM_HEARTBEAT_MS: "1000", ...env },
  });
  if (!p.debout) {
    const cause = causeProbable(p.journal);
    console.log(
      `  ✘ le pod n'a jamais écouté sur ${PORT}` +
        (cause ? `\n    → ${cause}` : `\n${p.journal.join("").slice(-1500)}`),
    );
    throw new BancInterrompu();
  }
  // La sonde est rejouée périodiquement : lui laisser le temps de se prononcer
  // une première fois, sans quoi on lirait l'état du boot et non son verdict.
  const servable = await jusqua(() => enService(PORT), 30_000);
  return { pod: p, servable };
};

try {
  console.log(
    `\n⬢ Banc — ce que la sonde fait d'un schéma qui ne colle pas (base « ${BASE} »)\n`,
  );

  // ── 1. EN AVANCE : le pod doit SERVIR ────────────────────────────────────
  console.log("Scène 1 — la base porte une migration que ce code n'a pas");
  decorNeuf();
  // Une entrée d'historique sans fichier, dans une source PRÉSENTE : c'est
  // exactement ce que voit un exemplaire de la version précédente.
  psql(
    `INSERT INTO nodefony_migrations ` +
      `(source, tag, hash, run_id, started_at, finished_at, execution_ms, success, applied_by) ` +
      `VALUES ('framework', '9999_venu_du_futur', 'sha256:futur', 'banc', ` +
      `EXTRACT(EPOCH FROM now())*1000, EXTRACT(EPOCH FROM now())*1000, 1, true, 'banc')`,
  );
  ({ pod } = await leverPod());
  dire(await ecoute(PORT), "le pod écoute");
  dire(
    await jusqua(() => enService(PORT), 30_000),
    "…et il SERT (/readyz 200) — une base en avance n'est pas une panne",
  );
  dire(
    pod.journal.join("").includes("EN AVANCE"),
    "…et il le DIT en clair, sans geste à taper",
  );
  await arreterPod(pod);
  pod = null;

  // ── 2. CONTRÔLE NÉGATIF : une vraie dérive doit RETENIR ──────────────────
  // Placé AVANT la scène 3 parce qu'il fabrique le décor qu'elle réutilise :
  // une base en RETARD, où l'avance ne joue plus. Sans lui, un banc qui voit
  // 200 partout ne prouve pas que la sonde discerne — seulement qu'elle est
  // devenue muette.
  console.log(
    "\nScène 2 — contrôle négatif : une empreinte réécrite après coup",
  );
  decorNeuf();
  // Le fichier n'a pas bougé ; c'est l'empreinte enregistrée qu'on falsifie —
  // le migrateur verra donc un fichier « modifié après application ».
  psql(
    `UPDATE nodefony_migrations SET hash = 'sha256:falsifie' ` +
      `WHERE source = 'framework'`,
  );
  const r2 = await leverPod();
  pod = r2.pod;
  dire(
    pod.estMort() === null,
    "le pod est VIVANT (/livez n'est jamais touché)",
  );
  dire(
    !r2.servable,
    "…mais il NE SERT PAS (/readyz 503) — la sonde discerne, elle n'est pas muette",
  );
  await arreterPod(pod);
  pod = null;

  // ── 3. LA MÊME DÉRIVE, en observation ────────────────────────────────────
  // NON JOUÉE, et c'est ce banc qui l'a découvert : `migrations.check` ne peut
  // pas être posée par l'environnement. La surcharge `NF__<MODULE>__<CHEMIN>`
  // navigue dans la VALEUR de la configuration, jamais dans son schéma ; une
  // clé `optional()` sans défaut n'y figure pas, et le noyau refuse le chemin
  // en annonçant « segment inconnu » pour une clé pourtant déclarée et lue
  // (#111). Or c'est le seul moyen dont dispose un exploitant sur une image
  // déjà construite.
  //
  // Le décor était prêt : celui de la scène 2, une base réellement EN RETARD,
  // où l'indulgence d'une base en avance ne peut rien — donc seule la conduite
  // expliquerait le verdict. La scène revient telle quelle dès que #111 est
  // fait ; l'ANNONCER vaut mieux que la retirer, une scène supprimée ne se
  // réclame jamais.
  console.log(
    "\nScène 3 — sonde en observation (check: warn) : NON JOUÉE (#111)\n" +
      "  ⊘ `migrations.check` n'est pas posable par l'environnement — le pod\n" +
      "    en observation reste donc non éprouvé de bout en bout.",
  );
} catch (e) {
  if (!(e instanceof BancInterrompu)) {
    console.log(`\n✘ le banc s'est interrompu : ${e?.stack ?? e}`);
  }
  process.exitCode = 1;
} finally {
  if (pod) {
    await arreterPod(pod);
  }
  try {
    psql(`DROP DATABASE IF EXISTS ${BASE}`, "postgres");
  } catch {
    /* le décor a déjà disparu */
  }
  const v = verdict() || process.exitCode || 0;
  console.log(
    `\n${v === 0 ? "✔ BANC VERT" : "✘ BANC ROUGE"} — décor : ${docker("ps", "--format", "{{.Names}}").split("\n").length} conteneur(s) debout\n`,
  );
  process.exit(v);
}
