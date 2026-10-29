# Méthode — pré-mortem

> Référence du skill `nodefony-decision-making`. Vient de la psychologie de la décision (Gary
> Klein) : imaginer l'échec comme déjà arrivé délie ce que l'optimisme du projet retient.
> **Maintenance** : vérité courante ; éditer en place.

## Quand

- Tout le monde est d'accord trop vite, l'auteur compris.
- Le risque d'échec est mal cerné : on sait ce qu'on gagne, pas ce qui peut mal tourner.
- En siège du contradicteur d'une table d'experts (`methode-table-d-experts.md`).

## La procédure

1. Poser la décision comme **prise et livrée**, à une date future précise (« la 10.2, dans un an »).
2. Énoncer : « **Elle a échoué.** Écris pourquoi. » Pas « qu'est-ce qui pourrait mal se passer ? »
   — la forme au passé est ce qui fait la différence : elle autorise le récit d'une cause, au lieu
   d'une liste de risques polie.
3. Récolter de trois à sept causes, chacune en une histoire courte et concrète : qui fait quoi,
   ce qui casse, comment on s'en aperçoit (ou pas).
4. Pour chaque cause : est-elle déjà couverte (scénario, test, ADR) ? Sinon, elle devient un
   **scénario** du catalogue, ou une **condition** de la décision, ou la raison d'en changer.
5. Ce qui reste sans réponse est montré à l'auteur, une cause par tour.

## Ce qu'elle coûte

Faite par le principal : quelques minutes, zéro agent. Faite par un siège `fable` indépendant :
le coût d'un agent (`methode-table-d-experts.md`, §7) — utile quand le principal a lui-même
construit la recommandation et ne verra pas ses angles morts.

## Pièges

- **Le principal qui fait le pré-mortem de sa propre recommandation** trouve des causes qu'il sait
  déjà parer. Pour une décision structurante, confier le pré-mortem à un siège qui n'a pas vu la
  recommandation.
- **Des causes génériques** (« les performances », « la sécurité ») ne servent à rien : exiger le
  récit (« un client mobile perd la socket dans un tunnel, se reconnecte, et… »).

## Exemple vécu

L'abonnement imposé par le serveur (ADR-0022 §6, décision 2) avait été recommandé « sans appeler
`allow` ». Le pré-mortem qu'on n'a pas fait aurait dit : « un joueur abonné d'office passe dans un
tunnel ; à la reconnexion, son client rejoue `subscribe`, `allow` répond non, il perd la partie ».
La recommandation a dû être remplacée après coup.
