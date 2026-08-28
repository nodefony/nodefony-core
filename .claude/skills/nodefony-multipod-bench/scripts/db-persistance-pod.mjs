/**
 * Banc E2E SYSTÈME — une donnée écrite par HTTP survit-elle au pod qui l'a écrite ?
 *
 * C'est le seul « gap » que le tableau de migration déclare encore ouvert :
 * *Kernel réel + HTTP + ORM Docker persistant*. Les deux moitiés existaient et ne
 * se rencontraient jamais — les suites ORM éprouvent un connecteur isolé, sans
 * serveur ; le banc e2e éprouve un serveur, sans base. Personne ne franchissait
 * la frontière du CYCLE DE VIE du pod.
 *
 * La chaîne éprouvée, dans l'ordre :
 *
 *   démarrer le pod → POST qui ÉCRIT à travers le pipeline entier et le repository
 *   → transaction qui ÉCHOUE (rien ne doit rester) → ARRÊT GRACIEUX → REDÉMARRAGE
 *   → GET : la MÊME ligne revient-elle, avec le MÊME identifiant ?
 *
 * L'identifiant compte autant que la présence : une ligne recréée au boot par un
 * décor complaisant serait « trouvée » elle aussi. C'est l'empreinte qui prouve
 * que la donnée a traversé, pas qu'elle a été refaite.
 *
 * ⚠️ **Le pod tourne en `development`, et ce n'est pas un raccourci** : les routes
 * de sonde vivent dans `src/modules/test`, déclaré `policy: "dev"` — en production
 * le Kernel ne le charge pas et l'écriture répond 404 (constaté, pas déduit). Ce
 * que le banc prouve reste entier — Kernel réel, HTTP réel, base réelle, cycle de
 * vie réel. Ce qu'il ne prouve PAS, et qu'il faut donc savoir : le chemin de DDL
 * de production (`drizzle-kit`), qui n'est pas celui du `connect()` de développement.
 *
 * Usage :
 *   node db-persistance-pod.mjs                          # sqlite fichier (local, sans docker)
 *   node db-persistance-pod.mjs --url postgres://…       # base réelle
 *   node db-persistance-pod.mjs --url 'sqlite::memory:'  # DÉBRANCHEMENT — doit être ROUGE
 *
 * Prérequis : `npm run build`.
 */
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import {
  arg,
  jusqua,
  demarrerPod,
  arreterPod,
  rapporteur,
  BancInterrompu,
} from "./lib/pod.mjs";

const RACINE = process.cwd();
const PORT = Number.parseInt(arg("port", "5261"), 10);
const MODE = arg("mode", "development");
const ATTENTE = Number.parseInt(arg("attente", "90000"), 10);

// Défaut : un fichier sqlite DANS `tmp/`, donc réellement persistant, et le banc
// tourne sans docker. En forge, `--url` pointe le Postgres du décor.
const URL_DEFAUT = `sqlite:${path.join(RACINE, "tmp", "persistance-banc.sqlite")}`;
const URL_BASE = arg("url", process.env.NF_DATABASE_URL ?? URL_DEFAUT);

// La clé porte un identifiant unique : deux passes concurrentes (matrice CI,
// relance) ne peuvent pas se lire l'une l'autre et conclure faux.
const CLE = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
const ENV = { NF_DATABASE_URL: URL_BASE, NF_ORM_HEARTBEAT_MS: "1000" };

const { dire, verdict } = rapporteur();
const url = (p) => `http://127.0.0.1:${PORT}${p}`;

/** Appelle le banc en JSON — rend `{ status, corps }`, ne jette jamais. */
async function appel(chemin, methode = "GET") {
  try {
    const r = await fetch(url(chemin), {
      method: methode,
      signal: AbortSignal.timeout(15_000),
    });
    let corps = null;
    try {
      corps = await r.json();
    } catch {
      /* réponse non-JSON : le status parlera */
    }
    return { status: r.status, corps };
  } catch (e) {
    return { status: 0, corps: null, erreur: String(e.message).slice(0, 120) };
  }
}

/** Démarre un pod, ou arrête le banc en DISANT ce qu'il a lu du boot. */
async function leverPod(etiquette) {
  const pod = await demarrerPod({
    port: PORT,
    mode: MODE,
    env: ENV,
    attenteMs: ATTENTE,
    racine: RACINE,
  });
  if (!pod.debout) {
    const mort = pod.estMort();
    console.log(
      `  ✘ ${etiquette} n'a jamais écouté sur ${PORT}` +
        (mort ? ` (mort : code=${mort.code} sig=${mort.sig})` : " (muet)") +
        `\n${pod.journal.join("").slice(-2000)}`,
    );
    // Un pod peut être VIVANT sans écouter — boot bloqué, port déjà pris. Il
    // n'a pas encore été rangé dans `pod`, donc le `finally` ne le verra
    // jamais : c'est ICI, et nulle part ailleurs, qu'il faut l'arrêter. Et on
    // JETTE au lieu de sortir : un `process.exit()` posé dans le `try` ne
    // déroule aucun `finally`, le pod survit au banc avec son port et sa
    // connexion à la base, et c'est le run SUIVANT qui échoue pour une raison
    // qui n'est pas la sienne.
    await arreterPod(pod);
    throw new BancInterrompu();
  }
  console.log(`  ✔ ${etiquette} écoute sur ${PORT}`);
  return pod;
}

let pod = null;
try {
  console.log(
    `\n⬢ Banc E2E système — la donnée survit-elle au pod ?\n` +
      `  base : ${URL_BASE}\n  mode : ${MODE}\n  clé  : ${CLE}\n`,
  );

  console.log("Premier pod");
  pod = await leverPod("pod 1");

  // ── 1. Écriture, à travers le pipeline entier ────────────────────────────
  const ecrit = await appel(`/nodefony/test/db/persist/${CLE}`, "POST");
  const empreinte = ecrit.corps?.id ?? null;
  dire(
    ecrit.status === 200 && ecrit.corps?.written === true && !!empreinte,
    `écriture par HTTP acceptée (status ${ecrit.status}, id ${empreinte ?? "—"})` +
      (ecrit.corps?.reason ? ` — ${ecrit.corps.reason}` : ""),
  );
  if (!empreinte) {
    // Sans empreinte, tout ce qui suit mesurerait autre chose : mieux vaut
    // s'arrêter que rendre un vert qui ne porte sur rien.
    console.log(`\n${pod.journal.join("").slice(-2000)}`);
    throw new Error(
      "écriture impossible — le reste du banc ne prouverait rien",
    );
  }

  // ── 2. Une transaction qui échoue ne doit RIEN laisser ───────────────────
  const cleRollback = `${CLE}-rb`;
  const rb = await appel(
    `/nodefony/test/db/persist/${cleRollback}/rollback`,
    "POST",
  );
  dire(rb.corps?.rolledBack === true, "la transaction en échec a été annulée");
  const trace = await appel(`/nodefony/test/db/persist/${cleRollback}`);
  dire(
    trace.corps?.found === false,
    "…et elle n'a laissé AUCUNE ligne derrière elle",
  );

  // ── 3. Arrêt gracieux — la frontière que rien ne franchissait ────────────
  console.log("\nArrêt gracieux du pod 1");
  const gracieux = await arreterPod(pod);
  dire(gracieux, "le pod s'est arrêté sur SIGTERM (pas de SIGKILL de secours)");
  const rendu = await jusqua(
    async () => (await appel("/")).status === 0,
    15_000,
  );
  dire(rendu, "le port est réellement rendu");

  // ── 4. Redémarrage, et relecture ─────────────────────────────────────────
  console.log("\nSecond pod — même base, process neuf");
  pod = await leverPod("pod 2");
  const relu = await appel(`/nodefony/test/db/persist/${CLE}`);
  dire(
    relu.corps?.found === true,
    "la donnée écrite AVANT le redémarrage est là",
  );
  dire(
    relu.corps?.id === empreinte,
    `c'est la MÊME ligne, pas une recréation (attendu ${empreinte}, lu ${relu.corps?.id ?? "—"})`,
  );
} catch (e) {
  // Un abandon a DÉJÀ tout dit, journal du boot compris : le réafficher
  // n'ajoute qu'une seconde ligne au même constat.
  if (!(e instanceof BancInterrompu)) {
    console.log(`  ✘ ${String(e.message)}`);
  }
  process.exitCode = 1;
} finally {
  if (pod) {
    await arreterPod(pod);
  }
  const v = verdict() || process.exitCode || 0;
  console.log(`\n${v === 0 ? "✔ BANC VERT" : "✘ BANC ROUGE"}\n`);
  process.exit(v);
}
