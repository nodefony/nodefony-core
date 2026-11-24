// Préprocesseur témoin (#909) : remplace un jeton que lui seul connaît. Si le
// jeton survit dans le code servi, la configuration du module a été ignorée.
export default {
  preprocess: {
    markup: ({ content }) => ({
      code: content.replaceAll(
        "__NF_PREPROCESSOR_MISSING__",
        "nf-preprocessed",
      ),
    }),
  },
};
