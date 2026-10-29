# Méthode — l'essai jetable

> Référence du skill `nodefony-decision-making`. Quand personne ne sait si c'est faisable, on
> essaie petit avant de décider grand. **Maintenance** : vérité courante ; éditer en place.

## Quand

- La **faisabilité** est inconnue : une technologie neuve, une intégration jamais faite, une
  norme qu'on n'a jamais servie.
- Les avis divergent sur ce que « ça coûterait », et seul le code peut répondre.

Un essai ne décide pas à la place de l'auteur : il rend des **faits**, puis on revient au socle
(§2 du skill) avec eux.

## La procédure

1. **Un ticket de type `POC`** (skill `nodefony-ticket`) dont le « Fini quand » est une liste de
   **questions fermées** : « le pipeline laisse-t-il passer X ? », « le délai coupe-t-il un appel
   long ? », « combien coûte le chargement ? ».
2. **Le plus petit code qui répond**, rangé à part (`src/modules/test/nodefony/poc/<sujet>/`),
   jamais dans le produit. Rien dans le pipeline du framework n'est modifié par un essai.
3. **Une réponse par question**, avec sa preuve : commande rejouable, garde vue mordre (débrancher
   et constater que ça casse), mesure de coût.
4. **Le compte rendu nomme ce qui n'a pas été fait**, puis ouvre les tickets de livraison.
5. **La décision se prend ensuite**, par la méthode que l'aiguillage désigne, sur ces faits.

## Ce qu'elle coûte

Une session en général. C'est cher pour une question qu'un avis informé tranche ; c'est bon marché
face à une décision structurante prise à l'aveugle.

## Pièges

- **L'essai qui devient le produit** : il s'écrit pour répondre, pas pour durer. Les tickets de
  livraison le réécrivent proprement.
- **L'essai sans questions fermées** : il « explore » et ne conclut rien.
- **Décider pendant l'essai** : il rend des faits ; l'auteur tranche après.

## Exemple vécu

Le POC gRPC (#690) : quatre questions fermées sur le serveur HTTP/2 (le corps est-il lu avant le
contrôleur ? le délai coupe-t-il ? les proxys routent-ils ? où le ranger ?), une réponse prouvée
chacune, zéro changement du cœur, puis un Epic de livraison (#694). Il a aussi fait apparaître ce
qu'aucune ADR ne disait : gRPC est une livraison d'abonnement comme la socket (#702, T5).
