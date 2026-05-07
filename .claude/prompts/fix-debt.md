# /fix-debt [numéro]
Lis MIGRATION_STATUS.md section "Dettes techniques".
Corrige la dette technique demandée.

## Dette #1 — moduleResolution
Changer tsconfig.json :
"moduleResolution": "Node" → "moduleResolution": "Bundler"
Vérifier que rollup.config.ts compile encore après.
Vérifier bunx tsc --noEmit.

## Dette #2 — Double lockfile
Supprimer package-lock.json à la racine.
Garder uniquement bun.lock.
Ajouter package-lock.json dans .gitignore si absent.

## Dette #3 — @ts-ignore rollup
Créer rollup-sourcemap-path-transform.d.ts :
declare module "rollup-sourcemap-path-transform" {
  export function createPathTransform(options: Record<string, string>): unknown;
}
Supprimer le @ts-ignore dans rollup.config.ts.

## Dette #4 — nodefony.d.ts / global.d.ts
Analyser le contenu des fichiers .d.ts existants.
Identifier quels types appartiennent à quel module.
Créer les fichiers src/types/[nom].ts correspondants.
Supprimer les .d.ts monolithiques.

Marquer la dette comme résolue dans MIGRATION_STATUS.md.
