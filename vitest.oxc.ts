/**
 * Options oxc partagées par les `vitest.config.ts` des workspaces.
 *
 * Vite transforme les tests via oxc/rolldown, et son type `OxcOptions` omet
 * `tsconfig` : le `experimentalDecorators` / `emitDecoratorMetadata` de nos
 * `tsconfig.json` n'est donc PAS lu. Sans ce bloc, `decorator.legacy` retombe sur
 * son défaut `false`, les décorateurs sont émis tels quels dans la sortie, et Node
 * lève `SyntaxError: Invalid or unexpected token` au chargement du module de test.
 *
 * `emitDecoratorMetadata` est requis par le DI : l'injector résout les dépendances
 * via `design:paramtypes` quand aucun token explicite n'est passé à `@inject`.
 *
 * À importer dans tout `vitest.config.ts` dont les tests transforment une source
 * portant des décorateurs (core, framework, orm-core, realtime, drizzle, …).
 */
export const oxcDecorators = {
  decorator: { legacy: true, emitDecoratorMetadata: true },
} as const;
