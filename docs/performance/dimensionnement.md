---
title: "Dimensionnement — ce que tient un pod, et combien il en faut"
lang: fr
module: "global"
topic: perf-dimensionnement
section: "Performance"
audience: [developer, devops]
tags: [performance, capacite, dimensionnement, pod, websocket, saturation]
status: stable
updated: "2026-08-07"
source: ".claude/skills/nodefony-load-test/scripts/capacity.mjs"
tests: none
---

📍 [Documentation](../index.md) › [Performance](index.md) › **Dimensionnement**

> Un record de débit ne dimensionne rien. Ce qui dimensionne, c'est le débit d'une route
> **représentative** de l'application, la latence acceptée au 99ᵉ centile, et le comportement du
> serveur **au-delà** du point où il ne suit plus. Cette page donne les trois, et dit ce qu'elle
> n'a pas su mesurer.

## Le modèle — un processus, un pod

Nodefony se déploie en mode natif du nuage : **un processus Node par pod ou conteneur**. La mise à
l'échelle est horizontale et déléguée à l'orchestrateur ; la supervision des processus aussi. Il
n'y a pas de gestionnaire de processus embarqué.

Conséquence pour le dimensionnement : la constante utile est le **débit d'un processus sur une
route représentative**, et le nombre de pods s'en déduit. Pour un déploiement sur machine nue,
plusieurs processus sur une même machine restent possibles par le mode grappe, qui tient compte
des limites de groupe de contrôle.

## Constantes d'un pod — route applicative avec base de données

Route de lecture sur un corpus réaliste : trois tables issues d'un schéma de gestion réel
(84, 100 et 74 colonnes), peuplées de 50 utilisateurs, 200 sociétés et 10 000 factures,
statistiques rafraîchies avant mesure.

| Route                                 | Débit soutenu par pod |
| ------------------------------------- | --------------------: |
| Lecture (20 lignes, publique)         | **~1 650 requêtes/s** |
| Lecture connectée (session + lecture) | **~1 040 requêtes/s** |

L'écart entre les deux lignes est le coût d'une **reprise de session** : deux allers-retours
supplémentaires vers la base par requête.

### L'escalier de concurrence — où le débit cesse de monter

| Route             | Connexions simultanées | Débit | Latence médiane | Latence p99 |
| ----------------- | ---------------------: | ----: | --------------: | ----------: |
| Lecture           |                     25 | 1 642 |         13,7 ms |     27,4 ms |
| Lecture           |                     50 | 1 663 |         27,8 ms |     49,1 ms |
| Lecture           |                    100 | 1 597 |         59,6 ms |    163,8 ms |
| Lecture connectée |                     25 | 1 031 |         21,7 ms |     44,5 ms |
| Lecture connectée |                     50 | 1 054 |         43,2 ms |     75,9 ms |

**La lecture importante est celle-ci** : le débit est déjà à son plafond à 25 connexions
simultanées. Doubler la concurrence ne rend **rien** de plus — cela double la latence médiane. La
tripler dégrade le débit **et** multiplie le 99ᵉ centile par six.

Au-delà du point de saturation, la concurrence supplémentaire ne produit pas du service : elle
produit de la **file d'attente**. C'est ce que dit le p99, et c'est pourquoi il est publié à côté
du débit — une moyenne le cacherait.

> ⚠️ **Ces absolus ne sont pas transposables.** Ils sont mesurés derrière une virtualisation
> réseau qui coûte un facteur 3,7 sur le chemin de la base (voir
> [Le décor ment plus souvent que le code](instruments.md)). Sur un déploiement Linux natif, la
> base est plus proche et ces chiffres montent. **Ce qui se transpose, ce sont les rapports** : le
> coût relatif d'une session, la forme de la courbe de concurrence, le point où la latence décolle.

## Calculer un nombre de pods

La règle est délibérément simple, parce qu'un calcul sophistiqué sur une constante approximative
ne vaut pas mieux :

```
pods = trafic de pointe (req/s) ÷ (débit par pod × taux d'occupation visé)
```

Le **taux d'occupation visé** est le levier réel. Viser 100 % du débit mesuré revient à déployer
sur le point exact où la latence décolle. En pratique :

| Taux d'occupation visé | Ce qu'on obtient                                               |
| ---------------------: | -------------------------------------------------------------- |
|                   50 % | latence stable, marge pour une panne de pod ou un pic          |
|                   70 % | compromis courant                                              |
|                   90 % | densité maximale, latence p99 sensible au moindre déséquilibre |

Exemple, sur une application dont les requêtes ressemblent à la route connectée
(~1 040 requêtes/s par pod), pour un trafic de pointe de 3 000 requêtes par seconde :

- à 50 % d'occupation : `3000 ÷ (1040 × 0,5)` ≈ **6 pods**
- à 70 % : ≈ **5 pods**

Trois précautions valent plus que la précision du calcul :

1. **Mesurer sa propre route.** Les constantes ci-dessus valent pour la route mesurée, sur ce
   corpus, avec cette base. Le banc est versionné et se rejoue sur une vraie application.
2. **Compter la base de données comme une ressource partagée.** Multiplier les pods multiplie les
   connexions ; le pool a une taille, et le serveur de base aussi.
3. **Dimensionner sur le pic, pas sur la moyenne** — et vérifier que l'orchestrateur sait ajouter
   un pod plus vite que le pic ne monte.

## Transport HTTP — sans base de données

Mesures d'un autre instrument (client Node, saturation lue par l'utilisation de la boucle
d'événements plutôt que par le CPU système), sur une route sans accès aux données :

| Transport           | Débit | Utilisation de la boucle |
| ------------------- | ----: | -----------------------: |
| HTTP/1.1 en clair   | 6 827 |                     0,89 |
| HTTPS/1.1 (TLS)     | 7 406 |                     0,78 |
| HTTP/2 (multiplexé) | 6 207 |                     0,89 |

Ces valeurs ne se comparent pas à celles de la page [Face aux autres](comparaisons.md) : instrument
différent, client différent, route différente. Elles servent à situer les **transports entre eux**.

L'utilisation de la boucle est la bonne mesure de saturation ici, et non le temps processeur
rapporté par les outils système : ceux-ci additionnent **tous** les fils, ramasse-miettes compris,
et rendent des valeurs supérieures à 100 % du temps mural.

## WebSocket — plafonds et comportement

| Grandeur                      | Valeur                | Ce qui limite réellement                                                     |
| ----------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| Connexions simultanées        | **16 372**            | les **ports éphémères** en boucle locale, pas la mémoire ni les descripteurs |
| Écho, une connexion           | ~7 200 messages/s     | —                                                                            |
| Diffusion, ventilation propre | jusqu'à ~40 000 msg/s | —                                                                            |
| Diffusion, saturation         | vers ~120 000 msg/s   | le serveur met en tampon, **il ne tombe pas**                                |

Le plafond de connexions est un artefact de la boucle locale : les clients partagent une seule
adresse, donc une seule plage de ports. **En réseau réel, avec des adresses clientes distinctes,
il remonte.** Il faut aussi ouvrir les connexions **par lots** pour l'atteindre : ouvrir des
centaines de connexions d'un coup échoue **côté client** et sous-estime le plafond d'un facteur
trois — mesuré 4 741 sans lots contre 16 372 avec.

### Ce que fait le serveur quand il ne suit plus

Un banc de saturation combinée — montée simultanée en connexions WebSocket, en requêtes HTTP et
en requêtes de base — a poussé le serveur jusqu'à : processeur à 100 %, boucle d'événements
saturée, retard de boucle de 500 à 600 ms.

**Le serveur n'est pas tombé.** Il a répondu en HTTP `200` en ~5,3 secondes, contre ~240 ms à
vide : **latence dégradée, zéro plantage, zéro erreur**.

C'est le comportement attendu, et il oriente la supervision : sous charge extrême, ce qui meurt
en premier est le **temps réel** — par famine de la boucle d'événements — pas le service HTTP.
Un indice de santé doit donc rendre « dégradé » (saturation) et réserver « critique » aux vraies
pannes : erreurs, connecteur coupé, mémoire proche de la limite.

Une conséquence à connaître pour ne pas crier à la fuite : la mémoire gonfle **pendant** le stress,
puisque les connexions sont tenues. Ce qu'il faut vérifier est le **retour à la normale après
drainage**, pas la valeur pendant.

## Ce que ce dimensionnement n'a pas su mesurer

Publier ceci fait partie du travail :

| Mesure tentée                                 | Pourquoi elle est écartée                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Mémoire par socket sécurisée                  | Régression sans qualité d'ajustement (R² = 0,25) — aucun modèle                               |
| Plafonds WebSocket en clair et en ventilation | Fenêtre d'utilisation de boucle aveugle (0,01 et 0,12) — l'instrument ne voyait pas la charge |

Une mesure qui ne s'ajuste pas n'est pas une mesure imprécise : c'est une absence de résultat. Elle
est publiée comme telle plutôt que rendue sous une forme présentable.

## Lexique

Termes propres à ce chapitre. Le vocabulaire général est défini dans
[Méthode de mesure](methode.md#lexique).

| Terme                       | Ce qu'il désigne ici                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Pod**                     | Une unité de déploiement = **un processus Node**. La mise à l'échelle est horizontale.                             |
| **Taux d'occupation**       | Part du débit mesuré qu'on accepte d'utiliser en régime nominal. Le vrai levier du dimensionnement.                |
| **Point de saturation**     | Concurrence au-delà de laquelle le débit cesse de monter et la latence croît linéairement.                         |
| **Ports éphémères**         | Plage de ports source disponible pour des connexions sortantes. C'est **elle** qui borne un banc en boucle locale. |
| **Ventilation** (_fan-out_) | Diffusion d'un message à N abonnés. Grandeur clé du temps réel.                                                    |
| **Famine de boucle**        | État où la boucle d'événements est saturée : le temps réel meurt en premier, le HTTP dégrade sans tomber.          |
| **Drainage**                | Vidange des connexions tenues après un stress. La mémoire ne se juge qu'**après**, jamais pendant.                 |

## Pièges

- **Dimensionner sur un record de débit** revient à déployer exactement sur le point où la latence
  décolle. Dimensionner sur un taux d'occupation.
- **Le débit plafonne bien avant la latence.** Sans le p99 à côté du débit, on croit gagner en
  ajoutant de la concurrence alors qu'on empile de la file.
- **Ne pas mesurer la saturation avec les outils système** : ils additionnent tous les fils.
  L'utilisation de la boucle d'événements est la bonne grandeur.
- **Un plafond de connexions en boucle locale n'est pas un plafond de production** — c'est un
  plafond de ports.
- **Ouvrir les connexions par lots**, sinon on mesure une limite du client.

## Pour aller plus loin

- ⬆️ **Retour au hub** : [Performance](index.md)
- 🗄️ [ORM et bases de données](orm.md) — d'où viennent les constantes par pod
- ⏱️ [La boucle d'événements](boucle-evenements.md) — pourquoi le p99 explose avant le débit
- 🎭 [Le décor ment plus souvent que le code](instruments.md) — pourquoi ces absolus ne se transposent pas
- 🧰 Instrument : `.claude/skills/nodefony-load-test/scripts/capacity.mjs`
