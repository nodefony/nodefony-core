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
  migrerBase,
  enService,
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

/**
 * Sentinelle d'abandon — arrête le banc EN PASSANT par le `finally`.
 *
 * Un `process.exit()` posé dans le `try` ne déroule aucun `finally` : les pods
 * déjà levés survivent au banc, gardent leur port ET leur connexion à la base,
 * et c'est le run SUIVANT qui échoue — sur un `DROP DATABASE` refusé, ou sur un
 * port occupé — pour une raison qui n'est pas la sienne. Mesuré : un décor
 * laissé en vrac a coûté un diagnostic entier.
 */
class BancInterrompu extends Error {}
const abandonner = (texte, journal = "") => {
  console.log(`  ✘ ${texte}${journal ? `\n${journal}` : ""}`);
  verdictGlobal = 1;
  throw new BancInterrompu();
};
const dire = (ok, texte) => {
  console.log(`  ${ok ? "✔" : "✘"} ${texte}`);
  if (!ok) verdictGlobal = 1;
};

try {
  console.log(
    `\n⬢ Banc — ${WORKERS} pod(s) en PRODUCTION face à la chute de « ${BOX} »\n`,
  );
  // Le décor AVANT les pods : en production personne ne fabrique le schéma, et
  // un pod dont le schéma est en retard retient sa mise en service — à raison.
  // Migrer ici, c'est jouer le déploiement que ce banc prétend éprouver.
  console.log("Migration de la base");
  const migration = migrerBase({ url: URL_BASE });
  if (!migration.ok) {
    abandonner(
      "la base n'a pas pu être migrée — le banc ne mesurerait rien",
      migration.sortie.slice(-1500),
    );
  }
  console.log("  ✔ schéma appliqué");

  console.log("\nDémarrage");
  for (let i = 0; i < WORKERS; i++) {
    const pod = await leverPod(i);
    pods.push(pod);
    if (!pod.debout) {
      abandonner(
        `pod ${i + 1} n'a jamais écouté sur ${pod.port}`,
        pod.journal.join("").slice(-1500),
      );
    }
    console.log(`  ✔ pod ${i + 1} écoute sur ${pod.port}`);
    // Écouter n'est pas SERVIR. Un pod retenu hors du service — schéma en
    // retard, base muette — écoute et répond `/livez` ; couper sa base à cet
    // instant mesurerait la survie d'un pod qui n'a jamais été en ligne. Le
    // banc l'exige donc AVANT de couper quoi que ce soit, et le dit s'il ne
    // l'obtient pas : c'est ce qui le rend rouge quand son décor est faux.
    if (!(await jusqua(() => enService(pod.port), 60_000))) {
      abandonner(
        `pod ${i + 1} écoute mais n'est jamais entré EN SERVICE ` +
          "(/readyz refuse) — le décor est faux, pas le produit",
        pod.journal.join("").slice(-1500),
      );
    }
    console.log(`  ✔ pod ${i + 1} est EN SERVICE`);
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
} catch (e) {
  verdictGlobal = 1;
  if (!(e instanceof BancInterrompu)) {
    console.log(`\n✘ le banc s'est interrompu : ${e?.stack ?? e}`);
  }
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
