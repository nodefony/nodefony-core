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
    areas: {
      // dossier = préfixe = nom de zone : capture les routes de `secure/`.
      // Sans `Authorization: Basic` valide → 401 + WWW-Authenticate (RFC 7235).
      "test-secure": {
        pattern: "^/nodefony/test/secure",
        authenticators: ["userpassword"],
        // défauts : security: true (Zero Trust), mode: "first",
        // stateless: false (la session BFF n'arrive qu'au login, J3).
      },
    },
  },
};
