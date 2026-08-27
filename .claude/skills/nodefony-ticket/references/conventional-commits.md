# Conventional Commits 1.0.0 — la spec, hors ligne

> Source : <https://www.conventionalcommits.org/en/v1.0.0/> · licence CC BY 3.0.
> Bundlée ici pour que le skill soit **autosuffisant** : un agent qui n'a pas d'accès réseau doit
> pouvoir appliquer la norme. Le dépôt l'impose déjà à ses commits (`commitlint` en pre-commit) —
> les tickets suivent la même grammaire, ce qui fait **une seule convention** à connaître.

## Structure normative

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

## Types

| Type       | Sens                                | Effet SemVer |
| ---------- | ----------------------------------- | ------------ |
| `feat`     | une nouvelle fonctionnalité         | MINOR        |
| `fix`      | une correction de défaut            | PATCH        |
| `docs`     | documentation seule                 | —            |
| `refactor` | ni correction ni fonctionnalité     | —            |
| `perf`     | amélioration de performance         | —            |
| `test`     | ajout ou correction de tests        | —            |
| `build`    | chaîne de build ou dépendances      | —            |
| `ci`       | intégration continue                | —            |
| `chore`    | tâche d'entretien                   | —            |
| `style`    | mise en forme sans effet sémantique | —            |

## Règles

1. Le message **DOIT** commencer par un type, suivi d'un scope optionnel entre parenthèses, puis
   `: ` (deux-points + espace).
2. Le **scope** décrit une section du code : `feat(parser):`.
3. La **description** suit immédiatement le `: `. C'est un résumé court des modifications.
4. Les éléments **NE DOIVENT PAS être sensibles à la casse**, à une exception près :
   `BREAKING CHANGE`, qui **DOIT** être en majuscules.
5. Une **rupture d'API** se signale de deux façons, au choix :
   - un `!` avant le deux-points — `feat(api)!: retirer l'ancien point d'entrée` ;
   - un footer `BREAKING CHANGE: <description>`.
     Le `!` peut accompagner le footer ; il correspond à MAJOR en SemVer.
6. Les **footers** suivent la convention git-trailer : `Jeton: valeur` ou `Jeton #valeur`.

## Ce que Nodefony ajoute par-dessus

- **Description à l'infinitif**, en minuscules, **≤ 60 caractères**, sans point final. Un titre
  annonce un **geste** ; le problème vit dans le corps du ticket.
- **Les messages de commit du dépôt sont en français**, titre compris — la description est donc
  française, seuls le type et le scope restent anglais.
