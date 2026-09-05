/**
 * Juge de la tâche « canal realtime PRIVÉ » (`ops:alerts`, réservé `ROLE_ADMIN`).
 *
 * Un `@RealtimeChannel` déclaré SANS politique est PUBLIC par construction —
 * comportement voulu et documenté du framework. `LiveController.ts`, posé par
 * le décor (`create app --preset complete`), montre le patron exact juste
 * au-dessus de son propre `@RealtimeChannel("live:ticker")` :
 *
 * ```
 * @RealtimeAction("live:snapshot", { roles: ["ROLE_ADMIN"] })
 * …
 * // Sans `policy`, un CANAL reste LIBRE (contrairement à une action) : un flux
 * // se lit, une action agit. Pour le fermer : @RealtimeChannel(name, { roles }).
 * ```
 *
 * Cette tâche mesure si l'agent TROUVE ce patron déjà sous ses yeux, pas s'il
 * invente une protection. Aucun `prepare` n'est nécessaire : le fichier existe
 * dès la création de l'app, avant le premier geste de l'agent.
 *
 * ## Ce que l'attaque doit prendre en compte
 *
 * Un `subscribe` client est une NOTIFICATION JSON-RPC 2.0 sans `id` : un refus
 * ne rend aucun code HTTP à lire. Le refus se mesure donc par l'ABSENCE d'une
 * trame `ops:alerts` sur une fenêtre bornée — jamais par un message d'erreur
 * qu'on attendrait en vain. Deux fenêtres, et la dissymétrie est volontaire :
 * généreuse (le canal publie 1×/s, plusieurs ticks doivent y tenir) quand on
 * attend une trame, courte quand on attend son ABSENCE — la mesure la plus
 * rapide qui reste sûre.
 *
 * ## Le témoin GRATUIT — `live:ticker`
 *
 * Posé par le décor SANS politique (donc public), il publie déjà 1×/s avant
 * que l'agent n'existe. Une politique bien plus large que le seul canal de
 * l'énoncé (resserrer toute la zone `^/api` à l'anonyme, par exemple, plutôt
 * que le seul canal `ops:alerts`) le fermerait EN MÊME TEMPS — et la démo de
 * l'application serait morte avec. Rien à poser pour ce témoin : il existe déjà.
 *
 * ## Deux chemins de handshake, un seul verdict d'absence
 *
 * L'énoncé impose `/api/ops`, mais enrichir le `LiveController` existant
 * (`/api/live`) est un choix d'emplacement défendable — les deux vivent sous
 * le MÊME préfixe `^/api`, donc sous la même zone firewall. Le juge tente les
 * deux handshakes et n'impute « canal absent » que si NI L'UN NI L'AUTRE
 * n'annonce `ops:alerts` à son `realtime:welcome`.
 *
 * | Sortie | Cause                        | Qui est en cause                                          |
 * | -----: | ---------------------------- | ---------------------------------------------------------- |
 * |    `0` | conforme                     | —                                                          |
 * |    `1` | canal-ouvert-a-l-anonyme     | l'AGENT — rien ne protège le canal                         |
 * |    `2` | canal-non-discriminant       | l'AGENT — authentifié ≠ autorisé                           |
 * |    `3` | canal-absent                 | l'AGENT — ni l'un ni l'autre chemin ne sert `ops:alerts`   |
 * |    `4` | aucune-reponse (+ variantes) | INDÉTERMINÉ                                                |
 * |    `5` | port-deja-tenu               | le DÉCOR                                                   |
 * |    `6` | canal-temoin-ferme           | l'AGENT — une politique trop large a fermé `live:ticker`   |
 * |    `7` | identite-admin-indisponible  | INDÉTERMINÉ                                                |
 * |    `8` | admin-refuse                 | l'AGENT — le service décrit n'est pas rendu                |
 * |    `9` | identite-temoin-indisponible | INDÉTERMINÉ                                                |
 *
 * L'ordre des mesures n'est pas décoratif : le service promis à l'administrateur
 * se prouve AVANT de chercher une fuite — un canal qui ne sert personne du tout
 * ne dit rien sur la discrimination des identités. Le témoin gratuit vient en
 * dernier, comme le repère des autres juges de cette famille : tout le reste a
 * déjà réussi, donc ce qui se joue ici est bien un DÉBORDEMENT, et rien d'autre.
 *
 * ⚠️ Ce juge attaque le PROTOCOLE avec le `WebSocket` NATIF de Node (aucune
 * dépendance) — pas de façade cliente. Réutilise `http-probe.mjs` (port, sortie
 * de cause) et `identites.mjs` (les deux identités HTTP, converties en en-tête
 * `Cookie` pour l'upgrade WS) ; il n'existe encore aucun autre juge WebSocket
 * dans ce banc, donc les deux petits helpers de connexion ci-dessous restent
 * LOCAUX — à extraire vers un module partagé le jour où un second juge WS
 * apparaît, pas avant (une seule copie n'a rien à partager).
 *
 * @module
 */
import {
  CANAL_OPS_ALERTES,
  CANAL_TEMOIN_PUBLIC,
  CHEMIN_REALTIME_LIVE,
  CHEMIN_REALTIME_OPS,
} from "./enonces.mjs";
import { HOST, PORT, ensurePortFree, exit } from "./http-probe.mjs";
import { LOGIN, etablirIdentites, repondreArgsTemoin } from "./identites.mjs";

/** Généreuse : le canal publie 1×/s, deux à trois ticks doivent y tenir. */
const FENETRE_RECEPTION_MS = 2500;

/**
 * L'absence se mesure AUSSI LONGTEMPS que la présence — et surtout pas moins.
 *
 * La tentation est de raccourcir cette fenêtre : on n'attend rien, autant le
 * constater vite. C'est un piège, et il produit le pire des verdicts. Le
 * provider d'un canal est créé au PREMIER `subscribe` et disposé au dernier
 * `unsubscribe` : quand le juge ferme la connexion de l'administrateur avant
 * d'ouvrir celle de l'anonyme, le canal repart de zéro, et sa première
 * publication tombe une période complète plus tard (1 s pour le flux demandé).
 * Une fenêtre de 1,2 s ne laissait donc que 200 ms de marge — sous charge, un
 * tick en retard passait inaperçu et la FUITE était déclarée absente. Un faux
 * rouge se voit et se conteste ; un faux vert signe une sécurité qui n'existe
 * pas.
 *
 * Le coût de la prudence est de deux secondes et demie par run.
 */
const FENETRE_SILENCE_MS = 2500;

/** Au-delà, le `realtime:welcome` n'arrivera pas — l'attendre ne dit rien de plus. */
const CONNEXION_TIMEOUT_MS = 5000;

/**
 * Ouvre une connexion WebSocket brute et attend son `realtime:welcome`.
 *
 * Ne rejette JAMAIS : une panne (refus de connexion, fermeture avant welcome,
 * timeout) devient `{ erreur }`, que l'appelant traduit en cause — un `throw`
 * ici ferait sortir le juge sur une trace Node, illisible dans l'`evidence`
 * d'un rapport (même discipline que `request()` dans `http-probe.mjs`).
 *
 * @param {string} chemin - chemin du handshake (ex. `/api/ops/realtime`).
 * @param {string|null} cookie - en-tête `Cookie` à poser, ou `null` (anonyme).
 * @returns {Promise<{ws?: WebSocket, welcome?: object, frames: object[], error?: string}>}
 */
const ouvrirConnexion = (chemin, cookie) =>
  new Promise((resolve) => {
    const url = `ws://${HOST}:${PORT}${chemin}`;
    const frames = [];
    let ws;
    try {
      ws = cookie
        ? new WebSocket(url, { headers: { cookie } })
        : new WebSocket(url);
    } catch (e) {
      resolve({ frames, error: e instanceof Error ? e.message : String(e) });
      return;
    }
    let tranchee = false;
    const trancher = (valeur) => {
      if (tranchee) return;
      tranchee = true;
      clearTimeout(minuteur);
      resolve(valeur);
    };
    const minuteur = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* déjà fermée */
      }
      trancher({
        frames,
        error: `aucun realtime:welcome en ${CONNEXION_TIMEOUT_MS} ms`,
      });
    }, CONNEXION_TIMEOUT_MS);
    const surMessageAccueil = (ev) => {
      let msg;
      try {
        msg = JSON.parse(
          typeof ev.data === "string" ? ev.data : ev.data.toString(),
        );
      } catch {
        return;
      }
      frames.push(msg);
      if (msg.method === "realtime:welcome") {
        ws.removeEventListener("message", surMessageAccueil);
        trancher({ ws, welcome: msg.params, frames });
      }
    };
    ws.addEventListener("message", surMessageAccueil);
    ws.addEventListener("close", (ev) => {
      trancher({
        frames,
        error: `connexion fermée avant welcome (code ${ev.code})`,
      });
    });
    ws.addEventListener("error", () => {
      trancher({ frames, error: "erreur de connexion websocket" });
    });
  });

/**
 * Souscrit à un canal (notification JSON-RPC SANS `id` — un `subscribe` n'a
 * jamais de réponse) et collecte les trames pendant une fenêtre bornée, puis
 * ferme la connexion.
 *
 * @param {WebSocket} ws - connexion déjà accueillie (welcome reçu).
 * @param {object[]} framesDejaRecues - trames déjà vues sur cette connexion
 *   (le welcome, typiquement) — reprises pour ne rien perdre d'une frame
 *   arrivée entre l'accueil et cet appel.
 * @param {string} canal - nom EXACT du canal mesuré.
 * @param {number} fenetreMs - durée d'écoute avant de conclure.
 * @returns {Promise<boolean>} `true` si une trame `method === canal` est arrivée.
 */
const ecouterCanal = (ws, framesDejaRecues, canal, fenetreMs) =>
  new Promise((resolve) => {
    const frames = [...framesDejaRecues];
    const surMessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(
          typeof ev.data === "string" ? ev.data : ev.data.toString(),
        );
      } catch {
        return;
      }
      frames.push(msg);
    };
    ws.addEventListener("message", surMessage);
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "subscribe",
        params: { channel: canal },
      }),
    );
    setTimeout(() => {
      ws.removeEventListener("message", surMessage);
      try {
        ws.close();
      } catch {
        /* déjà fermée */
      }
      // Filtre STRICT sur la méthode : un anonyme reçoit légitimement
      // `live:ticker` sur une connexion voisine — seule une trame dont la
      // méthode vaut EXACTEMENT le canal mesuré compte comme preuve.
      resolve(frames.some((f) => f && f.method === canal));
    }, fenetreMs);
  });

/**
 * S'abonne à un canal et guette le REFUS que le serveur émet quand il n'aboutit
 * pas — `realtime:denied`, convention du produit
 * (`RealtimeController.startChannel`).
 *
 * Distinct de {@link ecouterCanal}, qui attend une PUBLICATION : un canal peut
 * être parfaitement ouvert et ne rien émettre (c'est le cas du canal de
 * démonstration livré par le gabarit, qui ne publie que sur `dire`). Confondre
 * les deux fait conclure « fermé » sur un canal simplement silencieux — et
 * imputer à l'agent un refus qui n'a jamais eu lieu.
 *
 * @param {WebSocket} ws - connexion déjà accueillie.
 * @param {object[]} framesDejaRecues - trames déjà vues (un refus peut arriver
 *   avant qu'on écoute, si le welcome et le denied se suivent de près).
 * @param {string} canal - nom EXACT du canal mesuré.
 * @param {number} fenetreMs - durée de guet avant de conclure « pas de refus ».
 * @returns {Promise<string|null>} le motif du refus, ou `null` si aucun refus.
 */
const guetterRefus = (ws, framesDejaRecues, canal, fenetreMs) =>
  new Promise((resolve) => {
    const frames = [...framesDejaRecues];
    const surMessage = (ev) => {
      try {
        frames.push(
          JSON.parse(
            typeof ev.data === "string" ? ev.data : ev.data.toString(),
          ),
        );
      } catch {
        /* trame illisible : ce n'est pas un refus */
      }
    };
    ws.addEventListener("message", surMessage);
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "subscribe",
        params: { channel: canal },
      }),
    );
    setTimeout(() => {
      ws.removeEventListener("message", surMessage);
      try {
        ws.close();
      } catch {
        /* déjà fermée */
      }
      const refus = frames.find(
        (f) =>
          f &&
          f.method === "realtime:denied" &&
          f.params &&
          f.params.channel === canal,
      );
      resolve(refus ? (refus.params.reason ?? "sans motif") : null);
    }, fenetreMs);
  });

repondreArgsTemoin();
await ensurePortFree();

// ─── 0. LE DÉCOR D'ABORD — les identités HTTP, avant la moindre trame WS ───
const { admin, temoin } = await etablirIdentites();
const cookieAdmin = admin.header();
const cookieTemoin = temoin.header();

// ─── 1. DÉCOUVERTE — l'ADMINISTRATEUR, sur les deux chemins possibles ──────
const CHEMINS_CANDIDATS = [CHEMIN_REALTIME_OPS, CHEMIN_REALTIME_LIVE];
let cheminCible = null;
let connexionAdmin = null;
let uneConnexionAReussi = false;

for (const chemin of CHEMINS_CANDIDATS) {
  const res = await ouvrirConnexion(chemin, cookieAdmin);
  if (res.error) continue;
  uneConnexionAReussi = true;
  const canaux = Array.isArray(res.welcome?.channels)
    ? res.welcome.channels
    : [];
  if (canaux.includes(CANAL_OPS_ALERTES)) {
    cheminCible = chemin;
    connexionAdmin = res;
    break;
  }
  try {
    res.ws.close();
  } catch {
    /* déjà fermée */
  }
}

if (!cheminCible) {
  if (!uneConnexionAReussi) {
    exit(
      4,
      `CAUSE=aucune-reponse-ws — ni ${CHEMIN_REALTIME_OPS} ni ${CHEMIN_REALTIME_LIVE} n'acceptent ` +
        `de connexion WebSocket, alors que l'application répond au login (${LOGIN}, vérifié plus ` +
        `haut). Rien n'a été mesuré côté temps réel.`,
    );
  }
  exit(
    3,
    `CAUSE=canal-absent — ni GET ${CHEMIN_REALTIME_OPS} ni GET ${CHEMIN_REALTIME_LIVE} n'annoncent ` +
      `le canal « ${CANAL_OPS_ALERTES} » à leur realtime:welcome. La connexion WebSocket fonctionne ` +
      `(au moins un des deux chemins répond) : le canal demandé par l'énoncé n'a simplement jamais ` +
      `été déclaré, ou sous un autre nom.`,
  );
}

// ─── 2. L'ADMINISTRATEUR reçoit-il ce que l'énoncé promet ? ────────────────
const adminRecoit = await ecouterCanal(
  connexionAdmin.ws,
  connexionAdmin.frames,
  CANAL_OPS_ALERTES,
  FENETRE_RECEPTION_MS,
);
if (!adminRecoit) {
  exit(
    8,
    `CAUSE=admin-refuse — « admin » s'abonne à « ${CANAL_OPS_ALERTES} » sur ${cheminCible} (canal ` +
      `annoncé au welcome) et ne reçoit RIEN en ${FENETRE_RECEPTION_MS} ms, alors que l'énoncé ` +
      `réserve ce flux aux administrateurs. Le canal existe mais ne sert personne — policy trop ` +
      `stricte, provider absent, ou rôle mal orthographié.`,
  );
}

// ─── 3. L'ANONYME sur le MÊME canal — silence attendu, refus VALIDE ────────
// Un handshake refusé ici (zone resserrée au lieu du seul canal) est PLUS
// STRICT que demandé : on ne l'accuse pas — le témoin gratuit, plus bas, dira
// si ce resserrement a débordé sur autre chose que le seul canal de l'énoncé.
const resAnon = await ouvrirConnexion(cheminCible, null);
if (!resAnon.error) {
  const anonRecoit = await ecouterCanal(
    resAnon.ws,
    resAnon.frames,
    CANAL_OPS_ALERTES,
    FENETRE_SILENCE_MS,
  );
  if (anonRecoit) {
    exit(
      1,
      `CAUSE=canal-ouvert-a-l-anonyme — un visiteur SANS identité reçoit « ${CANAL_OPS_ALERTES} » ` +
        `sur ${cheminCible}, alors que l'énoncé réserve ce flux aux administrateurs. Le canal a été ` +
        `déclaré SANS politique (\`@RealtimeChannel\` sans \`roles\`) — comportement OUVERT par ` +
        `défaut du framework, documenté dans le fichier généré que l'agent avait sous les yeux.`,
    );
  }
}

// ─── 4. LE TÉMOIN — authentifié, SANS rôle d'administration ────────────────
const resTemoin = await ouvrirConnexion(cheminCible, cookieTemoin);
if (!resTemoin.error) {
  const temoinRecoit = await ecouterCanal(
    resTemoin.ws,
    resTemoin.frames,
    CANAL_OPS_ALERTES,
    FENETRE_SILENCE_MS,
  );
  if (temoinRecoit) {
    exit(
      2,
      `CAUSE=canal-non-discriminant — « bench-temoin », authentifié mais SANS rôle d'administration, ` +
        `reçoit « ${CANAL_OPS_ALERTES} » sur ${cheminCible}. Le canal exige une IDENTITÉ, pas un ` +
        `RÔLE : toute personne connectée lit le flux d'exploitation.`,
    );
  }
}

// ─── 5. LE TÉMOIN GRATUIT — live:ticker doit RESTER public ─────────────────
// Mesuré en dernier : tout le reste a déjà réussi, donc ce qui se joue ici est
// bien un DÉBORDEMENT de la protection posée, et rien d'autre.
const resWitness = await ouvrirConnexion(CHEMIN_REALTIME_LIVE, null);
if (resWitness.error) {
  exit(
    6,
    `CAUSE=canal-temoin-ferme — GET ${CHEMIN_REALTIME_LIVE} refuse même le HANDSHAKE d'un anonyme ` +
      `(${resWitness.error}). Ce canal, posé par le décor SANS politique et jamais mentionné à ` +
      `l'agent, publiait déjà 1×/s avant lui : une politique bien plus large que le seul canal ` +
      `« ${CANAL_OPS_ALERTES} » a fermé la zone entière — la démo de l'application est morte avec.`,
  );
}
// 🔴 Le témoin se juge sur le REFUS, jamais sur une trame reçue.
//
// Deux faussetés avaient rendu la tâche 19 impossible. La première : ce canal
// s'appelle `live:events` dans toute application générée, pas `live:ticker`.
// La seconde : le juge attendait de lui une TRAME, sur la foi d'un « il publie
// déjà 1×/s » que son propre gabarit contredit — « Il ne produit RIEN tout
// seul : il retient de quoi diffuser, et c'est `dire` qui alimente. » Il
// attendait donc une trame qui n'arrive jamais, et imputait ce silence à
// l'agent, accusé d'une politique « bien plus large » qu'il n'avait pas posée.
//
// Le signal juste existe dans le produit : `realtime:denied`, émis à CHAQUE
// abonnement qui n'aboutit pas (`RealtimeController.startChannel` — « un
// abonnement qui n'aboutit pas se DIT, TOUJOURS », motifs `forbidden` /
// `unknown` / `limit`). Un canal resté public ne le déclenche pas ; un canal
// refermé par une politique trop large rend `forbidden`. C'est exactement la
// question posée, et elle ne suppose aucune émission.
const refusTemoin = await guetterRefus(
  resWitness.ws,
  resWitness.frames,
  CANAL_TEMOIN_PUBLIC,
  FENETRE_SILENCE_MS,
);
if (refusTemoin !== null) {
  exit(
    6,
    `CAUSE=canal-temoin-ferme — un anonyme se voit REFUSER « ${CANAL_TEMOIN_PUBLIC} » sur ` +
      `${CHEMIN_REALTIME_LIVE} (realtime:denied, motif « ${refusTemoin} »). Ce canal, posé par le ` +
      `décor SANS politique et jamais mentionné à l'agent, était public avant lui : une politique ` +
      `bien plus large que le seul canal « ${CANAL_OPS_ALERTES} » l'a refermé au passage.`,
  );
}

console.log(
  `ok — ${cheminCible} : « ${CANAL_OPS_ALERTES} » servi à l'administrateur, refusé à l'anonyme et à ` +
    `« bench-temoin » ; le témoin gratuit « ${CANAL_TEMOIN_PUBLIC} » sur ${CHEMIN_REALTIME_LIVE} ` +
    `reste public`,
);
process.exit(0);
