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
};
