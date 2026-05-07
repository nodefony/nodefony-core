# /review [chemin]
Lis .claude/conventions.md.
Fais une review complète du fichier ou dossier indiqué.

Checklist obligatoire :
□ Zéro `any` dans tout le fichier
□ Zéro `@ts-ignore` ou `@ts-expect-error`
□ Tous les imports Node.js ont le préfixe node:
□ Tous les imports internes ont l'extension .js
□ Les interfaces sont exportées séparément (fichiers types/)
□ Les types de retour sont explicites sur les méthodes publiques
□ Les decorators Nodefony sont correctement appliqués
□ Pas de Bun.serve() ni d'APIs Bun dans le code serveur
□ Chaque méthode publique a un test dans .test.ts
□ bunx tsc --noEmit → zéro erreur
□ bun test → tous passent

Corriger les problèmes trouvés directement.
Donner un score /10 et lister les 3 corrections principales.
