export default {
  watch: true,

  "module-http": {
    statics: {
      test: {
        path: "src/modules/test/public",
        options: {
          maxAge: 30 * 24 * 60 * 60 * 1000,
        },
      },
    },
    // Fixture de test : seuils d'upload BAS pour exercer les 413 (maxFileSize /
    // maxTotalFileSize) sans envoyer 500 MB. Les uploads réels des tests
    // (config.ts ~quelques Ko) restent largement sous ces limites.
    upload: {
      maxFileSize: 1048576, // 1 MB par fichier
      maxTotalFileSize: 1572864, // 1,5 MB cumulé / requête
    },
  },
};
