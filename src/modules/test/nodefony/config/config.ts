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
    },
    // P6.9 — l'émetteur du banc n'existe pas et ne peut pas exister : `.invalid`
    // est réservé par la RFC 2606 et ne se résout nulle part. Le jeu de clés est
    // déclaré pour supprimer la découverte (deux requêtes de moins pour le même
    // verdict), et le délai est court pour que l'échec soit franc.
    resourceServer: {
      issuers: [
        {
          issuer: "https://auth.test.invalid/realms/nodefony",
          jwksUri: "https://auth.test.invalid/keys",
          algorithms: ["ES256"],
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
