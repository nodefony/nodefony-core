# Méthode — la mesure qui tranche

> Référence du skill `nodefony-decision-making`. Quand la question a une réponse chiffrée, un
> avis ne la remplace pas. **Maintenance** : vérité courante ; éditer en place.

## Quand

La décision dépend d'un **coût** : temps par requête ou par trame, octets retenus, débit, mémoire,
taille d'un paquet, durée d'un démarrage. « Est-ce que ça vaut la peine ? » se mesure.

## La procédure

1. **Écrire AVANT de mesurer ce que chaque résultat ferait décider** : « si le verrou pèse plus
   de 10 % de la trame, on retient le verdict ; sinon on ne touche à rien ». Sans ce seuil posé
   d'avance, n'importe quel chiffre se lit comme une confirmation.
2. **Comparé à quoi ?** Toujours une référence : avant / après, avec / sans, un camp équivalent.
   Un chiffre seul ne tranche rien.
3. **Le bon instrument** : micro-banc pour isoler un coût en nanosecondes, banc de bout en bout
   pour savoir s'il compte dans le total. Protocole, validité et pièges : skill
   `nodefony-load-test` — à charger avant de lancer quoi que ce soit.
4. **Valider le travail mesuré** : le banc prouve que le travail a eu lieu (statut, messages
   reçus), sinon aucun chiffre n'est publié.
5. **Rendre le verdict avec son bruit** : médiane de N runs, étendue ; un écart dans le bruit se
   dit « dans le bruit », jamais « gagné ».
6. Le résultat, la commande pour le rejouer et ce qui n'a PAS été mesuré vont dans le ticket.

## Ce qu'elle coûte

De quelques minutes (micro-banc) à une session (banc de bout en bout). Un banc qui démarre un
serveur tue le `nodefony development` de l'auteur : le dire avant.

## Pièges

- **Mesurer avant d'avoir écrit le seuil de décision** : on mesure, puis on décide ce que le chiffre
  voulait dire.
- **Un micro-banc pris pour le coût réel** : il ne voit ni le décodage réseau ni le reste du
  chemin. Il dit « combien coûte cette pièce », pas « combien pèse-t-elle dans le tout ».
- **Mesurer la vitesse d'un échec** : sans contrôle de validité, une erreur rapide améliore le
  score.

## Exemple vécu

« Faut-il retenir le verdict du verrou de trame ? » (ADR-0022 §6, décision 1 bis). Micro-banc
`.claude/skills/nodefony-load-test/scripts/micro/micro-frame-authorizer.mjs` : le verrou ajoutait
24 % (canal libre) à 35 % (canal à rôles) à la trame, un verdict retenu 9 %. La décision s'est
prise sur ce chiffre ; sa validation finale est un banc de bout en bout écrit dans le ticket.
