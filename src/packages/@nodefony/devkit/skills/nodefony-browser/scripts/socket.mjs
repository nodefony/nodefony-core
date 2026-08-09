/**
 * Pilote un socket applicatif Nodefony DE BOUT EN BOUT, depuis une vraie page :
 * accueil, abonnement à un canal, action RPC, latence aller-retour, pont API,
 * reconnexion — et rend un verdict par étape.
 *
 * Le scénario s'exécute DANS la page (WebSocket du navigateur) : la connexion
 * porte les cookies de session et l'Origin réels — un client Node « à côté »
 * n'aurait ni l'un ni l'autre, et l'on croirait à un refus d'authentification
 * là où il n'y a qu'un décor faux. Le protocole parlé est celui du fil :
 * JSON-RPC 2.0, tel que documenté dans `references/socket.md` du skill.
 *
 * `@usage` docker exec <app>-browser node /app/see-screen/socket.mjs /chat/realtime
 * `@env` NF_BROWSER_BASE origine vue DEPUIS le conteneur (défaut https://host.docker.internal:5152)
 * `@env` NF_BROWSER_PAGE page ouverte AVANT le socket (défaut /) — c'est elle qui porte cookies et Origin
 * `@env` NF_BROWSER_SOCKET chemin du endpoint WebSocket (ou 1er argument) — REQUIS, rien n'est deviné
 * `@env` NF_BROWSER_LOGIN chemin du formulaire de connexion — requis dès qu'un identifiant est donné
 * `@env` NF_BROWSER_USER identifiant ; sans lui, aucune authentification n'est tentée
 * `@env` NF_BROWSER_PASSWORD mot de passe associé
 * `@env` NF_BROWSER_CHANNEL canal à écouter (défaut : le PREMIER canal annoncé par l'accueil)
 * `@env` NF_BROWSER_ACTION action RPC à appeler (facultatif — la latence la réutilise)
 * `@env` NF_BROWSER_ACTION_PARAMS paramètres JSON de l'action (défaut : aucun)
 * `@env` NF_BROWSER_API chemin d'une route à rejouer par le pont `api.request` (facultatif)
 * `@env` NF_BROWSER_SOCKET_WAIT fenêtre d'écoute du canal en ms (défaut 4000)
 * `@env` NF_BROWSER_PINGS nombre de mesures de latence (défaut 5)
 * `@requires` conteneur du profil `browser` démarré · serveur joignable · un endpoint temps réel exposé
 * `@output` un objet JSON sur stdout : accueil, abonnement, latence, api, reconnexion — un verdict par étape
 * `@exit` 0 scénario joué (les verdicts sont des DONNÉES) · 64 usage (endpoint manquant, params illisibles) · 65 accueil jamais reçu
 */
import { open, goTo } from "./lib/browser.mjs";
import { mediane } from "./lib/probes.mjs";

const ENDPOINT = process.argv[2] ?? process.env.NF_BROWSER_SOCKET ?? "";
if (!ENDPOINT.startsWith("/")) {
  // Rien n'est deviné : un endpoint temps réel est une route de TON
  // application. Une supposition enverrait la sonde ouvrir un socket sur une
  // route inexistante et conclure à une panne du serveur.
  console.error(
    "Donne le chemin du endpoint WebSocket (1er argument ou NF_BROWSER_SOCKET), par exemple /chat/realtime.",
  );
  process.exit(64); // EX_USAGE
}

let actionParams = null;
if (process.env.NF_BROWSER_ACTION_PARAMS) {
  try {
    actionParams = JSON.parse(process.env.NF_BROWSER_ACTION_PARAMS);
  } catch (e) {
    console.error(
      `NF_BROWSER_ACTION_PARAMS n'est pas du JSON : ${String(e).slice(0, 120)}`,
    );
    process.exit(64);
  }
}

const cfg = {
  endpoint: ENDPOINT,
  canal: process.env.NF_BROWSER_CHANNEL ?? "",
  action: process.env.NF_BROWSER_ACTION ?? "",
  actionParams,
  api: process.env.NF_BROWSER_API ?? "",
  attenteMs: Number(process.env.NF_BROWSER_SOCKET_WAIT ?? 4000),
  pings: Math.max(1, Number(process.env.NF_BROWSER_PINGS ?? 5)),
  timeoutMs: 8000,
  maxPoussees: 10,
  troncature: 200,
};

/**
 * Le scénario complet, exécuté dans la page — AUTOSUFFISANT (sérialisé par le
 * pilote, aucune fermeture sur ce module). Chaque attente est bornée : une
 * étape qui ne vient pas rend un verdict, jamais une sonde suspendue.
 */
async function scenarioSocket(conf) {
  const t0 = performance.now();
  const a = () => Math.round(performance.now() - t0);
  const url = location.origin.replace(/^http/, "ws") + conf.endpoint;
  const resultat = {
    endpoint: url,
    accueil: null,
    abonnement: null,
    latence: null,
    api: null,
    reconnexion: null,
  };
  let compteurId = 0;
  const enAttente = new Map();
  const poussees = [];
  const refus = [];
  const fermetures = [];

  // Ouvre un socket et attend l'ACCUEIL — la première notification poussée par
  // le serveur (méthode `realtime:welcome`). C'est la carte du territoire :
  // canaux, actions, identité résolue. Tant qu'il n'est pas là, rien d'autre
  // n'a de sens.
  const ouvrir = () =>
    new Promise((resoudre, rejeter) => {
      const ws = new WebSocket(url);
      const garde = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        rejeter(
          new Error(`accueil jamais reçu en ${conf.timeoutMs} ms sur ${url}`),
        );
      }, conf.timeoutMs);
      ws.addEventListener("close", (ev) => {
        fermetures.push({ a: a(), code: ev.code, raison: ev.reason });
      });
      ws.addEventListener("message", (ev) => {
        let frame;
        try {
          frame = JSON.parse(ev.data);
        } catch {
          return; // une frame illisible n'est pas à nous de la juger ici
        }
        if (frame.method === "realtime:welcome") {
          clearTimeout(garde);
          resoudre({ ws, accueil: frame.params ?? {} });
          return;
        }
        if (frame.method === "realtime:denied") {
          // Le refus d'une notification n'a pas de canal de réponse : le
          // serveur le rend OBSERVABLE par cette notification dédiée. Sans
          // elle, « zéro poussée » se lirait comme un canal silencieux.
          refus.push({ a: a(), ...frame.params });
          return;
        }
        if (frame.id != null && frame.method === undefined) {
          // `frame.id` arrive du fil : il ne sert de clé qu'après avoir été
          // reconnu pour ce que NOUS émettons — un entier de `compteurId`. Et
          // le rappel retrouvé n'est appelé qu'une fois CONSTATÉ appelable.
          // Une `Map` n'expose aucun prototype, donc l'exécution ne risquait
          // rien ; c'est l'analyse statique qui ne pouvait pas le savoir, et
          // une garde de type dit l'intention aussi bien qu'elle la prouve.
          const attente =
            typeof frame.id === "number" ? enAttente.get(frame.id) : undefined;
          if (typeof attente === "function") {
            enAttente.delete(frame.id);
            attente(frame);
          }
          return;
        }
        if (frame.method) {
          poussees.push({
            a: a(),
            methode: frame.method,
            charge: JSON.stringify(frame.params ?? null).slice(
              0,
              conf.troncature,
            ),
          });
        }
      });
    });

  // Une REQUÊTE corrélée : `id` attribué, réponse attendue, latence mesurée.
  // L'expiration rend un verdict local — aucun octet de plus sur le fil.
  const requete = (ws, methode, params, delaiMs) =>
    new Promise((resoudre) => {
      const id = ++compteurId;
      const depart = performance.now();
      // Une seule sortie, quel que soit le vainqueur de la course entre la
      // réponse et l'expiration : `clearTimeout` suffirait à l'exécution, mais
      // un verrou explicite dit l'intention à qui relit — et à l'analyseur.
      let rendu = false;
      const finir = (valeur) => {
        if (rendu) return;
        rendu = true;
        resoudre({ ...valeur, ms: Math.round(performance.now() - depart) });
      };
      const garde = setTimeout(() => {
        enAttente.delete(id);
        finir({ expiree: true });
      }, delaiMs);
      enAttente.set(id, (frame) => {
        clearTimeout(garde);
        finir({ frame });
      });
      const frame = { jsonrpc: "2.0", id, method: methode };
      if (params !== null && params !== undefined) frame.params = params;
      ws.send(JSON.stringify(frame));
    });

  const { ws, accueil } = await ouvrir();
  resultat.accueil = {
    recuApresMs: a(),
    protocole: accueil.protocol ?? null,
    canaux: accueil.channels ?? [],
    methodes: accueil.methods ?? [],
    identite: accueil.identity ?? null,
  };

  // ── Abonnement — notification SANS id : avec un id elle serait classée
  // requête, ne trouverait aucun handler, et récolterait un -32601. ──────────
  const canal = conf.canal || (accueil.channels ?? [])[0] || null;
  if (canal) {
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "subscribe",
        params: { channel: canal },
      }),
    );
    await new Promise((r) => setTimeout(r, conf.attenteMs));
    const recues = poussees.filter((p) => p.methode === canal);
    const refusCanal = refus.find((r2) => r2.channel === canal) ?? null;
    resultat.abonnement = {
      canal,
      fenetreMs: conf.attenteMs,
      total: recues.length,
      poussees: recues.slice(0, conf.maxPoussees),
      refus: refusCanal,
      // « SILENCIEUX » n'est pas « cassé » : un canal d'événements ne pousse
      // que quand il se passe quelque chose. Le refus, lui, est un verdict.
      verdict: refusCanal
        ? "REFUSÉ"
        : recues.length > 0
          ? "OK"
          : "SILENCIEUX — aucune poussée dans la fenêtre, pas forcément une panne",
    };
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "unsubscribe",
        params: { channel: canal },
      }),
    );
  } else {
    resultat.abonnement = {
      verdict: "AUCUN CANAL — rien d'annoncé par l'accueil, rien de demandé",
    };
  }

  // ── Latence — sur une méthode CORRÉLÉE uniquement. La notification `ping`
  // du battement de cœur est un no-op serveur : aucun pong n'en revient. ─────
  const methodeLatence = conf.action || (conf.api ? "api.request" : "");
  const paramsLatence = conf.action
    ? conf.actionParams
    : conf.api
      ? { path: conf.api }
      : null;
  if (methodeLatence) {
    const mesuresMs = [];
    let expirees = 0;
    let derniereErreur = null;
    for (let i = 0; i < conf.pings; i++) {
      const rep = await requete(
        ws,
        methodeLatence,
        paramsLatence,
        conf.timeoutMs,
      );
      mesuresMs.push(rep.ms);
      if (rep.expiree) expirees += 1;
      else if (rep.frame.error) derniereErreur = rep.frame.error;
    }
    resultat.latence = {
      methode: methodeLatence,
      mesuresMs,
      expirees,
      erreur: derniereErreur,
      // Une erreur corrélée reste un aller-retour COMPLET : la latence est
      // mesurée, mais le verdict la nomme — un RTT sur -32601 ne valide pas
      // l'action, seulement le fil.
      verdict:
        expirees > 0
          ? "EXPIRATIONS"
          : derniereErreur
            ? `RÉPOND EN ERREUR ${derniereErreur.code} — ${String(derniereErreur.message).slice(0, 80)}`
            : "OK",
    };
  } else {
    resultat.latence = {
      verdict:
        "NON MESURÉE — aucune méthode corrélée fournie (NF_BROWSER_ACTION ou NF_BROWSER_API)",
    };
  }

  // ── Pont API — la même route qu'en HTTP, rejouée sur le socket ─────────────
  if (conf.api) {
    const rep = await requete(
      ws,
      "api.request",
      { path: conf.api },
      conf.timeoutMs,
    );
    resultat.api = rep.expiree
      ? { chemin: conf.api, verdict: "EXPIRÉE" }
      : {
          chemin: conf.api,
          ms: rep.ms,
          verdict: rep.frame.error
            ? `ERREUR ${rep.frame.error.code} — ${String(rep.frame.error.message).slice(0, 80)}`
            : "OK",
          meta: rep.frame.meta ?? null,
          extrait: JSON.stringify(
            rep.frame.result ?? rep.frame.error ?? null,
          ).slice(0, conf.troncature),
        };
  }

  // ── Reconnexion — fermer, rouvrir, comparer l'identité ─────────────────────
  // L'identité est résolue au HANDSHAKE, jamais dans les frames : si elle
  // survit à la reconnexion, c'est que le cookie de session la porte — la
  // preuve qui compte pour une application qui reconnecte en production.
  const fermeA = a();
  ws.close(1000, "reconnexion volontaire");
  try {
    const seconde = await ouvrir();
    const avant = resultat.accueil.identite;
    const apres = seconde.accueil.identity ?? null;
    resultat.reconnexion = {
      fermeA,
      rouverteApresMs: a() - fermeA,
      memeIdentite:
        (avant?.userIdentifier ?? null) === (apres?.userIdentifier ?? null),
      verdict: "OK",
    };
    seconde.ws.close(1000, "fin de scénario");
  } catch (e) {
    resultat.reconnexion = {
      fermeA,
      verdict: `ÉCHEC — ${String(e && e.message ? e.message : e).slice(0, 140)}`,
    };
  }
  resultat.fermetures = fermetures;
  return resultat;
}

const { browser, ctx, page, reuse } = await open();
await goTo(page, ctx, process.env.NF_BROWSER_PAGE ?? "/", reuse);

let resultat;
try {
  resultat = await page.evaluate(scenarioSocket, cfg);
} catch (e) {
  // L'accueil qui ne vient jamais est LE symptôme à diagnostiquer en premier :
  // endpoint faux, page non authentifiée, ou Origin refusé par le serveur.
  console.error(
    `Scénario interrompu : ${String(e && e.message ? e.message : e).slice(0, 300)}\n` +
      `→ vérifier le chemin du endpoint, l'authentification (NF_BROWSER_USER + NF_BROWSER_LOGIN), et que la page ${process.env.NF_BROWSER_PAGE ?? "/"} appartient bien à la même origine.`,
  );
  await browser.close();
  process.exit(65); // EX_DATAERR
}

// La médiane se calcule ici, avec la fonction que les tests éprouvent — la
// moyenne serait déplacée par un seul aller-retour aberrant.
if (Array.isArray(resultat.latence?.mesuresMs)) {
  resultat.latence.medianeMs = mediane(resultat.latence.mesuresMs);
}

console.log(JSON.stringify(resultat, null, 2));
await browser.close();
