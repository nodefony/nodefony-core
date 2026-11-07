# La gravité d'un défaut — une norme, jamais une impression

> Référence du skill `nodefony-ticket`, chargée **avant d'ouvrir ou de trier un défaut** (type
> `Bug`). Déclencheurs : « quelle gravité ? », « c'est grave ? », « CVSS », « faille ou bug ? ».
>
> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.

## Gravité ≠ priorité

|                     | Ce qu'elle dit                        | Où elle vit                         |
| ------------------- | ------------------------------------- | ----------------------------------- |
| **Gravité**         | ce que le défaut CASSE — l'impact     | ligne `**Gravité** : …` du corps    |
| **Priorité** (P0-3) | QUAND on le traite — l'ordonnancement | champ `Priorité` du tableau de bord |

La gravité fixe un **plancher** de priorité : on peut monter au-dessus (un S3 qui bloque une
publication passe P0), jamais descendre. `ticket:lint` signale l'inverse (`PRIORITE-SOUS-GRAVITE`).

## Choisir l'échelle — une seule question

**Un tiers peut-il, par ce défaut, atteindre la confidentialité, l'intégrité ou la disponibilité
de l'application ?** Oui → c'est une **faille** : CVSS 3.1. Non → l'échelle **S1 à S4**.

Un arrêt du processus à la portée d'une requête est une faille (disponibilité), même sans fuite de
donnée — c'est le cas qui a fondé la règle (#739).

### Une faille — CVSS 3.1 (FIRST)

On écrit le **vecteur**, jamais le score : `severity.mjs` le CALCULE (formule de la
spécification, arrondi de l'annexe A). Un score recopié est l'erreur la plus facile à faire, et
la plus crue. La version 3.1 et non 4.0 : c'est celle que lisent les avis de sécurité GitHub et
la plupart des outils, et sa formule se calcule sans tables.

| Métrique    | Question                                    | Valeurs                                                                |
| ----------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| `AV`        | d'où l'attaque part-elle ?                  | `N` réseau · `A` adjacent · `L` local · `P` physique                   |
| `AC`        | l'attaquant contrôle-t-il le déclencheur ?  | `L` oui, à volonté · `H` il dépend de conditions qu'il ne maîtrise pas |
| `PR`        | quels droits faut-il avant ?                | `N` aucun · `L` un compte · `H` administrateur                         |
| `UI`        | faut-il qu'une victime agisse ?             | `N` non · `R` oui (cliquer un lien)                                    |
| `S`         | l'impact sort-il du composant ?             | `U` non · `C` oui (le navigateur, un autre service)                    |
| `C`/`I`/`A` | confidentialité / intégrité / disponibilité | `H` totale · `L` partielle · `N` aucune                                |

**`AC` décide presque toujours du verdict, et c'est là qu'on triche sans le vouloir.** Quand le
déclencheur dépend de ce que l'APPLICATION expose (une route qui sert un fichier illisible), c'est
`H` ; le dire, et donner l'autre lecture dans le corps (« 7,5 si une application laisse
l'utilisateur désigner le fichier »). Vécu #739 : `AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H` = 5,9.

Libellés (§5 de la spécification) : 0 None · 0,1-3,9 Low · 4-6,9 Medium · 7-8,9 High · 9-10 Critical.

### Tout autre défaut — S1 à S4 (classes de l'IEEE 1044)

| Classe | Ce qu'elle recouvre                                                              | Plancher |
| ------ | -------------------------------------------------------------------------------- | -------- |
| **S1** | bloquant — processus arrêté, données perdues ou corrompues, démarrage impossible | P0       |
| **S2** | majeur — une fonction cassée, sans contournement                                 | P1       |
| **S3** | mineur — une fonction dégradée, avec un contournement                            | P2       |
| **S4** | cosmétique — texte, message, documentation                                       | P3       |

La classe ne va **jamais seule** : `S2 — l'export CSV échoue au-delà de 1 000 lignes`. Une classe
sans motif ne s'instruit pas — `ticket:open` la refuse.

Plancher CVSS : ≥ 7 → P0 · 4 à 6,9 → P1 · < 4 → P2.

## Le geste

```bash
npm run ticket:open -- --title "fix(http): …" --body-file corps.md --gravite "S2 — motif" …
npm run ticket:open -- --title "fix(http): …" --body-file corps.md \
  --gravite "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H" …
```

`ticket:open` **refuse** un défaut sans gravité lisible, AVANT de rien créer ; il écrit la ligne
au corps, juste avant l'estimation, avec le score calculé :

```markdown
**Gravité** : CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H — 5,9 (Medium)
**Estimation : 0,25 j**
```

Un défaut ouvert depuis l'interface GitHub, ou avant la règle, est rattrapé par `ticket:lint`
(`BUG-SANS-GRAVITE`, un seul constat agrégé). Pour le corriger : éditer le corps, ajouter la ligne.

## Une faille dans une version PUBLIÉE

- **Le changelog** ne porte ni section `Unreleased` ni catégorie `Security` (Common Changelog,
  rédigé à la publication) : l'entrée part sous `Fixed`, et elle **dit** que c'est une faille,
  avec son vecteur et la version touchée.
- **Un avis de sécurité GitHub** ne se publie que pour une version que la politique de support
  couvre (`docs/guides/compatibilite.md` : la dernière majeure stable). Une bêta n'en reçoit pas :
  le ticket et l'entrée du changelog suffisent.
