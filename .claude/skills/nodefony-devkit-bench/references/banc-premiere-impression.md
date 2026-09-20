# Banc de première impression — ce qu'un agent conclut du dépôt sans y entrer

> Référence du skill `nodefony-devkit-bench`, chargée **avant de lancer ce banc**. Déclencheurs :
> « un agent recommanderait-il ce framework ? », « que conclut un agent en lisant le dépôt ? »,
> « notre accueil dit-il vrai ? ».
>
> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.

```bash
# le JUGE, avant de payer un run
node .claude/skills/nodefony-devkit-bench/scripts/lib/premiere-impression.selftest.mjs --prove
# le décor seul : 0 agent, 0 coût
node .claude/skills/nodefony-devkit-bench/scripts/bench-first-impression.mjs --decor-only
node .claude/skills/nodefony-devkit-bench/scripts/bench-first-impression.mjs           # un run
node .claude/skills/nodefony-devkit-bench/scripts/bench-first-impression.mjs --prove   # + contre-épreuve (DEUX runs)
node .claude/skills/nodefony-devkit-bench/scripts/bench-first-impression.mjs --answer <fichier>
```

## Ce qu'il mesure — et le piège qui fait tout rater

Les autres bancs jugent ce que le générateur **produit**. Celui-ci juge ce que le dépôt fait
**croire** : un développeur interroge un agent avant d'ouvrir un README, et c'est devenu le premier
contact du projet.

> 🔴 **Le but n'est PAS d'obtenir un avis favorable.** Un refus fondé sur un fait vrai — préversion,
> une seule personne, pas de rétroportage — est un **succès** : le projet a été honnête, et
> l'évaluateur a décidé en connaissance de cause. Ce que ce banc traque est le motif **FAUX**.
> Noter le sens du verdict pousserait à taire les réserves du projet, c'est-à-dire à bien scorer
> **en mentant**. Le code applique cette règle : `verdict` est imprimé « informatif, pas un
> critère », et le code de sortie ne dépend que de `juste` (aucun motif faux).

**Ce qui a motivé le banc** : un agent grand public a conseillé d'écarter Nodefony au motif qu'on
« hériterait du monorepo, de la migration, du Studio, de l'outillage IA ». Une application minimale
installe **quatre** paquets. Il avait jugé le dépôt de développement en croyant juger le produit.

## Le décor — la vue du WEB, et rien d'autre

Un dossier isolé qui contient exactement ce qu'un `fetch` atteint : `README.md`, `AGENTS.md`,
`llms.txt` et les **pages publiées** du site (le markdown de `dist-site/docs`, sans le HTML ni
l'index de recherche). Jamais `src/` — lui donner le dépôt mesurerait sa capacité à lire du code.

Il vient de l'artefact **rendu**, et le banc **refuse** de tourner si `dist-site/llms.txt` manque :
un décor deviné rendrait un verdict sur un site qui n'existe pas. La commande à lancer est affichée
dans le refus.

**Modèle par défaut : `haiku`**, même raison que le banc de découvrabilité — on mesure l'ACCUEIL,
pas l'intelligence de l'agent. Un modèle fort devine ce que l'accueil ne dit pas, et rend le banc
aveugle au défaut qu'il cherche.

## Les quatre questions, et pourquoi elles sont fermées

1. que fait ce framework, et pour qui ;
2. combien de dépendances une application minimale installe-t-elle ;
3. où lire le reste-à-faire avant la stable, et ce qui peut casser ;
4. recommanderais-tu de l'évaluer — oui/non, et le motif.

Chaque réponse est exigée **avec sa citation** (`fichier` + phrase). Sans citation, on ne distingue
pas un agent qui a lu d'un agent qui devine, et les deux rendent une réponse plausible.

## La contre-épreuve — elle RETIRE l'information, elle ne la déplace pas

`--prove` rejoue le banc sur le décor **d'avant** : la section qui distingue le dépôt du produit est
retirée, l'état de publication remonte en tête, le plan du site disparaît. Puis le banc exige que le
verdict se dégrade.

> ⚠️ **Mesuré, et c'est ce qui a corrigé l'instrument.** La contre-épreuve se contentait d'abord de
> remonter la section « État ». Jouée pour de vrai, elle n'a **rien** fait bouger : l'agent
> retrouvait les mêmes faits dans le README et concluait juste. Une contre-épreuve qui **réordonne**
> ne prouve rien — il faut retirer l'information, parce que c'est ce que le dépôt faisait avant : la
> distinction n'était écrite nulle part. Depuis, le banc mord (3/3 → 2/3, la question des
> dépendances tombe).

Si `retirerLaDistinction` ne trouve plus sa section — un titre réécrit —, elle rend l'entrée
**inchangée**, et la contre-épreuve se déclare muette au lieu de rendre un verdict de complaisance.

## Lire le résultat

| Sortie | Ce que ça dit                                                                                                                                |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`    | aucun motif faux. Le verdict de l'agent, quel qu'il soit, repose sur des faits vrais.                                                        |
| `1`    | au moins un motif faux, **ou** le banc ne mord pas sur le décor — dans le second cas, c'est l'instrument qu'il faut corriger, pas l'accueil. |
| `2`    | décor impossible (site non rendu).                                                                                                           |
| `64`   | drapeau inconnu.                                                                                                                             |

**Les motifs faux et leur imputation** : les quatre (`herite-du-depot`, `trop-de-dependances`,
`doc-inatteignable`, `calendrier-absent`) sont classés `DECOR` dans `.claude/skills/nodefony-devkit-bench/scripts/lib/imputation.mjs` — l'agent a
conclu depuis ce qu'on lui a donné, aucun geste de sa part ne peut les produire. Les motifs
**vrais** portent `constat:` et non `cause:` : ils ne provoquent aucun échec, ils disent que le refus
est fondé. Les inscrire dans la table d'imputation aurait exigé de leur donner une imputation qui
n'a pas de sens.

## Pièges

- **Ne pas lire la sortie de l'agent comme un rapport.** Le juge est dans `.claude/skills/nodefony-devkit-bench/scripts/lib/premiere-impression.mjs` ;
  l'agent, lui, écrit de la prose. Juger à l'œil, c'est reconduire son biais.
- **Un run coûte un agent.** `--decor-only` et `--answer` existent pour travailler sans en payer un ;
  `--prove` en paie **deux**.
- **Le décor pèse ~3 Mo** (98 pages publiées). C'est voulu : l'agent CHOISIT ce qu'il lit, comme un
  lecteur du web. Le réduire d'office mesurerait notre idée de ce qu'il devrait lire.
