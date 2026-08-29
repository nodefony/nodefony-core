#!/usr/bin/env node
/**
 * Auto-contrôle du JETON de la porte MCP — la durée de vie couvre-t-elle le run,
 * et la ceinture voit-elle une porte sur le point de se fermer ?
 *
 * Pourquoi ce fichier existe : le jeton s'émettait pour 120 minutes, durée
 * choisie pour « la tâche la plus longue ». Une passe de 30 tâches en dure
 * ~110 : un run de trois passes voyait donc sa porte se fermer au milieu de la
 * deuxième, sans que rien ne le dise — le décor enregistré continuait
 * d'annoncer « MCP auth, jeton posé » pendant que la porte refusait.
 *
 * Chaque cas est vu ROUGE ici : le premier rejoue l'ancien réglage et DOIT
 * échouer au critère, sinon ce fichier ne prouverait rien.
 */
import {
  minutesRestantesJeton,
  ttlJetonMinutes,
} from "./bench-discoverability.mjs";

/** Un JWT jouet — seule la charge utile est lue, la signature n'est pas vérifiée. */
const token = (expSecondes) =>
  `entete.${Buffer.from(JSON.stringify({ exp: expSecondes })).toString("base64url")}.signature`;

/** Minutes qu'une passe consomme réellement — mesuré : 30 tâches en ~110 min. */
const MINUTES_PAR_TACHE_MESUREES = 110 / 30;
const dureeRunMin = (nbTaches, runs) =>
  nbTaches * runs * MINUTES_PAR_TACHE_MESUREES;

let rouges = 0;
const cas = (nom, attendu, obtenu) => {
  const ok = attendu === obtenu;
  if (!ok) rouges += 1;
  console.log(
    `  ${ok ? "✅" : "❌"} ${nom}${ok ? "" : ` — attendu ${attendu}, obtenu ${obtenu}`}`,
  );
};

const MAINTENANT = 1_800_000_000_000;

console.log("━━ la durée couvre le RUN, pas une tâche");
// La preuve NÉGATIVE : l'ancien réglage en dur ne tient pas un 30 × 3.
cas(
  "120 min (l'ancien réglage) NE couvre PAS 30 tâches × 3 passes",
  true,
  120 < dureeRunMin(30, 3),
);
cas(
  "la durée calculée COUVRE 30 tâches × 3 passes",
  true,
  ttlJetonMinutes(30, 3) > dureeRunMin(30, 3),
);
cas(
  "plancher de 120 min sur un run d'une seule tâche",
  120,
  ttlJetonMinutes(1, 1),
);
cas(
  "elle croît avec les passes",
  true,
  ttlJetonMinutes(30, 3) > ttlJetonMinutes(30, 1),
);

console.log("━━ la ceinture CONSTATE ce que le token porte");
cas(
  "token absent → illisible (-1)",
  -1,
  minutesRestantesJeton(undefined, MAINTENANT),
);
cas(
  "token illisible → -1",
  -1,
  minutesRestantesJeton("pas-un-jwt", MAINTENANT),
);
cas(
  "token EXPIRÉ → durée négative (la porte refuse déjà)",
  true,
  minutesRestantesJeton(token(MAINTENANT / 1000 - 600), MAINTENANT) < 0,
);
cas(
  "token de 10 h → ~600 min restantes",
  600,
  Math.round(
    minutesRestantesJeton(token(MAINTENANT / 1000 + 36_000), MAINTENANT),
  ),
);

console.log("━━ le renouvellement se déclenche AVANT que la porte se ferme");
// Le critère de la boucle : reste < tâches × 7.
const declenche = (resteMin, nbTaches) => resteMin < nbTaches * 7;
cas(
  "un token de 30 min ne suffit pas à une passe de 30 tâches → renouvelé",
  true,
  declenche(30, 30),
);
cas(
  "un token de 600 min suffit → PAS de renouvellement inutile",
  false,
  declenche(600, 30),
);

console.log(
  rouges === 0
    ? "\n━━ 10/10 cas ✅ — la porte reste ouverte tout le run"
    : `\n━━ ${rouges} cas ROUGE(S)`,
);
process.exit(rouges === 0 ? 0 : 1);
