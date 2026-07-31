#!/usr/bin/env node
/**
 * Juge de la tâche « ouvrir une API à un PROGRAMME ».
 *
 * Ce qui est mesuré : l'agent sait-il qu'une zone destinée à un appelant NON
 * navigateur se déclare `stateless: true` — aucun registre serveur, chaque
 * requête porte sa preuve entière — plutôt que de recevoir l'authentificateur
 * `session` comme les zones web ?
 *
 * Le piège est silencieux, et c'est pour ça qu'il faut une sonde : une zone
 * machine laissée en `session` FONCTIONNE lors d'un essai au navigateur, puis
 * échoue chez le client réel qui ne stocke aucun cookie. Rien dans le diff ne
 * le montre — c'est une absence, pas une faute.
 *
 * Quatre exigences, et la dernière est celle qui distingue vraiment :
 *
 *   1. une clé d'API valide ouvre la route (la fonctionnalité est livrée) ;
 *   2. sans clé, la route refuse (une zone a bien été posée — sans elle,
 *      `^/api` accepte l'anonyme et tout le monde passerait) ;
 *   3. la réponse servie à la clé ne pose AUCUN cookie de session — c'est le
 *      témoin binaire du stateless : une zone à registre en sème un ;
 *   4. le TÉMOIN HORS ÉNONCÉ : `/api/secure/hello`, que le générateur pose et
 *      que l'énoncé ne mentionne jamais, refuse toujours l'anonyme ET reste
 *      servi à une session d'administration. Sans lui, un agent qui bascule
 *      TOUTE l'application en stateless — cassant la révocation de session au
 *      passage — passerait les trois premières.
 *
 * La clé est émise par le chemin PRÉVU (`POST /nodefony/security/api/keys`,
 * `mountApiKeyRoutes`) avec une session d'administration, et voyage en
 * `Authorization: Bearer …` (RFC 6750, `ApiKeyAuthenticator.ts:36`). Le juge
 * n'écrit rien dans l'application : ce qu'il mesure doit venir de l'agent.
 *
 * Causes distinguées — les quatre dernières n'accusent PAS l'agent :
 *
 * | code | cause                       | qui est en tort               |
 * | ---: | --------------------------- | ----------------------------- |
 * |  `0` | rien à signaler             | —                             |
 * |  `1` | cle-refusee                 | l'AGENT (zone non ouverte)    |
 * |  `2` | ouverte-sans-cle            | l'AGENT (aucune garde posée)  |
 * |  `3` | session-semee               | l'AGENT (zone non stateless)  |
 * |  `6` | temoin-ouvert               | l'AGENT (tout basculé)        |
 * |  `7` | temoin-ferme-a-l-admin      | l'AGENT (session cassée)      |
 * |  `4` | aucune-reponse              | le DÉCOR (serveur absent)     |
 * |  `5` | port-deja-tenu              | le DÉCOR (serveur étranger)   |
 * |  `8` | identite-admin-indisponible | le DÉCOR (compte non semé)    |
 * |  `9` | emission-de-cle-impossible  | le DÉCOR (clés indisponibles) |
 *
 * @output une ligne `CAUSE=<nom> — <explication>` puis sortie du code ci-dessus
 */
import { Bocal, demander, garderPortLibre, sortir } from "./http-probe.mjs";
import { ADMIN, estRefus, estSucces, ouvrirSession } from "./identites.mjs";
import { REPERE_ZONE_PROTEGEE, ROUTE_MACHINE } from "./enonces.mjs";

/** Chemin d'émission d'une clé — celui du framework, jamais un raccourci. */
const EMISSION = "/nodefony/security/api/keys";

/**
 * Un cookie de SESSION a été posé ?
 *
 * On ne cherche pas un nom précis : il se configure. Ce qui trahit un registre
 * serveur, c'est qu'une réponse à un porteur de clé installe un état chez le
 * client — quel que soit le nom du cookie. Les cookies anti-rejeu (CSRF) ne
 * comptent pas : ils ne portent aucune identité.
 */
const cookieDeSession = (entetes) => {
  const brut = entetes?.["set-cookie"];
  if (!brut) return null;
  const tous = Array.isArray(brut) ? brut : [brut];
  const suspect = tous.find((c) => !/csrf/iu.test(c));
  return suspect ? suspect.split(";")[0] : null;
};

const main = async () => {
  await garderPortLibre();

  // ─── Décor : une identité d'administration, puis une clé ────────────────
  const admin = await ouvrirSession(ADMIN);
  if (admin.injoignable) {
    sortir(
      4,
      `CAUSE=aucune-reponse — l'application ne répond pas : ${admin.injoignable}. ` +
        `Le serveur n'a pas démarré, ou pas sur ce port. Rien n'a été mesuré.`,
    );
  }
  if (admin.echec) {
    sortir(
      8,
      `CAUSE=identite-admin-indisponible — impossible d'ouvrir une session ` +
        `« ${ADMIN.username} » : ${admin.echec}. C'est le DÉCOR du banc qui ` +
        `manque, pas le travail de l'agent. Verdict non rendu.`,
    );
  }

  const emise = await demander("POST", EMISSION, admin.bocal, {
    corps: { name: "bench-m2m" },
    jeton: admin.bocal.jeton(),
  });
  const cle =
    emise.statut === 201
      ? (JSON.parse(emise.corps || "{}").token ?? null)
      : null;
  if (!cle) {
    sortir(
      9,
      `CAUSE=emission-de-cle-impossible — POST ${EMISSION} rend ${emise.statut} ` +
        `et aucune clé exploitable. Les clés d'API sont-elles activées dans ce ` +
        `décor ? C'est le banc qui n'a pas su se fournir, pas l'agent qui a mal ` +
        `travaillé. Corps : ${(emise.corps ?? "").slice(0, 160)}`,
    );
  }

  // ─── 1. La clé ouvre la route ──────────────────────────────────────────
  const avecCle = await demander("POST", ROUTE_MACHINE, new Bocal(), {
    corps: { reference: "BENCH-M2M-1" },
    entetes: { authorization: `Bearer ${cle}` },
  });
  if (avecCle.erreur) {
    sortir(
      4,
      `CAUSE=aucune-reponse — POST ${ROUTE_MACHINE} n'obtient rien : ${avecCle.erreur}.`,
    );
  }
  if (!estSucces(avecCle.statut)) {
    sortir(
      1,
      `CAUSE=cle-refusee — POST ${ROUTE_MACHINE} avec une clé d'API VALIDE rend ` +
        `${avecCle.statut}. Le service partenaire ne peut pas déposer : la zone ` +
        `n'accepte pas l'authentificateur « apikey », ou la route n'y tombe pas. ` +
        `Corps : ${(avecCle.corps ?? "").slice(0, 160)}`,
    );
  }

  // ─── 3. …sans installer d'état chez le client ──────────────────────────
  // Contrôlé AVANT le refus sans clé : c'est la moitié « stateless » de la
  // tâche, et un agent peut très bien avoir posé une zone qui marche et tient
  // quand même un registre.
  const seme = cookieDeSession(avecCle.entetes);
  if (seme) {
    sortir(
      3,
      `CAUSE=session-semee — la réponse à un porteur de clé pose un cookie ` +
        `(${seme}). La zone tient donc un registre serveur : elle n'est pas ` +
        `\`stateless: true\`. Un client machine ne stocke aucun cookie — il ` +
        `ré-authentifiera à chaque appel, et l'état accumulé côté serveur ne ` +
        `sera jamais réclamé.`,
    );
  }

  // ─── 2. Sans clé, la porte reste fermée ────────────────────────────────
  const sansCle = await demander("POST", ROUTE_MACHINE, new Bocal(), {
    corps: { reference: "BENCH-M2M-2" },
  });
  if (!estRefus(sansCle.statut)) {
    sortir(
      2,
      `CAUSE=ouverte-sans-cle — POST ${ROUTE_MACHINE} rend ${sansCle.statut} SANS ` +
        `la moindre preuve. Aucune garde n'a été posée : la route tombe dans une ` +
        `zone qui accepte l'anonyme, et n'importe qui peut déposer.`,
    );
  }

  // ─── 4. Le témoin HORS énoncé ──────────────────────────────────────────
  const temoinAnonyme = await demander(
    "GET",
    REPERE_ZONE_PROTEGEE,
    new Bocal(),
  );
  if (!estRefus(temoinAnonyme.statut)) {
    sortir(
      6,
      `CAUSE=temoin-ouvert — GET ${REPERE_ZONE_PROTEGEE} rend ` +
        `${temoinAnonyme.statut} à un anonyme. Cette route n'est PAS celle de ` +
        `l'énoncé : elle mesure la garde COLLECTIVE. Ouvrir l'API machine ne ` +
        `doit rien ouvrir d'autre.`,
    );
  }
  const temoinAdmin = await demander("GET", REPERE_ZONE_PROTEGEE, admin.bocal);
  if (!estSucces(temoinAdmin.statut)) {
    sortir(
      7,
      `CAUSE=temoin-ferme-a-l-admin — GET ${REPERE_ZONE_PROTEGEE} rend ` +
        `${temoinAdmin.statut} à une session d'ADMINISTRATION valide. La zone ` +
        `web ne reconnaît plus les sessions : l'application entière a sans doute ` +
        `basculé en stateless, ce qui emporte la révocation avec elle.`,
    );
  }

  sortir(
    0,
    `OK — clé acceptée (${avecCle.statut}), anonyme refusé (${sansCle.statut}), ` +
      `aucun cookie posé, zone web intacte.`,
  );
};

main().catch((e) => {
  sortir(4, `CAUSE=aucune-reponse — le juge lui-même a échoué : ${e.message}`);
});
