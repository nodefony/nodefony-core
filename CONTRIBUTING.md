# Contribuer à Nodefony

Merci de regarder ce projet.

Nodefony est un logiciel libre développé bénévolement par une seule personne, sous licence
[CeCILL-B](LICENSE.txt). Il n'y a ni entreprise derrière, ni obligation de réponse sous 24 h — mais
toute contribution est lue, et les règles ci-dessous existent pour qu'elle puisse être intégrée sans
que j'aie à la réécrire.

## Ce qui aide le plus

Par ordre d'utilité réelle, aujourd'hui :

1. **Un rapport de bug avec une reproduction.** Une application minimale (`npm create nodefony`) qui
   montre le défaut vaut plus qu'une description, même précise.
2. **Un retour de portabilité.** Le framework vise linux, macOS **et Windows** à parité. Windows est
   l'angle mort structurel d'un projet développé sur macOS : un « ça ne démarre pas chez moi sous
   Windows » est une contribution de premier ordre.
3. **Une correction de documentation.** Si une page vous a fait perdre du temps, la corriger aide le
   suivant — et les écarts entre la doc et le code sont le défaut le plus fréquent de ce dépôt.

Les grosses fonctionnalités non discutées à l'avance ont peu de chances d'être fusionnées telles
quelles : ouvrez d'abord une issue pour en parler.

## Prérequis

- **Node.js ≥ 24** (`engines` du dépôt — aucune rétrocompatibilité n'est prévue)
- **npm** (le dépôt est un monorepo de workspaces npm + turbo)
- **Docker**, uniquement pour les suites qui touchent une base réelle (PostgreSQL, MySQL, MongoDB,
  Redis) — le reste tourne sans

## Démarrer

```bash
git clone https://github.com/nodefony/nodefony-core.git
cd nodefony-core
npm install          # installe et pose les hooks git (core.hooksPath = .githooks)
npm run build        # turbo + rolldown + génération des .d.ts
npm run test:all     # démarre l'infra manquante, enchaîne les phases, ET dit ce qu'elle n'a PAS testé
```

`npm run test:all -- --infra` affiche l'état de l'infrastructure sans rien lancer.

Pour une boucle courte sur un seul paquet :

```bash
cd src/packages/@nodefony/<module> && npx vitest run
```

## Comment est fait le dépôt

Le dépôt est **à la fois** le framework et une application qui s'en sert :

| Chemin                    | Rôle                                                      |
| ------------------------- | --------------------------------------------------------- |
| `src/nodefony/`           | le cœur — paquet `nodefony` (Kernel, DI, CLI, services)   |
| `src/packages/@nodefony/` | les modules publiés (`http`, `framework`, `security`, …)  |
| `src/modules/`            | des modules locaux, dont `test` — le banc d'intégration   |
| `./` (racine)             | une application Nodefony réelle, qui éprouve le framework |

Autrement dit : le framework est utilisé par son propre dépôt. Une régression se voit en démarrant
le serveur, pas seulement dans les tests.

## Avant d'ouvrir une pull request

Une seule commande fait autorité :

```bash
npm run verify   # typecheck + lint + format + tests + `nodefony doctor`
```

C'est ce que la forge exécutera. Si elle passe chez vous, votre PR part sur de bonnes bases.

Les hooks git posés par `npm install` refusent déjà un commit mal formé, un nom de fichier illégal
sous Windows et un message de commit hors convention — ne les contournez pas avec `--no-verify`.

## Les règles qui ne se négocient pas

Elles ne sont pas des goûts : chacune a été payée par un défaut réel.

| Règle                                                                                          | Pourquoi                                                                                                 |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **ESM uniquement**, jamais `require()`                                                         | la double résolution CommonJS/ESM et ses pièges de chargement                                            |
| Préfixe `node:` sur les imports du runtime                                                     | lève l'ambiguïté avec un paquet npm homonyme                                                             |
| **TypeScript strict**, zéro `@ts-ignore`                                                       | un contrat qui se dégrade en silence entre deux modules ne se voit qu'en production                      |
| Un chemin qui **voyage** s'écrit en `/`, un chemin qu'on **ouvre** se compose avec `path.join` | un filtre écrit en `/` ne mord pas sur `a\tests\b` — vécu : des tests entrés dans un paquet publié       |
| Une **capacité se constate**, jamais ne se déduit de `process.platform`                        | `ps` manque aussi sur les images `node:*-slim`                                                           |
| Toute variable d'environnement lue par Nodefony se préfixe **`NF_`**                           | `REDIS_HOST` ou `COOKIE_SECRET` appartiennent à d'autres outils ; une collision ne produit aucune erreur |
| Pas d'allocation « au cas où » dans le chemin d'une requête                                    | 100 octets par requête × 10 000 req/s = 1 Mo/s alloué pour rien                                          |
| Tout `listener` attaché est explicitement détaché                                              | `.once()` ne détache pas son jumeau (`finish` vs `close`)                                                |

## Les tests

- Le lanceur est **vitest**, partout.
- Un test neuf doit avoir été **vu rouge une fois**. Un test écrit face au code déjà corrigé est
  complaisant par défaut : débranchez le correctif, vérifiez que quelque chose tombe, rebranchez.
- **Un `npm test` vert ne prouve pas tout** : les suites qui exigent une infrastructure se
  _skippent_ sans leurs variables, et un skip compte comme vert. La source unique des variables et
  des commandes docker est [`vitest.gates.ts`](vitest.gates.ts) ; les suites concernées affichent en
  fin de passe ce qu'elles n'ont pas exercé. Lisez ce bloc avant de conclure « vert ».

## Commits et pull requests

- Messages au format [Conventional Commits](https://www.conventionalcommits.org/) :
  `type(scope): sujet` — par exemple `fix(http): le drain ne coupait pas les WebSocket`.
  Le français est accepté dans le sujet.
- Une PR = **un sujet**. Une PR qui corrige un bug _et_ reformate 40 fichiers ne peut pas être relue.
- Partez de `main`, gardez la branche à jour, et laissez la forge tourner : les matrices
  ubuntu / macOS / Windows sont là pour trouver ce que votre poste ne peut pas voir.
- Décrivez **comment vous avez prouvé** que ça marche. « Les tests passent » n'est pas une preuve
  si aucun test ne couvrait le cas.

## Signaler une faille de sécurité

**N'ouvrez pas d'issue publique.** La procédure est décrite dans [SECURITY.md](SECURITY.md).

## Licence

En contribuant, vous acceptez que votre contribution soit distribuée sous la licence
[CeCILL-B](LICENSE.txt), compatible avec les licences libres permissives de type BSD.
