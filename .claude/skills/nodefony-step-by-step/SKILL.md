---
name: nodefony-step-by-step
metadata:
  version: 1.0.0
description: >
  Conduit un chantier de conception avec l'auteur UNE décision à la fois : la situation sur un
  exemple concret, le piège, une recommandation motivée, puis une question fermée (oui / non /
  explique). Chaque oui est aussitôt inscrit dans l'ADR et le ticket, et un petit correctif part
  dans son propre commit. Évite le rapport de quatorze décisions que personne ne peut trancher
  d'un bloc. Le contenu technique reste aux skills du domaine. Se désactive sur demande.
  Déclencheurs : "une décision à la fois", "décision par décision", "aide-moi à décider", "il y a
  trop de choses", "j'ai du mal à suivre", "on avance doucement", "petit pas par petit pas",
  "on fait l'Epic comme ça".
---

# nodefony-step-by-step — une décision à la fois, avec l'auteur

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.

Le problème réglé : l'agent produit plus de décisions que l'auteur ne peut en trancher. Un relevé de
quatorze décisions ou trois ADR rendus d'un coup se font refuser en bloc (« je ne valide rien »),
alors que chaque décision, prise seule, se tranche en une minute. La méthode échange la charge de
lecture contre des tours courts, et c'est l'auteur qui garde la main sur chaque engagement.

## 1. Quand m'utiliser / quand passer la main

| Besoin                                                                  | Skill                    |
| ----------------------------------------------------------------------- | ------------------------ |
| Trancher un chantier de conception avec l'auteur, décision par décision | **ce skill**             |
| Écrire, corriger, ordonner ou fermer un ticket                          | `nodefony-ticket`        |
| Écrire l'ADR, la page de doc, et passer leurs contrôles                 | `nodefony-documentation` |
| Coder le correctif décidé (règles perf, typage, tests)                  | `nodefony-framework-dev` |
| Reprendre ou clore la session                                           | `nodefony-session`       |

**Désactivation** : « mode normal », « fais tout d'un coup », « décide seul ». On revient alors à
la règle par défaut du `CLAUDE.md` racine (l'agent tranche et justifie).

## 2. La procédure

### 2.1 Préparer, en silence

1. Rassembler la matière : le ticket, ses dépendances, le code (`nodefony-inspect`). Un relevé
   lourd part en sous-agent **pendant** qu'on avance avec l'auteur, et le principal vérifie ses
   affirmations avant de s'en servir.
2. Lister les décisions du chantier, sans les montrer en bloc. Les trier : **ce qui casserait les
   applications si on le décidait après la sortie de la version** passe en premier ; tout ce qui
   peut s'ajouter plus tard est reporté.
3. Annoncer le plan en un tableau de 3 à 5 lignes (« pour la 10, il ne faut que 3 décisions ») :
   l'auteur doit voir que la charge est **bornée**.

### 2.2 Un tour = une décision

> **Relire [`references/exemples.md`](references/exemples.md) AVANT d'écrire le premier tour** :
> des tours réels qui ont permis de trancher (explication pour les très nuls, tour complet,
> « explique mieux », question de côté qui trouve un trou, pas bis, tableau d'avancement) et les
> contre-exemples qui ont fait décrocher l'auteur. Le format ci-dessous ne suffit pas sans eux.

Format fixe, au plus ~30 lignes hors code :

1. **La situation**, sur un exemple concret et court : la vraie frame, le vrai appel, le vrai
   champ, jamais un schéma abstrait.
2. **Le piège** : pourquoi la décider maintenant, sur un scénario (« un client installe la 10.0,
   crée…, en 10.1 il reçoit… »).
3. **La recommandation** et son pourquoi, en 2 ou 3 puces : coût d'exécution, compatibilité, code à
   écrire (« aucun code : on écrit la promesse »).
4. **Une seule question fermée** : « … ? (oui / non / explique) ». Aucune autre question dans le
   message.

### 2.3 Quand l'auteur demande « explique » ou pose une question de côté

- **Vérifier au code avant de répondre**, et citer `fichier.ts#Symbole`. Une question de côté est
  un signal : sur la socket, « et le binaire en Redis ? » a trouvé une corruption silencieuse,
  « et le multi-tenant ? » un champ accepté que personne ne lisait, « et les canaux ? » le même
  trou ailleurs.
- **Ne pas défendre la recommandation** : réexpliquer autrement, partir de la question, puis
  reposer la même question fermée, éventuellement corrigée.
- Une réponse qui fait apparaître une décision nouvelle devient un **pas** (« pas 2 bis ») : elle
  ne s'ajoute pas en douce au pas courant.

### 2.4 Après un « oui »

1. **L'inscrire aussitôt**, là où elle fait foi : dans l'ADR, la ligne devient
   `**Décision (validée par l'auteur le <date>) :**` ; le ticket reçoit la ligne correspondante.
   Si le oui couvre deux points, le dire et proposer de retirer le second.
2. **Si la décision appelle du code**, et seulement un petit correctif : test vu rouge, correctif,
   suite du module, commit séparé (`nodefony-framework-dev`). Dire ce qui n'a pas été lancé.
3. **Un tableau d'avancement court** (pas / décision / état), puis le pas suivant.

### 2.5 Ce qui ne se fait pas

- Pas de validation globale implicite : un ADR reste `proposed` tant que l'auteur ne l'a pas
  accepté **en entier** ; une suite de « oui » ne vaut pas acceptation du document.
- Pas de rapport complet en fin de tour, pas de « voici les 14 décisions ».
- Pas d'`AskUserQuestion` : la question se pose dans la prose, avec son contexte.
- Pas de ticket ouvert sans demande : les sujets découverts vont au tableau d'avancement, puis au
  `_state` à la clôture.

## 3. Pour un Epic entier

- **Ticket par ticket**, dans l'ordre du tableau (`.ai/BOARD.md`), qui encode les dépendances. Le
  socle commun d'abord.
- Chaque ticket ouvre par son rituel « pour les nuls » (`nodefony-ticket`), puis ses décisions,
  une à une.
- **Une session = un ticket, ou quelques pas.** Proposer la clôture dès qu'elle s'allonge : le
  `_state` porte la liste des pas restants, et « reprends » repart du prochain.

## 4. Pièges

- **Trop d'un coup** : trois ADR rendus ensemble ont été refusés en bloc, alors qu'ils
  contenaient les mêmes décisions que celles tranchées ensuite en quatre tours.
- **L'exemple abstrait** : « la charge reste nue » ne parle à personne ; la frame
  `{ "method": "chat", "params": { "text": "bonjour" } }`, si.
- **Le vocabulaire d'un consommateur** : ne pas cadrer un socle générique par l'exemple d'un seul
  usage (un agent IA, un protocole tiers). Prendre une discussion, un tableau de bord, un capteur.
- **Le oui qui en couvre deux** : le dire, sinon l'auteur découvre plus tard une décision qu'il ne
  croyait pas avoir prise.

## 5. Gate

Une décision est « prise » quand elle est **écrite** (ADR ou ticket) avec la mention de validation,
et, si elle appelle du code, quand son correctif est **commité** avec un test vu rouge. Le
`_state` de fin de session liste les pas faits et les pas restants.
