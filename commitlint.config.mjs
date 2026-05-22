// Conventional Commits — base de règles standard.
// ESM (package.json "type": "module").
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Désactivé : les messages du projet ont des corps FR détaillés multi-lignes
    // (mesures perf, justifications) qui dépassent volontairement 100 colonnes.
    "body-max-line-length": [0, "always"],
    "footer-max-line-length": [0, "always"],
  },
};
