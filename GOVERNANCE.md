# Gouvernance de Nodefony

Ce document répond à une seule question : **qui décide, et comment.** Il existe parce que la
réponse est courte, et qu'une réponse courte non écrite se lit comme une réponse absente.

Il ne redit pas comment contribuer ([CONTRIBUTING.md](CONTRIBUTING.md)), ce qui est garanti d'une
version à l'autre ([compatibilité](docs/guides/compatibilite.md)), ni comment signaler une faille
([SECURITY.md](SECURITY.md)).

## Le modèle, sans détour

**Nodefony est dirigé par une seule personne** — Christophe CAMENSULI, auteur du projet. Il n'y a
ni comité technique, ni entreprise, ni financement. Les décisions d'architecture sont tranchées par
une personne, et c'est le cas depuis la première ligne.

Ce n'est pas une situation transitoire qu'on annonce en attendant mieux. C'est le modèle réel, et
tout ce qui suit sert à le rendre **vérifiable plutôt que personnel** : un projet dirigé par une
personne peut rester lisible du dehors, à condition que ses décisions soient tracées, que sa
surface publique soit tenue, et que rien n'empêche quelqu'un d'autre de reprendre.

## Comment une décision est prise

Il y a trois niveaux, et ils ne se confondent pas.

| Le niveau        | Où ça vit                                                                      | Ce qui s'y décide                                                                                           |
| ---------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **Architecture** | [`docs/adr/`](docs/adr/README.md)                                              | Ce qui engage le projet durablement : un ORM de référence, le modèle de session, la frontière d'un contrat. |
| **Travail**      | Les [issues](https://github.com/nodefony/nodefony-core/issues) et leurs jalons | Ce qui est fait, dans quel ordre, pour quelle version.                                                      |
| **Code**         | Les pull requests                                                              | Comment une décision déjà prise s'implémente.                                                               |

Un **ADR est immuable**. S'il est remis en cause, un nouvel ADR le remplace en le nommant ; on ne
réécrit jamais l'ancien. Le raisonnement écarté a autant de valeur que celui retenu — c'est lui qui
empêche de rouvrir deux fois le même débat, et c'est lui qui permet à un lecteur extérieur de
comprendre pourquoi le projet est comme il est plutôt que de deviner.

Les **jalons** disent l'ordre du travail et les dépendances entre tickets. Ils sont publics, et
ils sont la seule source de l'avancement : aucun document écrit à la main ne fait autorité sur
eux.

## Ce que vous pouvez obtenir, et ce que vous ne pouvez pas

**Ce qui est acquis :**

- **Une réponse motivée.** Une proposition refusée l'est avec la raison, pas par silence.
- **Une décision tracée.** Si elle engage l'architecture, elle devient un ADR — donc lisible, et
  contestable sur ses arguments.
- **Une rupture annoncée.** La surface publique (`exports`) ne casse pas en mineure ni en patch ;
  le cycle de dépréciation est écrit et il est tenu.
- **Un correctif de portabilité prioritaire.** Le framework vise linux, macOS et Windows à parité,
  et Windows est l'angle mort structurel d'un projet développé sur macOS.

**Ce qui ne l'est pas, et il vaut mieux le savoir avant :**

- **Aucun délai.** Ni sur une issue, ni sur une pull request, ni sur une faille. Les ordres de
  grandeur réels sont dans [SECURITY.md](SECURITY.md) ; ce sont des intentions, pas des
  engagements contractuels.
- **Aucun rétroportage.** Seule la dernière majeure reçoit des correctifs, sécurité comprise. La
  raison est écrite dans le [guide de compatibilité](docs/guides/compatibilite.md) : une politique
  étroite et vraie vaut mieux qu'une garantie confortable qui serait rompue au premier trimestre
  chargé.
- **Aucune garantie qu'une grosse fonctionnalité soit fusionnée.** Ouvrez une issue d'abord. Le
  refus le plus fréquent n'est pas « c'est mal écrit », c'est « ça ne va pas dans la direction du
  projet » — et c'est précisément ce qu'une discussion préalable évite de découvrir après trois
  semaines de travail.

## La direction technique, et ses limites

Le projet suit une ligne assumée : **un framework générique, jamais de logique métier dans le
cœur**, inspiré de Symfony pour le noyau (injection de dépendances, modules, pare-feu applicatif)
et de NestJS pour l'ergonomie TypeScript.

Cette ligne a des **conséquences opposables**, qui ne sont pas des préférences :

- **Ce que l'écosystème fait bien, le framework ne le réécrit pas.** Les serveurs sont ceux de
  Node, l'ORM de référence vient de l'écosystème, le bundle front aussi. Une application générée
  porte une poignée de dépendances de production — le chiffre exact est affirmé dans
  [`AGENTS.md`](AGENTS.md), et il est **calculé** depuis le gabarit par un contrôle automatique, de
  sorte qu'il ne peut pas dériver de la réalité.
- **Ce qui est propre au framework est extensible.** Les contrats destinés à recevoir une
  implémentation tierce sont exportés et documentés ; le but est qu'une brique manquante se
  branche, pas qu'elle se demande.
- **Une décision structurante se justifie par écrit.** Pas « c'est mieux », mais ce qui a été
  mesuré ou ce qui a été cassé.

Si une décision vous paraît fermer le framework sur lui-même, **c'est un argument recevable** :
ouvrez une issue en nommant ce que vous ne pouvez pas faire sans modifier le code du framework.
C'est le genre de retour qui a le plus de chances de changer quelque chose.

## Le point faible, nommé

**Le projet dépend d'une personne.** C'est le risque réel, il ne se corrige pas par un document, et
le nier serait plus inquiétant que l'écrire.

Ce qui est fait pour qu'il ne devienne pas un piège pour ceux qui s'en servent :

- **Licence [Apache 2.0](LICENSE.txt), et aucun accord de cession de droits.** Les contributions
  restent sous la licence du projet, personne ne signe de transfert, et aucune entité ne peut
  refermer le code ou le relicencier. Si le projet s'arrête, **un fork ne demande l'autorisation de
  personne** — et la licence concède en plus une licence de brevet explicite.
- **Rien d'essentiel ne vit en dehors du dépôt.** La chaîne de publication, les contrôles, les
  décisions et la documentation sont versionnés ici. Il n'y a pas de service privé, pas de script
  sur un poste, pas de clé personnelle dans la boucle : reprendre le projet demande le dépôt, pas
  un accès à quelqu'un.
- **La politique de support est étroite et dite d'avance**, précisément pour qu'une interruption ne
  surprenne personne.

**Devenir co-mainteneur est possible et n'a rien de cérémonial** : cela se gagne sur des
contributions suivies — des correctifs que je n'ai pas eu à réécrire, des revues justes, une
compréhension des invariants du dépôt. Ce n'est pas une place à demander, c'est un état de fait
qu'on finit par constater. Si vous en êtes là, ouvrez une issue : ce sera une discussion, pas une
candidature.

## Modifier ce document

Cette page décrit un état, pas une intention. Si elle cesse de dire vrai — un second mainteneur, un
financement, un comité — elle se corrige **en place**, dans la pull request qui rend le fait vrai.
L'historique des changements est dans `git log` ; il n'a pas à être recopié ici.
