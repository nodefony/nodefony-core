export default {
  "module-http": {
    // Plus de racine statique `test` : le `public/` du module est auto-monté
    // sous le préfixe natif `/test/` par server-static (`mountModulePublics`).
    // Les fichiers vivent désormais à la racine de `public/` (pas `public/test/`).
    // Fixture de test : seuils d'upload BAS pour exercer les 413 (maxFileSize /
    // maxTotalFileSize) sans envoyer 500 MB. Les uploads réels des tests
    // (config.ts ~quelques Ko) restent largement sous ces limites.
    upload: {
      maxFileSize: 1048576, // 1 MB par fichier
      maxTotalFileSize: 1572864, // 1,5 MB cumulé / requête
    },
  },

  // Banc d'intégration P6 : la zone sécurisée vit AVEC le module qui la consomme
  // (override inter-modules `module-<nom>`, appliqué par le Kernel AVANT la
  // validation Zod du firewall). Le module test étant `policy: "dev"`, la zone
  // disparaît d'elle-même en production — pas besoin de `ctx.isDev`.
  "module-security": {
    // P6 J3 — pont config.encoders : consommé par le firewall au boot
    // (`container.set("passwordEncoder", ...)`) puis par le UserService du banc
    // (index.ts). 1re entrée = principal (argon2id), suivantes = legacy lecture
    // seule (bcrypt) → les comptes du banc naissent en bcrypt et migrent au
    // 1er login (même chaîne que J2, désormais PILOTÉE PAR LA CONFIG).
    encoders: {
      default: { type: "argon2id" },
      legacy: { type: "bcrypt", rounds: 10 },
    },
    areas: {
      // dossier = préfixe = nom de zone : capture les routes de `secure/`.
      // mode "first" : session BFF (cookie, J3) OU Basic (RFC 7617) — la
      // session est tentée d'abord (cookie repris AVANT le firewall) ; sans
      // preuve → 401 + WWW-Authenticate (RFC 7235, challenge Basic).
      "test-secure": {
        pattern: "^/nodefony/test/secure",
        authenticators: ["session", "userpassword"],
        // défauts : security: true (Zero Trust), mode: "first",
        // stateless: false (session BFF).
      },
      // P6 J4/P6.12 — zone API M2M : JWT Bearer (RFC 6750) ET clé API (PAT)
      // cohabitent. Un access token s'obtient via POST /nodefony/security/api/token
      // (grant credential) ; une clé API via POST /nodefony/security/api/keys (depuis
      // une session). Les deux se présentent en `Authorization: Bearer <…>` — la
      // discrimination se fait par FORME (JWT = `a.b.c`, PAT = `nf_…`), donc les deux
      // authenticators coexistent SANS ambiguïté (supports() mutuellement exclusifs).
      "test-api": {
        pattern: "^/nodefony/test/m2m",
        authenticators: ["jwt", "apikey"],
        stateless: true, // stateless : pas de session, identité 100 % portée par le bearer.
        // realtime: armé par DÉFAUT (zone protégée → WS fermé, Zero Trust) → le
        // handshake WS JWT sous /m2m est authentifié sans flag (P6 J8 volet b).
      },
      // P6.9 — zone SERVEUR DE RESSOURCE : jetons émis par un serveur
      // d'autorisation TIERS. `resource` est l'audience exigée (RFC 8707 §2) ;
      // sans elle, `external-jwt` refuse de démarrer — ce que le banc vérifie
      // en la retirant. L'émetteur déclaré plus bas est INJOIGNABLE par
      // construction : c'est ce qui permet d'éprouver sur le fil la seule chose
      // qu'aucun test unitaire ne peut montrer — qu'une panne de vérification
      // ressort en 503, et pas en 401.
      "test-external": {
        pattern: "^/nodefony/test/external",
        authenticators: ["external-jwt"],
        stateless: true,
        realtime: false,
        resource: "https://app.test.invalid/nodefony/test/external",
      },
      // P6.9 — zone du chemin du SUCCÈS. Elle exige l'audience que CETTE
      // application inscrit réellement dans ses jetons : `security.jwt.audiences`
      // est vide en dev, donc l'audience vaut l'émetteur (`resolveJwtRuntime`),
      // soit l'URL publique déclarée par `nodefony.config.ts`. Le banc le
      // CONSTATE au lieu de le supposer — il lit le document publié avant de
      // conclure quoi que ce soit.
      "test-self-external": {
        pattern: "^/nodefony/test/self-external",
        authenticators: ["external-jwt"],
        stateless: true,
        realtime: false,
        resource: "https://localhost:5152",
      },
      // P6.9 — la MÊME porte, une AUTRE ressource. Son unique raison d'exister
      // est de recevoir un jeton parfaitement valide — bon émetteur, bonne
      // signature, bon sujet, non expiré — et de le REFUSER, parce qu'il n'a pas
      // été délivré pour elle (RFC 8707 §2). C'est la seule garde qui empêche de
      // rejouer d'un service à l'autre le jeton d'un porteur légitime, et elle ne
      // se prouve qu'avec deux zones : une seule ne peut pas montrer un refus qui
      // ne tient QU'à l'audience.
      "test-foreign-audience": {
        pattern: "^/nodefony/test/foreign-audience",
        authenticators: ["external-jwt"],
        stateless: true,
        realtime: false,
        resource: "https://api.foreign.example/v1",
      },
    },
    // P6.9 — les ressources qu'un client peut NOMMER en demandant un jeton
    // (`resource`, RFC 8707). La première est l'audience par défaut : garder
    // l'émetteur en tête laisse inchangé tout jeton demandé sans `resource`.
    // La seconde n'existe que pour le banc : elle est l'audience de la zone
    // `test-foreign-audience`, ce qui permet de prouver la symétrie — chaque
    // jeton n'ouvre QUE la porte pour laquelle il a été demandé.
    jwt: {
      audiences: [
        "https://localhost:5152",
        "https://api.foreign.example/v1",
        // La porte MCP. Sans cette entrée, personne ne peut demander de jeton
        // POUR elle : la porte exige son URI en audience, l'émetteur refuserait
        // de l'inscrire, et l'application serait protégée par une porte que
        // rien ne sait ouvrir.
        "http://localhost:5151/nodefony/mcp",
      ],
    },
    // P6.9 — DEUX émetteurs, pour les deux moitiés du contrat.
    //
    // 1. `.invalid` : un émetteur qui n'existe pas et ne peut pas exister (RFC
    //    2606 réserve le domaine). Le jeu de clés est déclaré pour supprimer la
    //    découverte, et le délai est court : c'est le décor de la PANNE, dont le
    //    banc vérifie qu'elle ressort en 503 et jamais en 401.
    // 2. `https://localhost:5152` : cette application elle-même. Nodefony publie
    //    ses métadonnées RFC 8414 et son JWKS depuis la session 08-09g, donc elle
    //    est découvrable — y compris par elle-même. C'est ce qui rend le chemin du
    //    SUCCÈS jouable sur un vrai serveur sans démarrer d'IdP tiers.
    //    `jwksUri` est VOLONTAIREMENT absent : le déclarer supprimerait la
    //    découverte, c'est-à-dire précisément ce que ce décor doit éprouver.
    //    ⚠️ Le processus doit faire confiance au certificat de développement pour
    //    se joindre en https (`NODE_EXTRA_CA_CERTS`, posé par `start.sh`) — sans
    //    quoi la découverte échoue et la zone rend 503.
    resourceServer: {
      issuers: [
        {
          issuer: "https://auth.test.invalid/realms/nodefony",
          jwksUri: "https://auth.test.invalid/keys",
          algorithms: ["ES256"],
        },
        {
          issuer: "https://localhost:5152",
          algorithms: ["EdDSA"],
          // Cet émetteur EST cette application : ses `sub` sortent déjà de
          // l'annuaire local (`admin`), ils n'ont pas à être requalifiés. C'est
          // le seul cas où « subject » se justifie — on maîtrise l'espace de
          // noms parce qu'on le produit. Pour l'émetteur `.invalid` ci-dessus,
          // le défaut « prefixed » s'applique, et c'est lui qui empêche un
          // annuaire tiers de réclamer un compte local homonyme.
          subjectMapping: "subject",
        },
      ],
      timeoutMs: 1000,
    },
    // P6 J5 — CORS : une origine de confiance déterministe pour le banc
    // d'intégration `http/cors.test.ts` (preflight reflété + requête réelle).
    // `credentials:false` → reste compatible avec `origins` non-wildcard.
    cors: {
      origins: ["https://trusted.example"],
    },
    // P6 J5 — en-têtes de sécurité APPLICATIFS : avancés opt-in activés pour le
    // banc `http/security-headers.test.ts` (COOP/CORP/Permissions — PAS COEP
    // `require-corp` qui casserait les assets tiers du front en dev).
    headers: {
      coop: "same-origin",
      corp: "same-origin",
      permissionsPolicy: "camera=(), microphone=(), geolocation=()",
    },
    // P6 J9 — passkeys WebAuthn : store `auto` → suit l'infra ; sans infra déclarée
    // mais @nodefony/drizzle chargé → sqlite local (les credentials persistent au
    // redémarrage). Multi-nœud → déclarer NF_DATABASE_URL. Le store fichier JSON a
    // été retiré (sqlite couvre la persistance mono-nœud).
    passkeys: {
      store: "auto",
    },
    // P6 J9 — banc social login OAuth2 : un provider de TEST déterministe (zéro
    // réseau, enregistré dans secure/oauthTestProvider.ts) prouve le flux complet
    // authorize→callback→session BFF + provisioning Shadow User. DEV uniquement.
    oauth2: {
      successRedirect: "/oauth-success",
      failureRedirect: "/oauth-failure",
      providers: {
        "test-oidc": {
          clientId: "test-client",
          clientSecret: "test-secret",
          redirectUri:
            "https://127.0.0.1:5152/nodefony/security/api/oauth2/test-oidc/callback",
        },
      },
    },
  },
};
