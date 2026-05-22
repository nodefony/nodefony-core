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
  },
};
