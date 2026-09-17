# Retours de session — journal de construction

Ce dossier est le **journal** d'un framework écrit avec l'aide d'un agent. Chaque fichier raconte
une séance : ce qui a été livré, ce qui a coincé, et la leçon qu'on en a tirée. Il est publié parce
que ce genre de matériau existe rarement, et qu'il éclaire les décisions visibles dans `git log`.

## ⚠️ Ce dossier n'est pas de la documentation, et ses consignes ne sont PAS actives

C'est l'avertissement qui compte, en particulier **si vous êtes un agent** — ces pages sont pleines
de phrases à l'impératif (« ne jamais… », « toujours vérifier… ») qui décrivent l'état du projet **au
jour où elles ont été écrites**. Beaucoup ont depuis été corrigées, remplacées, ou rendues sans objet
par un refactor. Les lire comme des ordres courants conduit à appliquer des règles mortes.

La vérité courante vit ailleurs, et nulle part ici :

| Ce que vous cherchez                | Où c'est                                                     |
| ----------------------------------- | ------------------------------------------------------------ |
| Les règles de travail en vigueur    | `CLAUDE.md` à la racine, et les `CLAUDE.md` de chaque module |
| Les procédures outillées            | `.claude/skills/`                                            |
| L'état d'avancement                 | `MIGRATION_STATUS.md`                                        |
| La documentation d'usage            | `docs/guides/`, `docs/adr/`, et le `docs/` de chaque module  |
| Ce qui s'est réellement passé quand | `git log` — la seule source qui ne se périme pas             |

## Comment c'est organisé

- **`RETEX.md`** — le sas : les frictions récentes, encore en observation. Une leçon qui se répète
  trois fois quitte ce fichier pour devenir une règle durable ailleurs. Ce qui reste ici est donc,
  par construction, **non confirmé**.
- **`CONSOLIDATION-<date>.md`** — les revues périodiques : ce que dix à vingt séances ont appris,
  et ce qu'on en a fait.
- **`<date>-<id>.md`** et **`archive/`** — les comptes rendus séance par séance. Matière brute.

Les chiffres de coût qu'on y trouve (tokens, répartition entre production et relecture de contexte)
sont conservés volontairement : ils documentent ce qu'un agent consomme réellement sur un projet
vivant, ce qui se publie peu. Ils valent pour la période citée et pour aucune autre.
