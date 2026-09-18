# Derrière un frontal — nginx, haproxy, Ingress

> **Maintenance** : vérité courante. Éditer en place.

## 1. La configuration se DÉRIVE, elle ne s'écrit pas

```bash
npx nodefony proxy:generate nginx    [-o <fichier>] [-b <hôte>] [-l <port>] [--reencrypt]
npx nodefony proxy:generate haproxy
```

La commande **démarre l'application sans ouvrir de port**, lit ses montages statiques réels, sa
taille de corps maximale et son battement de cœur temps réel, puis écrit la configuration.

**Pourquoi ça compte** : une configuration écrite à la main est juste le jour où on l'écrit. Au
premier dossier statique ajouté, à la première route de téléversement, elle devient fausse — et
elle ne le dit pas : elle sert un 404 ou un 413 que personne ne rattache à la configuration du
frontal.

Dans l'image, cette génération est un étage de construction : la configuration est produite **au
moment où l'image est construite**, donc à partir du code exact qu'elle embarque.

## 2. Le point qui casse tout si on l'oublie

🔴 **`NF__HTTP__TRUSTPROXY`**

Quand ton frontal termine le TLS, l'application reçoit du **HTTP en clair**, plus un en-tête qui
annonce le schéma d'origine. Sans réglage, elle ne croit pas cet en-tête — et c'est la bonne
position par défaut, parce qu'un en-tête est trivialement falsifiable par un client.

Conséquence si tu ne le poses pas : le schéma constaté est `http`, donc :

- **le cookie `__Host-` n'est pas émis** — ce préfixe impose qu'il soit posé sur une origine
  sécurisée. Les sessions ne tiennent pas, **sans aucun message** ;
- l'adresse cliente enregistrée est celle du frontal, donc l'audit et toute limitation par adresse
  portent sur une seule IP ;
- les redirections peuvent pointer sur `http://`.

```yaml
NF__HTTP__TRUSTPROXY: uniquelocal # le frontal est sur un réseau privé
```

**Le prouver, plutôt que le croire** — c'est un réglage dont l'effet est invisible tant qu'on ne
regarde pas le bon endroit :

```bash
curl -ksSI https://<hôte>/ | grep -i '^set-cookie'     # doit porter un cookie préfixé __Host-
```

Puis **débranche-le** : retire la variable, redéploie, refais la requête. Le cookie doit tomber. Un
réglage qu'on n'a jamais vu manquer n'est pas un réglage prouvé.

## 3. Les autres réglages du mode « derrière un frontal »

| Variable                     | À poser                     | Ce qu'elle fait                                                                          |
| ---------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| `NF__HTTP__TRUSTEDHOSTS`     | les hôtes réellement servis | Un `Host` étranger est refusé — coupe l'empoisonnement d'en-tête                         |
| `NF__APP__DOMAINCHECK`       | `"true"`                    | Contrôle du domaine actif                                                                |
| `NF__HTTP__STATICS__ENABLED` | `"false"`                   | **Le frontal sert les fichiers statiques** ; l'application cesse de les servir en double |

Laisser l'application servir les statiques derrière un frontal qui les sert aussi n'est pas une
erreur fonctionnelle — c'est un gaspillage silencieux : chaque fichier peut être servi par le
mauvais des deux, avec des en-têtes de cache différents.

## 4. Ne publie aucun port de l'application

Derrière un frontal, l'application **ne doit publier aucun port**. C'est la définition d'être
derrière quelque chose : le seul chemin doit passer par le frontal. C'est ce que fait le profil de
topologie de production du compose — l'application n'y a aucune ligne `ports:`.

Si tu publies quand même un port « pour déboguer », tu as deux portes d'entrée, dont une sans TLS,
sans limitation et sans les en-têtes que ton frontal pose. Utilise `docker compose exec` ou un
transfert de port temporaire.

## 5. Les sondes, vues du frontal

Ton frontal a besoin de savoir quand retirer un exemplaire. Les deux sondes ne servent pas à la
même chose :

| Sonde     | Pour quoi                       | Pendant l'arrêt |
| --------- | ------------------------------- | --------------- |
| `/livez`  | « le process est-il vivant ? »  | **reste `200`** |
| `/readyz` | « peut-il prendre du trafic ? » | passe à `503`   |

**Ton frontal doit sonder `/readyz`**, jamais `/livez` : c'est `/readyz` qui bascule dès le début de
l'arrêt, donc c'est lui qui te fait retirer l'exemplaire **avant** qu'il cesse de répondre. Un
frontal qui sonde `/livez` garde l'exemplaire dans sa table pendant tout le drain et envoie du
trafic à quelque chose qui refuse déjà.

Les deux répondent **avant la limitation de débit**. Si tu obtiens un `429` sur une sonde, ce n'est
pas la sonde que tu as appelée : vérifie que tu interroges bien le chemin nu, sans préfixe ajouté
par une règle de réécriture.

## 6. En Kubernetes — l'Ingress, pas une configuration nginx

Le frontal dérivé sert pour une machine, un compose, une machine virtuelle. **Dans un cluster, ce
rôle appartient au contrôleur d'Ingress**, que tu as choisi et que l'application ne connaît pas.

Donc : un `Ingress` standard — chemins, TLS, taille de corps en annotation — et non une
configuration nginx générée, qui ne fonctionnerait qu'avec un seul contrôleur.

Ce qui reste vrai, et ce qui change :

| Point                           | Avec un frontal à toi | Avec un Ingress                    |
| ------------------------------- | --------------------- | ---------------------------------- |
| `NF__HTTP__TRUSTPROXY`          | **obligatoire**       | **obligatoire**                    |
| `NF__HTTP__TRUSTEDHOSTS`        | recommandé            | recommandé                         |
| Configuration dérivée           | oui                   | non — un `Ingress`                 |
| Qui sert les fichiers statiques | le frontal            | l'application, ou un service dédié |

## 7. Sous Podman sans privilèges — ce qu'on ne peut pas réparer

L'adresse source du client **est perdue** : le trafic arrive depuis la passerelle de redirection.
Derrière un frontal, l'en-tête d'adresse d'origine porte donc la passerelle, pas le client.

Ce n'est pas un réglage à trouver : c'est une propriété du mode sans privilèges. **Énonce-le** —
ton audit et ta limitation par adresse sont faux, sans aucune erreur pour le signaler. Voir
[`podman.md`](podman.md).
