export default {
  watch: true,

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
      // P6 J4 — zone API M2M : JWT Bearer (RFC 6750) UNIQUEMENT, pas de session.
      // Un access token s'obtient via POST /nodefony/security/api/token (grant
      // credential), puis `Authorization: Bearer <token>` sur /nodefony/test/m2m/*.
      "test-api": {
        pattern: "^/nodefony/test/m2m",
        authenticators: ["jwt"],
        stateless: true, // stateless : pas de session, identité 100 % portée par le JWT.
      },
    },
  },
};
