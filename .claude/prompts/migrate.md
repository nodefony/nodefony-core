# /migrate [nom-du-module]
Lis CLAUDE.md, .claude/conventions.md et MIGRATION_STATUS.md.
Identifie le module demandé ou le prochain module ⬜ sans dépendance bloquante.

Étapes :
1. Lire le fichier JS source dans ../nodefony/
2. Migrer vers TypeScript strict selon .claude/conventions.md
3. Appliquer les decorators Nodefony (@Module, @Service, @Controller...)
4. Utiliser Node.js natif pour les serveurs (jamais Bun.serve)
5. Extensions .js sur tous les imports ESM
6. Écrire les tests bun test dans [fichier].test.ts
7. Vérifier : bunx tsc --noEmit (zéro erreur)
8. Vérifier : bun test (tous passent)
9. Mettre à jour MIGRATION_STATUS.md (statut + journal)
10. Préparer le commit message

Ne jamais migrer plus d'un module par session.
