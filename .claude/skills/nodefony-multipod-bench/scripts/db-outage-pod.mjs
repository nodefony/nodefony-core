#!/usr/bin/env node
/**
 * **Banc — une application Nodefony en PRODUCTION face à la chute de sa base.**
 *
 * Ce que les suites ORM ne peuvent pas prouver : elles éprouvent un connecteur
 * ISOLÉ. Ici c'est un POD entier, démarré comme en production (foreground,
 * cloud-native, un process = un pod), qui subit la coupure. Trois questions,
 * et ce sont celles qui décident du sort d'un déploiement :
 *
 *   1. le process SURVIT-il ? (une base tombée ne doit pas tuer le pod)
 *   2. l'application répond-elle TOUJOURS sur ce qui ne dépend pas de la base ?
 *   3. la santé ORM DIT-elle la vérité pendant la coupure, et après ?
 *
 * Le premier point n'est pas théorique : avant le câblage du pool `pg`, un
 * `docker stop` du serveur PostgreSQL faisait tomber le process Node — un pod
 * perdu pour une base momentanément absente, là où l'orchestrateur n'attendait
 * qu'un signal de non-disponibilité.
 *
 * Usage :
 *   node db-outage-pod.mjs [--workers N] [--container NOM] [--port P]
 *
 *   --workers N   nombre de pods (défaut 1). Au-delà de 1, le banc démarre un
 *                 CLUSTER : la coupure doit être vue par TOUS les pods, et
 *                 aucun ne doit mourir.
 *   --container   conteneur de base à couper (défaut nodefony-postgres).
 *   --port        port HTTP du premier pod (défaut 5251 — hors du dev).
 *
 * Prérequis : `npm run build`, et la base joignable.
 */
import process from "node:process";
import {
  arg,
  dormir,
  docker,
  jusqua,
  repond,
  demarrerPod,
  arreterPod,
} from "./lib/pod.mjs";

const WORKERS = Number.parseInt(arg("workers", "1"), 10);
const BOX = arg("container", "nodefony-postgres");
const PORT0 = Number.parseInt(arg("port", "5251"), 10);
const URL_BASE =
  process.env.NF_DATABASE_URL ??
  "postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony";

/** Démarre un pod de ce banc — le socle porte le geste, ce banc porte le décor. */
const leverPod = (index) =>
  demarrerPod({
    port: PORT0 + index * 2,
    mode: "production",
    env: {
      NF_DATABASE_URL: URL_BASE,
      // Un battement serré : le banc ne doit pas durer une minute pour
      // constater ce que la production constaterait en trente secondes.
      NF_ORM_HEARTBEAT_MS: "1000",
    },
  });

const pods = [];
let verdictGlobal = 0;
const dire = (ok, texte) => {
  console.log(`  ${ok ? "✔" : "✘"} ${texte}`);
  if (!ok) verdictGlobal = 1;
};

try {
  console.log(
    `\n⬢ Banc — ${WORKERS} pod(s) en PRODUCTION face à la chute de « ${BOX} »\n`,
  );
  console.log("Démarrage");
  for (let i = 0; i < WORKERS; i++) {
    const pod = await leverPod(i);
    pods.push(pod);
    if (!pod.debout) {
      console.log(
        `  ✘ pod ${i + 1} n'a jamais écouté sur ${pod.port}\n` +
          pod.journal.join("").slice(-1500),
      );
      process.exit(1);
    }
    console.log(`  ✔ pod ${i + 1} écoute sur ${pod.port}`);
  }

  console.log("\nCoupure de la base");
  docker("stop", BOX);
  await dormir(6000);

  for (const [i, pod] of pods.entries()) {
    // 1. LE point : un pod ne meurt pas parce que sa base est tombée.
    dire(
      pod.estMort() === null,
      `pod ${i + 1} — le process a SURVÉCU à la coupure` +
        (pod.estMort()
          ? ` (mort : code=${pod.estMort().code} sig=${pod.estMort().sig})`
          : ""),
    );
    // 2. Ce qui ne dépend pas de la base doit continuer de répondre.
    dire(
      await repond(pod.port),
      `pod ${i + 1} — l'application RÉPOND encore en HTTP`,
    );
  }

  console.log("\nRetour de la base");
  docker("start", BOX);
  const revenus = await jusqua(async () => {
    for (const pod of pods) {
      if (pod.estMort() !== null) return false;
      if (!(await repond(pod.port))) return false;
    }
    return true;
  }, 90_000);
  dire(revenus, "tous les pods répondent après le retour");
} finally {
  console.log("\nArrêt des pods");
  // Le socle attend la mort EFFECTIVE : rendre la main avant fait échouer le
  // banc suivant, sur le port que celui-ci n'a pas encore relâché.
  for (const pod of pods) {
    await arreterPod(pod);
  }
  try {
    docker("start", BOX);
  } catch {
    /* déjà démarré */
  }
  console.log(
    `\n${verdictGlobal === 0 ? "✔ BANC VERT" : "✘ BANC ROUGE"} — décor : ${docker("ps", "--format", "{{.Names}}").split("\n").length} conteneur(s) debout\n`,
  );
  process.exit(verdictGlobal);
}
