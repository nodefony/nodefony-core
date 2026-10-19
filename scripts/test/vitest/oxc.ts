/**
 * Options oxc partagées par les `vitest.config.ts` des workspaces.
 *
 * Vite transforme les tests via oxc/rolldown, et son type `OxcOptions` omet
 * `tsconfig` : le `experimentalDecorators` de nos `tsconfig.json` n'est donc PAS
 * lu. Sans ce bloc, `decorator.legacy` retombe sur
 * son défaut `false`, les décorateurs sont émis tels quels dans la sortie, et Node
 * lève `SyntaxError: Invalid or unexpected token` au chargement du module de test.
 *
 * `emitDecoratorMetadata` reste à `false`, comme dans les `tsconfig.json` : le DI ne
 * lit aucun type émis, une dépendance se nomme par `@Inject("nom")` (ADR-0018).
 *
 * À importer dans tout `vitest.config.ts` dont les tests transforment une source
 * portant des décorateurs (core, framework, orm-core, realtime, drizzle, …).
 *
 *  oxc: oxcDecorators,              // à côté de test: { … } dans une config vitest
 *
 * @usage oxc: oxcDecorators,              // à côté de test: { … } dans une config vitest
 */
export const oxcDecorators = {
  decorator: { legacy: true, emitDecoratorMetadata: false },
} as const;
