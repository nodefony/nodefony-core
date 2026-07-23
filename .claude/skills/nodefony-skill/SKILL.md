---
name: nodefony-skill
metadata:
  version: 1.1.0
description: >
  Créer, éditer, **fusionner, retirer** ou auditer un skill du dépôt Nodefony. Dérive de
  `skill-creator` (qui porte la mécanique générique) et ajoute ce que Nodefony exige en propre :
  nommage `nodefony-*`, description calibrée pour se DÉCLENCHER (formulations de besoin, pas de noms
  d'outils), `metadata.version`, ressources en `references/`, note de maintenance intemporelle, table
  « quand passer la main », et la barrière `skills-doc` qui contrôle la conformité au standard Agent
  Skills et régénère la fiche publique. Porte les pièges vécus : une règle recopiée dans le CLAUDE.md
  rend le skill inatteignable, un renvoi survit au refactor qui a supprimé sa cible, une capacité
  absorbée sans ses déclencheurs devient introuvable.
  Déclencheurs : "créer un skill", "nouveau skill", "éditer un skill", "fusionner deux skills",
  "retirer un skill", "mon skill ne se déclenche jamais", "skill non conforme", "skills-ref
  validate", "conformité Agent Skills", "fiche de skill", "à quoi sert ce skill".
---

# nodefony-skill — écrire un skill qui se déclenche et qui reste vrai

> **Ce skill dérive de `skill-creator`** (bundlé) : la mécanique générique — structure d'un dossier,
> divulgation progressive, rédaction d'une description — y vit et n'est **pas recopiée ici**. Ce
> fichier porte ce que Nodefony ajoute, et rien d'autre.
>
> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`. Une leçon durable devient une règle d'une section, pas une entrée datée.

## 1. Quand m'utiliser

- Créer un skill du dépôt (`.claude/skills/nodefony-<nom>/`).
- Réparer un skill **qui ne se déclenche jamais** (le cas le plus fréquent — voir §5).
- Auditer la conformité avant une publication npm (chantier `devkit`).
- Décider **s'il faut un skill** plutôt qu'une règle de `CLAUDE.md` ou une commande (§2).

**Passer la main** : mécanique générique d'un skill → `skill-creator`. Écrire une page de
documentation → `nodefony-documentation`. Scaffolder un module → `nodefony-create-module`.

## 2. La question préalable : skill, commande, ou règle ?

| Le besoin                                                           | La bonne forme                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------- |
| Une **procédure** que l'agent doit suivre (décor, gates, pièges)    | **Skill** — c'est ce que l'invocation apporte                 |
| Une **frappe courte** pour l'humain sur une procédure existante     | **Commande** `.claude/commands/<nom>.md` qui délègue au skill |
| Une **règle permanente** qui doit s'appliquer sans qu'on la demande | `CLAUDE.md` — pas un skill (il ne se chargerait jamais)       |
| Un **outil** qu'on lance                                            | Un script ; le skill est ce qui l'entoure (protocole)         |

> ⚠️ **Ne jamais écrire la même règle aux deux endroits.** Un skill dont le `CLAUDE.md` redonne la
> commande n'est jamais invoqué : l'agent lit la règle au démarrage, exécute, et n'ouvre pas le
> skill — qui portait pourtant le diagnostic. Mesuré sur ce dépôt : c'est la cause n°1 des skills à
> zéro invocation. Le `CLAUDE.md` **pointe**, le skill **détaille**.

## 3. Conventions Nodefony (en plus du standard)

- **Nom** : `nodefony-<sujet>` en minuscules, identique au dossier. Les **commandes** restent
  courtes et non préfixées (`/start-server`).
- **`metadata.version`** — jamais `version:` à la racine : le standard n'autorise que `name`,
  `description`, `license`, `metadata`, `allowed-tools`.
- **Ressources** : `references/` (au pluriel) pour le détail chargé à la demande, `scripts/` pour
  l'exécutable, `assets/` pour les gabarits. Le corps reste sous 500 lignes et sert d'**index**.
- **Note de maintenance en tête** : édition en place, pas de changelog, pas de date. L'avancement
  vit dans `MIGRATION_STATUS.md`, l'historique dans `git log`.
- **Table « quand passer la main »** : un skill dit toujours ce qu'il ne fait PAS, avec le nom du
  skill qui le fait.
- **Exemples vérifiés au source** — jamais de signature recopiée de mémoire.

## 4. Écrire la description (c'est elle qui décide de tout)

La description est le **seul** texte lu à chaque session : elle décide si le skill s'active. Deux
règles issues de la mesure d'usage :

1. **Nommer le MOMENT, pas l'outil.** « RPS », « stress » ne se déclenchent pas — la demande réelle
   arrive en besoin : « est-ce que ça tient la charge ? », « c'est plus rapide ? », « je vais
   commiter une modif du pipeline ». Écrire les deux, en commençant par le besoin.
2. **Dire quand charger le skill par rapport à l'action.** Pour un skill à scripts :
   « à charger AVANT de lancer un de ces scripts » — sinon on lance le script sans le protocole,
   et le chiffre obtenu ne vaut rien.

Forme : troisième personne, capacité **et** moment, ≤ 1024 caractères, aucune roadmap.

## 5. Réparer un skill qui ne se déclenche jamais

Dans l'ordre, parce que les causes n'ont pas la même fréquence :

1. **Sa règle est-elle recopiée dans `CLAUDE.md` ?** → retirer la copie, y mettre un pointeur.
2. **Ses déclencheurs nomment-ils l'outil au lieu du moment ?** → §4.
3. **Ses renvois pointent-ils encore quelque part ?** → `node .claude/skills/nodefony-skill/scripts/skills-doc.mjs` puis vérifier
   les cibles. Un refactor supprime un fichier ; le renvoi, lui, survit et envoie dans le vide.
4. **Est-il seulement lu, jamais invoqué ?** C'est un signal de description, pas de contenu : ses
   `references/` servent, sa porte d'entrée ne s'ouvre pas.
5. **Le besoin existe-t-il encore ?** Si non, le retirer franchement (règle projet : pas de legacy).

## 6. Fusionner, absorber ou retirer un skill

Trois gestes distincts, une même exigence : **aucune capacité ne doit disparaître en silence**. Un
skill qu'on retire emporte avec lui ses déclencheurs — c'est-à-dire la seule chose qui permettait de
l'atteindre.

| Geste          | Quand                                                                   | Ce qu'il faut préserver                           |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| **Fusion**     | plusieurs skills répondent à la même intention sous des noms différents | le contenu **et** les déclencheurs des deux       |
| **Absorption** | un skill est un chapitre d'un kit plus large                            | le détail part en `references/`, pas au panier    |
| **Retrait**    | le besoin lui-même a disparu (prouvé, pas supposé)                      | la décision, si elle vaut, va dans le `CLAUDE.md` |

Dans l'ordre :

1. **Inventorier les renvois — avec les dossiers cachés.** `rg` **ignore** `.claude/` sans
   `--hidden` : une recherche qui l'oublie conclut « aucun consommateur » sur un skill cité partout.

   ```bash
   rg -n --hidden 'nodefony-<skill-retiré>' -g '!**/node_modules/**' -g '!.git/**'
   ```

   Les retex archivés (`docs/session-retros/archive/`) sont de l'**histoire** : ne pas les réécrire.

2. **Écrire la destination avant de supprimer la source** — sinon le contenu est perdu entre les deux.
3. **Déplacer les déclencheurs**, pas seulement le contenu. Une capacité absorbée dont les
   formulations ne rejoignent pas la description du skill d'accueil devient inatteignable : le corps
   existe, la porte n'existe plus.
4. **Supprimer avec `git rm`** (l'historique reste), puis réparer chaque renvoi trouvé en 1.
5. **Mettre à jour l'outillage** : cas du banc de déclenchement, table d'icônes/familles de
   `skills-doc`, et toute table « passer la main » qui nommait le disparu.
6. **Passer le gate** (§7). Le contrôle « aucun renvoi vers un skill inexistant » est là pour ça.

> **Une table « passer la main » se périme sans bruit.** Vérifier que ce qu'elle promet existe :
> une table citant `bash <skill>/<script>` pour quatre skills dont **aucun** n'avait de script a
> survécu des mois — chaque ligne était fausse. Nommer le skill, pas un chemin supposé.

## 7. Gate — obligatoire avant de dire « fait »

```bash
node .claude/skills/nodefony-skill/scripts/skills-doc.mjs        # conformité des 26+ skills + régénère docs/skills/
node .claude/skills/nodefony-skill/scripts/skills-doc.mjs --check   # contrôle seul (CI)
```

Il vérifie : `name` conforme et égal au dossier · `description` de 1 à 1024 caractères · aucun champ
hors standard · ressources en `references/` · **aucun renvoi vers un skill inexistant** · corps
< 500 lignes (avertissement). Sur un manquement dur il **sort en échec**, et il régénère la **fiche
publique** du skill dans `docs/skills/<nom>.md` — version, contenu, déclencheurs, ressources,
scripts avec leurs options et variables d'environnement.

> Le contrôle des renvois ne lit que les noms **entre accents graves**, dans le `SKILL.md` et les
> `references/` — les scripts citent des conteneurs et des titres de processus qui portent le même
> préfixe. Les quelques `nodefony-…` qui ne désignent pas un skill (le dépôt lui-même, un service,
> un composant) sont déclarés dans `NON_SKILL_TERMS`, en tête de `skills-doc.mjs` : y ajouter un
> terme demande de justifier pourquoi ce n'en est pas un.

**Validateur officiel du standard** — il attrape ce qu'un contrôle maison rate, à commencer par un
**frontmatter YAML invalide** (une description en ligne contenant un `:` casse le mapping sans que
rien d'autre ne s'en aperçoive) :

```bash
npm pack skills-ref && tar xzf skills-ref-*.tgz     # dans un dossier jetable
node package/dist/cli.js validate ./<skill>          # après y avoir installé commander + js-yaml
```

> ⚠️ **Auditer avant d'exécuter.** Le paquet `skills-ref` n'a ni `repository` ni `homepage` sur npm
> et n'est pas attribuable à l'AAIF : il lit tous les skills du dépôt. Audité une fois (20 Ko,
> `node:fs`/`node:path` seulement, aucun accès réseau, MIT) — refaire cette lecture à chaque montée
> de version plutôt que de lui faire confiance sur son nom. C'est pour ça que la commande ci-dessus
> dépaquette au lieu d'un `npx` qui exécuterait sans regarder.

**Banc de déclenchement** — la garde anti-régression des descriptions :

```bash
node .claude/skills/nodefony-skill/scripts/trigger-bench.mjs            # phrases réelles → skill élu
node .claude/skills/nodefony-skill/scripts/trigger-bench.mjs --verbose  # + le détail des scores
```

Il rejoue des phrases réellement formulées en session (issues des retex et des mémoires) et vérifie
que **le bon skill sort en tête**, puis que chaque déclencheur déclaré élit bien son propre skill.
Après toute retouche de description, le relancer : c'est là qu'on voit qu'un resserrement a rendu un
skill inatteignable. Il signale aussi les **recouvrements** — deux skills qui se disputent la même
formulation ; tous ne sont pas des défauts (« fuite mémoire » vaut mieux capté par
`nodefony-check-memory-health` que par `nodefony-debug`), mais chacun mérite un arbitrage conscient.

**Audit de placement** — où vit chaque script, et qui l'appelle :

```bash
node .claude/skills/nodefony-skill/scripts/scripts-audit.mjs           # rapport
node .claude/skills/nodefony-skill/scripts/scripts-audit.mjs --strict  # échoue sur orphelin ou renvoi mort
```

Il classe les 76 scripts du dépôt selon le critère du §2 : **dépend d'un protocole → sa place est
dans un skill** ; déterministe et câblé au `package.json` → il reste à la racine. Il signale aussi
les scripts que **personne ne cite** (morts, ou simplement non documentés) et les renvois vers un
fichier absent. Trois faux positifs ont été corrigés avant de lui faire confiance : `.js` capturé
dans `.json`, renvois croisés entre skills déclarés morts faute d'être cherchés ailleurs, et
« mentionne docker » confondu avec « lance docker ».

> Ce banc mesure la surface **lexicale**, pas le jugement du modèle : un cas vert ne garantit pas
> l'invocation, mais un cas **rouge** est un vrai défaut — aucun mot de la demande ne rejoint la
> description.

## 8. Le hook de doc — un script se décrit lui-même

Un script documenté ailleurs que dans son source diverge le jour où on l'édite. Six tags
facultatifs, lus par `skills-doc`, suffisent à rendre la fiche exacte au lieu de devinée :

| Tag         | Rôle                                                     |
| ----------- | -------------------------------------------------------- |
| `@usage`    | une ligne d'invocation réelle (répétable)                |
| `@option`   | `--drapeau` puis son rôle                                |
| `@env`      | `NOM_VARIABLE` puis son rôle                             |
| `@requires` | ce que le décor doit fournir (`docker`, `serveur UP`, …) |
| `@output`   | ce que le script produit                                 |

Sans eux, le générateur retombe sur l'heuristique : première ligne de commentaire, drapeaux trouvés
dans le source, variables lues hors variables de travail. Avec eux, la fiche gagne un **détail par
script** — invocations, options et variables avec leur explication.

> Piège de l'auto-référence : écrire ces tags en exemple dans un commentaire les fait moissonner par
> leur propre lecteur. Les entourer d'accents graves.

## 9. Ce que consomme un registre de skills

`skills-doc` écrit aussi **`docs/skills/registry.json`** — la même donnée que les fiches, sérialisée
pour une machine : résumé d'une ligne, famille, mots-clés, déclencheurs, **coût d'activation** en
tokens, prérequis, ressources et scripts (options, variables, sortie), **graphe de voisinage** entre
skills, état de conformité contrôle par contrôle, et liens source/fiche. C'est le format qu'un
moteur de recherche de skills ou un registre lit sans ouvrir vingt-sept markdown — et c'est aussi ce
qui rendra une publication npm possible sans réécrire l'inventaire à la main.

## 10. Gabarit

```markdown
---
name: nodefony-<sujet>
metadata:
  version: 1.0.0
description: >
  <Ce qu'il fait, en une phrase à la troisième personne.> <Ce qu'il apporte que l'exécution nue
  n'apporte pas : protocole, décor, pièges.> <Ce qu'il ne couvre pas → skill qui le couvre.>
  Déclencheurs : "<formulation de besoin>", "<moment : avant de …>", "<terme technique>".
---

# nodefony-<sujet> — <promesse en une ligne>

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.

## 1. Quand m'utiliser / quand passer la main

| Besoin | Skill |
| ------ | ----- |

## 2. La procédure

<Les étapes, dans l'ordre, avec les commandes exactes.>

## 3. Pièges

<Ce qui a déjà coûté cher, formulé en règle.>

## 4. Gate

<Comment on prouve que c'est fait.>
```

## 11. Pièges vécus

- **Une fiche écrite à la main diverge du skill dès la première édition** → les fiches
  `docs/skills/` sont générées ; ne jamais les éditer.
- **Un renvoi survit à la disparition de sa cible** : un refactor a supprimé des `references/recipes-*.md`
  en laissant huit renvois morts, plus un renvoi vers une section « §4 » réorganisée entre-temps.
  Vérifier les cibles fait partie du gate — désormais les **renvois vers un skill inexistant** le
  font échouer (§7). Vécu à la fusion des quatre skills d'inspection : `frontend-verify` était cité
  par `debug`, `studio-dev` et leurs `references/`.
- **Mesurer une description avec une regex `$` en mode multiligne ne lit que sa première ligne** —
  le contrôle disait « conforme » sur des descriptions à 1900 caractères. Un gate qu'on n'a jamais
  vu mordre n'est pas un gate.
- **Un déclencheur improbable ne coûte rien mais ne rapporte rien** : « 59 fails framework sans
  serveur » n'a jamais rien déclenché. Préférer trois formulations naturelles à dix exactes.

## 12. Liens

- `docs/outillage-agents.md` — inventaire, usage mesuré, étude des fusions et retraits.
- `docs/skills/index.md` — les fiches générées, une par skill.
- `skill-creator` — la mécanique générique (structure, divulgation progressive, évaluation).
