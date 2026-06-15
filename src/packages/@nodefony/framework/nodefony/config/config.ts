import { frameworkConfigSchema } from "./schema";

// Config par défaut DÉRIVÉE du schéma Zod (source unique — jamais de défaut
// écrit à la main, cf `feedback_config_validation_zod`). `parse({})` matérialise
// les défauts (`watch: true`). `router`/`adminBroker` restent absents (optional)
// → les Services reçoivent `undefined`, comportement historique inchangé.
export default {
  ...frameworkConfigSchema.parse({}),

  // ── P6 J3b — AIRE DATA PLANE (verrou du data plane d'admin) ──
  // C'est le FRAMEWORK qui porte l'aire, pas Studio : le data plane
  // /nodefony/<ns>/api/* est monté SANS condition par le broker du framework
  // (onKernelReady → broker.mountAll), donc il existe même sans Studio. Le
  // déclarant porte l'aire ; « pas de couplage à la vue » (Studio = vue, le data
  // plane = état du framework). Override inter-modules « module-security »,
  // appliqué par le Kernel AVANT la validation Zod du firewall (convention-frère
  // de src/modules/test/config.ts). framework n'importe JAMAIS security : si
  // security est absent, l'override est simplement ignoré (0 cycle).
  "module-security": {
    areas: {
      // Carve-out PUBLIC de la liveness/readiness, HORS `nodefony-admin`. Pattern
      // EXACT (`$`) → ne couvre QUE /nodefony/kernel/api/livez (jamais /info ni
      // /modules, qui restent fermés). Plus LONG que le pattern admin → le
      // firewall trie les zones par longueur de source décroissante
      // (firewall.ts) → cette zone gagne le match pour /livez. `anonymous` en
      // SECOND (mode "first") : une session BFF présente identifie l'admin (le
      // handler renvoie les détails) ; sans session, l'anonyme passe (minimum
      // vital) → les sondes k8s/Docker NON authentifiées vérifient que le pod est
      // UP. `realtime: false` : route HTTP pure (pas de handshake WS à fermer).
      "nodefony-liveness": {
        pattern: "^/nodefony/kernel/api/livez$",
        authenticators: ["session", "anonymous"],
        realtime: false,
      },
      "nodefony-admin": {
        // Tous les espaces data plane : /nodefony/<ns>/api(/...). Le (/|$) capture
        // aussi /nodefony/profiler/api (sans slash final). Pattern verrouillé par
        // securedArea.test.ts contre l'inventaire réel des namespaces.
        pattern: "^/nodefony/[^/]+/api(/|$)",
        authenticators: ["session"], // session BFF (cookie opaque). RBAC par rôle = P6.8.
        // Casier de session unique ("default", partagé app+admin) : le login BFF est
        // partagé → pas d'isolation par casier (sans traversée de contexte, non portée —
        // cf mémoire). Isolation admin/app = RBAC par rôle (P6.8), comme OWASP/Symfony.
        // défauts : security true (Zero Trust), mode "first", stateless false,
        // realtime true (la zone ferme AUSSI le WS — api.request + subscribe ;
        // opt-out explicite `realtime: false` pour une zone strictement HTTP).
      },
    },
  },
};
