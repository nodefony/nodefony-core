# Méthode — scénarios : écrire les cas AVANT les options, puis la matrice

> Référence du skill `nodefony-decision-making`. Emprunte à l'analyse par scénarios d'attributs de
> qualité (ATAM, SEI) : les cas avant les options, chaque option passée contre tous. **Maintenance** : vérité courante ; un catalogue
> s'enrichit en place, jamais par une entrée datée.

## Sommaire

1. Pourquoi un catalogue fermé
2. Les catégories obligatoires
3. La matrice
4. Le gabarit d'un scénario
5. Où vit un catalogue
6. Exemple — la socket temps réel

## 1. Pourquoi un catalogue fermé

Une recommandation se juge contre une liste de cas. Si la liste n'existe pas, chaque cas arrive
APRÈS la décision, par une question de l'auteur ou par un bug, et la décision se refait. Un
catalogue écrit avant les options déplace la découverte au moment où elle ne coûte rien.

« Fermé » veut dire : la matrice d'une décision passe TOUS les scénarios du catalogue, pas ceux
qui l'arrangent. Un scénario qui ne s'applique pas se marque « sans objet », avec la raison.

## 2. Les catégories obligatoires

Un catalogue couvre au moins une situation par catégorie (sinon il dit pourquoi elle ne s'applique
pas). La table ci-dessous vaut pour une décision TECHNIQUE ; les autres sujets ont la leur, juste
après.

| Catégorie                    | La question qu'elle force                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| **Usages hétérogènes (≥ 3)** | la décision tient-elle pour trois usages qui ne se ressemblent pas ? (règle de généricité)  |
| **Charge**                   | à 10× ou 100× le volume habituel, que coûte-t-elle par requête, par trame, par octet ?      |
| **Panne et réseau**          | coupure, reconnexion, délai, service tiers éteint                                           |
| **Plusieurs instances**      | deux serveurs, un bus entre eux, un démarré après l'autre                                   |
| **Versions qui cohabitent**  | client ancien et serveur neuf, déploiement progressif, donnée écrite par l'ancienne version |
| **Attaquant**                | un client hostile, un accès au bus ou au stockage partagé, une entrée forgée                |
| **Plateformes**              | Linux, macOS, Windows (axiomes du `CLAUDE.md` racine)                                       |
| **Extension tierce**         | quelqu'un écrit son propre driver, adaptateur ou module : le peut-il sans toucher au cœur ? |
| **Agent IA consommateur**    | un agent qui copie l'exemple le plus proche choisit-il la bonne solution ?                  |
| **Exploitation**             | ce qu'un exploitant voit, configure, mesure ; ce qui casse en silence                       |
| **Mainteneur solo**          | le code, les tests et la doc qu'il faudra maintenir ; les doublons créés                    |

### Pour les autres sujets

| Sujet                        | Catégories à couvrir, en plus de « mainteneur solo » et « agent IA consommateur »                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Version, calendrier**      | qui met à jour et ce qu'il subit ; ce qui casse si on reporte ; ce qui attend si on garde ; la charge réelle (nombre de tickets, pas la somme des jours) |
| **Nom public, vocabulaire**  | qui le devine sans doc ; qui le cherche au `grep` ; ce qu'on y ajoutera demain sans qu'il mente ; la langue (anglais pour un identifiant)                |
| **Documentation**            | qui la lit (humain pressé, agent, débutant) ; ce qui devient public ; ce qui se périme ; ce qu'un automate contrôle                                      |
| **Organisation des tickets** | les dépendances réelles ; ce qui se fait dans la même session ; ce que `ticket:lint` refuse                                                              |
| **Sécurité**                 | l'attaquant extérieur, l'utilisateur malveillant, l'infrastructure compromise, l'erreur de configuration                                                 |

## 3. La matrice

Une fois le catalogue écrit : deux ou trois options, jamais une seule, et un tableau **scénario ×
option** — tient / casse / sans objet, avec la raison et la preuve (`<fichier>.ts#<Symbole>`, passage
d'ADR). Deux lignes s'ajoutent toujours : **contredit-elle une décision acceptée ?** et **qui porte
déjà cette règle ?** (1 règle = 1 implémentation). La recommandation est l'option qui ne casse aucun
scénario ; s'il n'y en a pas, le scénario sacrifié devient la question posée à l'auteur.

## 4. Le gabarit d'un scénario

```markdown
### S-<domaine>-<n> — <titre court>

- **Situation** : <concrète, chiffrée : « 1 000 joueurs, 60 coups/s chacun »>
- **Catégorie** : <une de la table>
- **Tient si** : <critère observable : un test, une mesure, un comportement visible>
- **Décisions qu'il a déjà fait changer** : <lien ADR, ou « aucune »>
```

Le dernier champ est ce qui rend le catalogue précieux : il garde la trace des cas qui ont coûté.

## 5. Où vit un catalogue

À côté de ce qu'il juge : `docs/adr/scenarios/<domaine>.md`, cité par chaque ADR du domaine. Pas
dans ce skill (il est générique) et pas dans un ticket (il se ferme). Un catalogue neuf se crée au
premier ticket du domaine traité avec cette méthode, puis sert à tous les suivants.

## 6. Exemple — la socket temps réel

Extrait de ce que le catalogue du temps réel doit contenir — chaque ligne a, sans catalogue, fait
changer une décision après coup :

| Scénario                                                         | Catégorie               | A fait changer                          |
| ---------------------------------------------------------------- | ----------------------- | --------------------------------------- |
| Un joueur passe dans un tunnel, la socket se reconnecte          | panne et réseau         | l'abonnement imposé (rejeu par `allow`) |
| Deux serveurs reliés par Redis, un modérateur éjecte sur l'autre | plusieurs instances     | les ordres par nom sur le bus           |
| Un driver de bus écrit par un tiers sur un journal partitionné   | extension tierce        | aucune méthode neuve sur le contrat     |
| Un vieil ordre « fermer » capté puis republié                    | attaquant               | la portée du sceau du bus               |
| Un client 10.0 qui ignore la notification de fermeture           | versions qui cohabitent | la fabrique qui rend `null`             |
| Un service gRPC qui relaie un canal                              | usages hétérogènes      | la règle d'admission commune            |
| 60 coups/s × 1 000 joueurs sur un canal à rôles                  | charge                  | le verdict retenu par connexion         |
