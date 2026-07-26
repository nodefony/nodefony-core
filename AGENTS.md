# AGENTS.md — nodefony-core

Instructions destinées aux agents de codage travaillant sur ce dépôt, au format
[AGENTS.md](https://agents.md). Elles sont **agnostiques du fournisseur** : aucun
nom de modèle, aucun outil propriétaire. Un agent disposant d'instructions
spécifiques à son éditeur les lit en plus de ce fichier, jamais à la place.

Ce que ce fichier couvre : **comment déléguer du travail à d'autres agents sans
détruire ni gaspiller**. Le reste — architecture, conventions de code, commandes —
vit dans `CLAUDE.md` et dans les fichiers de module.

---

## 1. Avant de choisir un agent, chercher l'automate

La première question n'est pas « quel agent ? » mais **« faut-il un agent ? »**.

Un outil déterministe — recherche de motif, requête sur du JSON, historique de
version, linter, scanner de vulnérabilités, graphe symbolique du dépôt — est
**gratuit, exhaustif et reproductible**. Un modèle survole, n'offre aucune
garantie de couverture, et sur les tâches à seuil (compter exactement, mesurer une
entropie) il est à la fois plus cher **et** moins fiable.

> L'automate produit, le modèle juge.

Exemple vécu : « quel agent pour relire 2 700 fichiers à la recherche de secrets ? »
— aucun. Un scanner dédié le fait en secondes ; l'agent ne sert qu'à trier les
quarante résultats qu'il rend.

---

## 2. Deux déclencheurs de délégation

Déléguer quand **l'un des deux** est vrai :

- **Volume** — lire beaucoup pour rendre peu : inventaire, audit, recherche
  transverse. Le gain n'est pas la parallélisation, c'est que les fichiers lus
  **n'entrent jamais** dans le contexte principal ; seule la conclusion revient.
- **Nature** — toute liste d'affirmations à confronter au code. Signe distinctif :
  chaque élément a un **verdict binaire et une preuve**, aucun jugement n'est
  requis. « Ces corrections sont-elles en place ? », « ces références de
  `fichier:ligne` sont-elles encore justes ? », « ces clés de configuration
  sont-elles lues quelque part ? ».

**Plancher : deux vérifications indépendantes du même type suffisent.** En
dessous, faire soi-même.

**Ne pas déléguer** : l'édition de code au milieu d'une session (voir §5), et tout
ce qu'un automate rend directement.

---

## 3. Choisir le type d'agent AVANT le modèle

Deux axes indépendants, tous deux facteurs de coût :

| Axe        | Question                | Règle                                     |
| ---------- | ----------------------- | ----------------------------------------- |
| **Type**   | Que peut-il faire ?     | Le plus **restreint** qui fait le travail |
| **Modèle** | Avec quelle puissance ? | Le plus **léger** qui le fait bien        |

Sur le type : un agent en **lecture seule** ne peut pas casser le dépôt — c'est la
moitié de sa valeur. Il couvre tout inventaire et toute confrontation au code. Un
agent **capable d'écrire ou d'exécuter** n'est justifié que si la lecture ne suffit
pas ; chaque délégation de ce genre est un risque d'écrasement et de corruption.

Sur le modèle, le test qui tranche en une seconde : **la tâche a-t-elle une bonne
réponse vérifiable ?** Compter, extraire, confronter, lancer une commande et lire
son verdict, appliquer un patron connu — oui, donc le modèle le plus léger.
Choisir, pondérer, rédiger pour un humain, décider ce qui mérite d'exister — non,
donc plus haut.

Monter en gamme est la décision **qui se motive**, et la justification doit nommer
ce que le modèle léger échouerait à faire. Si cette phrase ne vient pas, le modèle
léger suffisait.

Les deux erreurs ne coûtent pas pareil. **Trop faible** : la réponse revient
plausible et fausse, on la croit, et on paie deux fois — le travail raté, puis le
travail refait. **Trop fort** : on paie plusieurs fois le prix pour énumérer des
fichiers, sans qu'une ligne du résultat change.

---

## 4. Un agent n'est pas gratuit non plus

Il faut l'énoncer, attendre, puis **vérifier ce qu'il affirme**. Trois cas où
déléguer coûte plus que faire :

1. **Un automate rend la réponse** (§1) — deux secondes, exhaustif, rien à
   recontrôler.
2. **La réponse tient en une commande dont on lit la sortie** — l'écrire pour
   quelqu'un d'autre prend plus longtemps que la lancer.
3. **La tâche est sur le chemin critique** et conditionne le geste suivant : la
   latence se paie en attente pure.

Le bon usage est l'inverse du troisième : **ce qui peut avancer pendant qu'on
travaille ailleurs**.

---

## 5. Règles de sûreté — les trois qui ont déjà coûté

### 5.1 Aucun agent délégué ne touche à l'index de version

À écrire **en toutes lettres dans chaque instruction de délégation** : pas de
restauration, pas de remise, pas de réinitialisation, pas de validation, pas de
publication.

Le motif n'est pas la prudence, c'est un vol de travail constaté : un agent chargé
de mesurer un état de référence a « nettoyé » l'arbre et emporté une heure de code
non validé. La perte ne se voit pas au moment où elle se produit — elle apparaît
plus tard, sous la forme d'un test qui échoue sur une fonction devenue
introuvable. L'agent ne voit pas le travail en cours ; il voit un arbre sale à
ranger.

Corollaires : **valider avant de déléguer** quand l'arbre n'est pas propre ;
donner à l'agent un autre moyen d'annuler (réinstaller une version, réécrire le
fichier) ; ne jamais éditer les fichiers qu'un agent en vol touche.

### 5.2 Un verdict vérifiable ne rend pas le geste mécanique

« Retirer les imports inutilisés » a un verdict binaire par occurrence. Un modèle
léger l'a pourtant exécuté en coupant des listes d'imports en plein milieu,
produisant des fichiers qui ne compilaient plus.

Éditer du code est une opération **structurelle** sur un arbre syntaxique que le
modèle ne parse pas : il édite par correspondance de texte. Donc **déléguer le
diagnostic, garder l'édition** — ou n'accepter l'édition déléguée que là où un
automate la porte (correction automatique d'un linter, transformation
programmatique), avec compilation **et** tests derrière.

### 5.3 L'agent propose, l'appelant applique

Il ignore les décisions prises dans la session en cours ; le laisser éditer produit
des correctifs qui contredisent le fil. Lui demander « fichier → section → texte
exact → preuve », et trancher soi-même.

Et **vérifier avant de répercuter** : un agent peut affirmer l'existence d'un
fichier qui n'existe pas. Toute affirmation d'inventaire se recontrôle avant
d'entrer dans une synthèse.

---

## 6. Rédiger une instruction de délégation

Ce qui distingue un agent utile d'un agent coûteux tient surtout à l'énoncé.
Aucun modèle ne rattrape un périmètre flou.

- **Le périmètre en chemins exacts.** Un périmètre approximatif envoie chercher au
  mauvais endroit.
- **Les faits déjà établis**, pour qu'il ne les recollecte pas.
- **Les interdits**, dont ceux du §5.
- **La vérification obligatoire avant de rendre**, avec les chiffres attendus
  (« la compilation doit rester à N sur N », « la suite doit rester à M tests »).
  Toute baisse est une régression que l'agent a introduite.
- **L'autorisation explicite de s'arrêter** : « si tu ne peux pas y arriver sans
  casser l'un de ces contrôles, arrête-toi et explique ». Un agent sans porte de
  sortie invente une solution.
- **Ce qu'il n'a pas pu vérifier**, exigé dans le rendu. C'est souvent
  l'information la plus utile du rapport.

---

## 7. Ce qui ne se délègue jamais

- La décision de publier, de supprimer des fichiers, ou de modifier la structure
  du dépôt.
- L'arbitrage entre deux conceptions défendables.
- La qualification d'un échec de test : suspecter son propre travail avant de
  déclarer un problème « pré-existant ».
