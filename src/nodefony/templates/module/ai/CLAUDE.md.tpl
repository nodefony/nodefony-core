# CLAUDE.md — <%= it.pkgName %>

> Instructions destinées à un agent IA travaillant sur CE module. Lecture obligatoire avant
> d'éditer quoi que ce soit ici. Complète `MEMORY.md` (internals) et `README.md` (humains).
>
> **Vérité COURANTE, jamais un journal** : pas de dates, pas de section « TODO / historique ».
> L'avancement se lit dans le suivi du projet, l'histoire dans `git log`. Une leçon durable se
> fond en RÈGLE ci-dessous ; un fait périmé se CORRIGE (il ne s'annote pas).

## Rôle du module

<%= it.description %>

## Décisions figées

- **Config** : le schéma Zod de `nodefony/config/config.ts` est la **source unique** des défauts.
  `defineModuleConfig.ts` ne fait que valider et geler — il ne retape jamais une valeur.
- **La logique vit dans le service**, pas dans les controllers : un controller traduit du HTTP/WS,
  un service est réutilisable (CLI, job, autre module).
- **Jamais de déréférencement du kernel au chargement du fichier** (`Nodefony.getKernel()` au
  top-level) : le module deviendrait impossible à importer — donc à tester — sans serveur.

## Ce qu'il ne faut pas faire sans accord

- Modifier `rolldown.config.ts` / `tsconfig.json`.
- Ajouter une dépendance npm runtime sans en peser le coût.
- Allouer par requête ce qui n'est utilisé que dans une minorité de requêtes (préférer `null` +
  initialisation au premier usage), ou attacher un listener sans prévoir son retrait.

## Gates avant commit

```bash
npm run typecheck && npm test && npm run build
```
