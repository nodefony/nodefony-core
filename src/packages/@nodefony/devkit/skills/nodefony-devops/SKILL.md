---
name: nodefony-devops
metadata:
  version: 1.1.0
description: >
  Exploite CETTE application Nodefony en conteneur : image, compose, frontal (nginx, HAProxy, h2c,
  Ingress), secrets, variables, Kubernetes, Podman, nombre de pods. N'enseigne pas Docker — il
  énonce le CONTRAT d'exploitation, chiffré : sondes, durée du drain, code de sortie, identifiant,
  dossiers écrits, ce qui casse quand une variable manque. À charger AVANT d'écrire un manifeste,
  un compose, une configuration de frontal, de dimensionner les pods, ou de diagnostiquer un
  conteneur qui redémarre.
  Déclencheurs : "déployer mon application en production", "mettre mon app en production",
  "docker compose", "derrière nginx", "derrière HAProxy", "Ingress", "h2c",
  "ma WebSocket se coupe derrière le proxy", "SSE derrière un proxy", "combien de pods ?", "dimensionner un pod",
  "plusieurs pods en temps réel", "Kubernetes", "mon pod redémarre", "mon pod perd des requêtes",
  "arrêt gracieux", "politique Restricted", "secrets", "variables d'environnement", "Podman".
---

# nodefony-devops — exploiter cette application

> **Maintenance** : vérité courante, jamais un journal. Éditer en place.

Tu sais faire du Docker. Ce que tu ne sais pas encore, c'est ce que **cette** application garantit
— et ce qu'elle attend de toi. C'est tout ce que porte cette page.

## 1. Le contrat d'exploitation

Ce que l'application tient, sans que tu aies rien à coder. Chiffré, parce qu'un ordonnanceur se
règle avec des nombres.

| Ce que tu veux                    | Ce qu'elle fait                                                                                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Savoir si le process vit**      | `GET /livez` → `200`. Reste à `200` **pendant tout l'arrêt** : un exemplaire qui draine est vivant, le tuer ferait exactement ce qu'on veut éviter.                         |
| **Savoir s'il peut servir**       | `GET /readyz` → `503` avant d'être prêt, `200` ensuite, et `503` **dès la première milliseconde du SIGTERM**. C'est lui qui te retire du répartiteur.                       |
| **Ne pas être cru mort à tort**   | Les deux sondes **court-circuitent le pipeline avant la limitation de débit**. Un agent d'ordonnancement limité recevrait `429`, qu'il lirait comme un échec de sonde.      |
| **Un arrêt propre**               | `SIGTERM` → refus des nouvelles requêtes, on laisse finir celles en vol, borné à **15 s**. Sous les 30 s qu'un kubelet accorde par défaut.                                  |
| **Laisser le répartiteur suivre** | Un délai configurable **avant** le début du drain, le temps que ton frontal retire l'exemplaire de sa table.                                                                |
| **Vérifier que l'arrêt a marché** | Code de sortie **`0`**. Un **`137`** signifie qu'il a été tué : les requêtes en vol sont perdues, à chaque déploiement, **sans une ligne de journal**.                      |
| **Un utilisateur non root**       | `USER 1000:1000` — **numérique**, donc utilisable tel quel par un `runAsUser`. Un `USER nom` ne l'est pas, et certains ordonnanceurs le refusent.                           |
| **Des secrets montés**            | Les variables du catalogue acceptent le suffixe `_FILE` : `NF_CSRF_SECRET_FILE=/run/secrets/csrf` lit le contenu du fichier. **Sauf** `NF_DATABASE_URL` et `NF_REDIS_URL`.  |
| **Identifier l'exemplaire**       | `NF_POD_NAME` — à alimenter depuis `metadata.name`. Elle dérive l'identité d'origine du bus temps réel ; sans elle, plusieurs exemplaires se confondent.                    |
| **Un port**                       | `5151`, déclaré par `EXPOSE`. Au-dessus de 1024, donc aucune capacité privilégiée n'est requise.                                                                            |
| **HTTP/2 vers un frontal**        | En option, un port **h2c** (HTTP/2 en clair, `5153`) : `NF__APP__SERVERS__H2C__ENABLED=true`. Ni sondes ni WebSocket dessus — elles restent sur `5151`.                     |
| **Des WebSocket qui survivent**   | Un battement de cœur ping/pong réclame les sockets mortes ; à l'arrêt, chaque client reçoit `1001` et se reconnecte ailleurs. Le frontal doit tolérer ≥ 300 s d'inactivité. |
| **Un contrôle de santé natif**    | `HEALTHCHECK` sur `/readyz`, déjà dans l'image.                                                                                                                             |

**Où l'application écrit — la question qui décide de tout le reste.** Deux dossiers, et deux
seulement : **`tmp/`** et **`var/`**. Tout le reste du système de fichiers peut être scellé.

> 🔴 **Ces deux dossiers ne sont pas ancrés de la même façon.** `tmp/` est résolu depuis le
> **répertoire courant du process**, `var/` depuis la **racine de l'application**. Dans l'image
> livrée les deux coïncident (`WORKDIR /app`). Dès qu'une commande personnalisée change de
> dossier, ils divergent — et l'application écrit ailleurs que là où tu as monté ton volume,
> **sans aucune erreur**. Si tu changes le répertoire de travail, vérifie les deux.

## 2. Ce qui est déjà dans ton dépôt

Le générateur a rendu ces fichiers **à ton nom**. Ils ne se recopient pas d'un guide : ils
s'ajustent.

| Fichier                    | Ce qu'il porte                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `Dockerfile`               | Image de production multi-étages → [`references/image.md`](references/image.md)       |
| `.dockerignore`            | Ce qui n'entre jamais dans l'image → [`references/secrets.md`](references/secrets.md) |
| `compose.yaml`             | Services par profils → [`references/compose.md`](references/compose.md)               |
| `.env`                     | Les variables → [`references/variables.md`](references/variables.md)                  |
| `deploy/migrate-job.yaml`  | Le travail Kubernetes des migrations — mode d'emploi en tête du fichier               |
| `.github/workflows/ci.yml` | La chaîne d'intégration                                                               |
| `.gitlab-ci.yml`           | La même, pour GitLab                                                                  |

Un fichier absent signifie un preset plus léger à la création. **Le régénérer, pas le réécrire.**

## 3. Ce que tu dois poser en face

Ce que l'application ne peut pas deviner. Chacun de ces oublis produit une dégradation
**silencieuse** — pas une erreur, pas une alerte.

- **`NF__HTTP__TRUSTPROXY`** dès qu'un frontal termine le TLS. Sans lui, l'application constate un
  schéma `http` : **toute connexion par mot de passe répond `403`** (le secret est reçu « en
  clair »), le cookie de session perd son préfixe `__Host-`, et l'adresse cliente devient celle du
  frontal — donc une vague de reconnexions WebSocket épuise **un seul** quota. Sans le moindre
  message. Détail et preuve → [`references/frontal.md`](references/frontal.md).
- **Une inactivité de frontal ≥ 300 s.** Plus courte que le battement, elle coupe des WebSocket et
  des flux SSE **vivants**. `proxy:generate` la dérive ; un contrôleur d'entrée Kubernetes, non.
- **Un bus temps réel partagé dès deux exemplaires** : `NF_REALTIME_DRIVER=redis`. Sans lui, un
  message n'atteint que les clients du pod qui l'émet → [`references/dimensionnement.md`](references/dimensionnement.md).
- **Les URL de base et de cache en variable, jamais en `_FILE`** : `NF_DATABASE_URL_FILE` est
  ignoré, et l'application démarre sur SQLite → [`references/variables.md`](references/variables.md).
- **Deux volumes inscriptibles**, sur `/app/tmp` et `/app/var`, si tu scelles la racine.
- **Une fenêtre d'arrêt ≥ 30 s**, strictement supérieure au drain de 15 s.
- **Pas de limite processeur.** Une limite mémoire tue proprement et l'exemplaire redémarre ; une
  limite processeur, elle, ne tue pas : elle ralentit, en permanence, et ça ne ressemble pas à une
  limite mais à une application lente.
- **Une base administrée, jamais dans le cluster** — et le plafond de connexions qui va avec (§6).

## 4. Mise en production — la checklist

Chaque ligne a la commande qui la **prouve**. Une case cochée sans commande est une supposition.

| #   | Le point                                                  | La preuve                                                                                               |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | L'image se construit                                      | `docker build -t <app> .`                                                                               |
| 2   | Elle n'embarque **aucun secret**                          | `npx nodefony image:check <app>` — lit les **couches**, pas l'image aplatie (§5)                        |
| 3   | Elle démarre et se déclare prête                          | `docker run -d --name t <app>` puis `curl -fsS localhost:5151/readyz`                                   |
| 4   | Elle s'arrête **proprement**                              | `docker stop t; docker inspect t --format '{{.State.ExitCode}}'` → doit rendre **`0`**                  |
| 5   | Les variables requises sont posées                        | `npx nodefony doctor --env production`                                                                  |
| 6   | Les secrets sont **montés**, pas dans l'environnement     | Suffixe `_FILE` → [`references/secrets.md`](references/secrets.md)                                      |
| 7   | Les migrations passent **avant** les nouveaux exemplaires | `kubectl apply -f deploy/migrate-job.yaml`, attendre la fin                                             |
| 8   | Le frontal est **dérivé**, pas écrit à la main            | `npx nodefony proxy:generate nginx`                                                                     |
| 9   | Le schéma constaté derrière le frontal est le bon         | Une requête réelle pose un cookie `__Host-` → [`references/frontal.md`](references/frontal.md)          |
| 10  | Un redéploiement ne perd **aucune** requête               | Charge constante pendant un `rollout restart` ; zéro `5xx`                                              |
| 11  | Une WebSocket **traverse** le frontal et y survit         | Ouverte à travers lui, muette plus d'une minute : toujours ouverte                                      |
| 12  | Le nombre de pods et leur mémoire sont **calculés**       | Débit mesuré sur **ton** application → [`references/dimensionnement.md`](references/dimensionnement.md) |
| 13  | La racine du conteneur est **scellée**                    | `--read-only` + volumes sur `/app/tmp` et `/app/var`                                                    |
| 14  | Tu sais ce que tu **ne** peux **pas** garantir            | Podman sans privilèges perd l'adresse du client (§7) — à énoncer, pas à masquer                         |

## 5. Symptôme → cause → correction

Le tableau qu'on lit en urgence.

| Symptôme                                                        | Cause                                                                                                                                             | Correction                                                                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L'exemplaire redémarre en boucle, journaux muets                | La sonde de vivacité tombe avant la fin du démarrage                                                                                              | Sonde de démarrage sur `/readyz`, dimensionnée sur le **pire** cas                                                                                                        |
| Le conteneur sort en **137** à l'arrêt                          | Il a été tué : la fenêtre d'arrêt est ≤ au drain                                                                                                  | Fenêtre ≥ 30 s (Podman : `--stop-timeout 20`, son défaut est **10 s**)                                                                                                    |
| Des `5xx` **pendant** chaque déploiement                        | Le répartiteur envoie encore du trafic quand le drain a commencé                                                                                  | Un délai avant drain, et un court arrêt avant terminaison                                                                                                                 |
| Le cookie de session n'a pas le préfixe `__Host-` en production | Schéma constaté `http` derrière le frontal                                                                                                        | `NF__HTTP__TRUSTPROXY`                                                                                                                                                    |
| La WebSocket se ferme seule au bout d'une minute                | L'inactivité du frontal est plus courte que le battement                                                                                          | Régénérer le frontal ; sur un contrôleur d'entrée, `proxy-read-timeout` ≥ 300 s → [`references/frontal.md`](references/frontal.md)                                        |
| Un message temps réel n'arrive qu'à une partie des clients      | Plusieurs exemplaires, bus local : chaque pod ne diffuse qu'à ses propres clients                                                                 | `NF_REALTIME_DRIVER=redis` + `NF_REDIS_URL` → [`references/dimensionnement.md`](references/dimensionnement.md)                                                            |
| Depuis l'activation de h2c, le pod n'est jamais prêt            | La sonde vise le port h2c (5153), qui refuse HTTP/1.1                                                                                             | Sonder le port HTTP (5151)                                                                                                                                                |
| Depuis l'activation de h2c, les WebSocket ne s'ouvrent plus     | Le frontal les envoie au port h2c                                                                                                                 | Router `Upgrade: websocket` vers le port HTTP → [`references/frontal.md`](references/frontal.md) §8                                                                       |
| `DB_SQLITE_FALLBACK` en production alors que la base est posée  | L'URL est passée en `NF_DATABASE_URL_FILE`, que la résolution de l'infrastructure ignore                                                          | `NF_DATABASE_URL` en variable, depuis un Secret (`secretKeyRef`)                                                                                                          |
| Le pod est tué (`OOMKilled`) avec peu de connexions             | La contre-pression : des clients lents retiennent jusqu'à 4 Mio chacun                                                                            | Baisser `maxBackpressure` sur `websocket` **et** `websocketSecure` → [`references/dimensionnement.md`](references/dimensionnement.md)                                     |
| Toutes les connexions répondent `403` « doit passer par HTTPS » | Même cause : le mot de passe arrive sur une requête que l'application croit en clair                                                              | `NF__HTTP__TRUSTPROXY` — jamais `allowInsecureCredentials`                                                                                                                |
| Sortie **78** au démarrage, une clé ou une variable nommée      | Faute de configuration : clé inconnue (ou retirée par une mise à jour), valeur invalide, secret requis absent (`NF_CSRF_SECRET`, `NF_JWT_KEYSET`) | Lire la ligne qui la nomme ; `npx nodefony doctor --env production` annonce AVANT les variables requises (pas `NF_JWT_KEYSET`, exigée seulement si l'app émet des jetons) |
| Les journaux d'audit montrent tous la **même adresse**          | L'adresse du client n'est pas propagée, ou le frontal n'est pas de confiance                                                                      | `trustProxy` ; en Podman sans privilèges, **c'est irréparable** (§7)                                                                                                      |
| `EACCES` au premier démarrage sur un volume                     | Le volume est né `root:root` : monté **par-dessus** un dossier dont l'image avait fixé le porteur                                                 | Volume nommé (il hérite du porteur) ou groupe de système de fichiers                                                                                                      |
| La base refuse des connexions dès qu'on monte en exemplaires    | Une base administrée les compte ; le pool n'est pas borné                                                                                         | Réduire les exemplaires — le plafond n'est pas encore réglable (§6)                                                                                                       |
| La sonde répond `429`                                           | Ce n'est **pas** la sonde : c'est la limitation de débit — donc l'appel n'a pas pris le raccourci                                                 | Interroger `/livez` et `/readyz` nus, sans en-tête ni préfixe ajouté                                                                                                      |
| Un secret retiré du `Dockerfile` reste dans l'image             | Une couche antérieure le contient encore ; l'effacer plus loin ne l'enlève pas                                                                    | `npx nodefony image:check`, et reconstruire sans jamais l'avoir copié                                                                                                     |
| La variable posée « ne fait rien »                              | Le nom est faux d'un caractère — une variable inconnue est **ignorée**, pas refusée                                                               | `npx nodefony doctor` → [`references/variables.md`](references/variables.md)                                                                                              |

## 6. Kubernetes — ce qui est rendu, et ce qui te reste

🔴 **Un seul manifeste est rendu à ton nom : `deploy/migrate-job.yaml`.** Le Deployment, le
Service et l'Ingress ne le sont pas — tu les écris, et les §1 et §3 te disent quoi y mettre.

```bash
kubectl apply -f deploy/migrate-job.yaml    # les migrations AVANT les exemplaires
```

**Le manifeste rendu passe la politique Restricted.** Recopie-en le contexte de sécurité dans ton
Deployment — sauf son `readOnlyRootFilesystem: false`, juste pour un travail éphémère, pas pour un
exemplaire qui sert du trafic.

Aucun de ces champs n'est « fourni par l'image » : ce sont des champs de **manifeste**, c'est toi
qui les poses. Ce que l'image apporte, c'est de les rendre satisfaisables :

| Le champ                              | Exigé par Restricted ?     | Ce qu'il te coûte                                                                                          |
| ------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `runAsNonRoot: true`                  | **oui**                    | rien                                                                                                       |
| `runAsUser` / `runAsGroup` numériques | non nul **s'il est posé**  | rien — l'image déclare `USER 1000:1000`, tu reportes `1000`                                                |
| `allowPrivilegeEscalation: false`     | **oui**                    | rien                                                                                                       |
| `capabilities.drop: ["ALL"]`          | **oui**                    | rien — l'application n'écoute qu'au-dessus de 1024                                                         |
| `seccompProfile: RuntimeDefault`      | **oui**                    | rien — mais la politique traite l'**absence** de profil comme une violation, pas comme un défaut permissif |
| `readOnlyRootFilesystem: true`        | non — durcissement en plus | **les deux volumes du §3** — sans eux le conteneur ne démarre pas                                          |

**Sondes sur le port HTTP (5151)**, même avec h2c actif. Combien d'exemplaires, quelle mémoire, et
le bus partagé dès qu'il y en a deux → [`references/dimensionnement.md`](references/dimensionnement.md).
L'Ingress (ingress-nginx est retiré depuis mars 2026), la Gateway API et leurs délais →
[`references/frontal.md`](references/frontal.md) §10.

**La base de données n'est pas dans le cluster**, et ça a trois conséquences dures →
[`references/kubernetes.md`](references/kubernetes.md).

Éprouver ton manifeste sans rien laisser derrière :

```bash
kind create cluster --name <app>
kubectl label ns default pod-security.kubernetes.io/enforce=restricted   # rend la politique OPPOSABLE
kubectl apply -f <ton-deployment>.yaml
kind delete cluster --name <app>
```

Sans ce label, un manifeste non conforme passe — et on croit avoir prouvé quelque chose.

## 7. Podman

Six écarts avec Docker, dont un qu'on ne répare pas →
[`references/podman.md`](references/podman.md). Le plus coûteux, parce qu'il est **muet** : en
mode sans privilèges, l'adresse source du client est perdue. Derrière un frontal, l'audit et toute
limitation par adresse deviennent faux **sans erreur**. Ça s'énonce, ça ne se masque pas.

`podman kube play` joue tes manifestes **sans cluster** — utile, mais il ne rejoue ni l'admission
de la politique, ni l'Ingress, ni un déploiement progressif. Ce qu'il ne prouve pas doit être dit.

## 8. Les références

| Fichier                                                          | Quand l'ouvrir                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`references/image.md`](references/image.md)                     | Modifier le `Dockerfile` : étages, arguments, bases candidates, ce qui ne se touche pas    |
| [`references/compose.md`](references/compose.md)                 | Services, profils, volumes, réseaux, le profil de topologie de production                  |
| [`references/variables.md`](references/variables.md)             | Le catalogue, la grammaire des noms, `_FILE`, **ce qui casse si absent**                   |
| [`references/secrets.md`](references/secrets.md)                 | Mots de passe, rotation, couches d'image, ce qui n'entre jamais                            |
| [`references/frontal.md`](references/frontal.md)                 | nginx et HAProxy dérivés, `trustProxy`, SSE, **h2c**, Envoy, Traefik, Ingress, Gateway API |
| [`references/kubernetes.md`](references/kubernetes.md)           | Ton Deployment, Restricted, sondes, arrêt, la base administrée                             |
| [`references/dimensionnement.md`](references/dimensionnement.md) | Combien de pods, quelle mémoire, WebSocket et SSE, plusieurs exemplaires                   |
| [`references/podman.md`](references/podman.md)                   | Les six écarts, et celui qui ne se répare pas                                              |

## 9. Passer la main

| Le besoin                          | Le skill                  |
| ---------------------------------- | ------------------------- |
| Coder dans l'application           | `nodefony-dev`            |
| Faire évoluer le schéma de la base | `nodefony-migrate-schema` |
| Regarder ou mesurer un écran       | `nodefony-browser`        |
| Ajouter une entité et son CRUD     | `nodefony-add-crud`       |

## 10. Deux règles qui valent pour tout le reste

- **« Ça construit » ne prouve rien.** Une image qui se construit peut refuser de démarrer, perdre
  ses requêtes à l'arrêt, ou embarquer une clé. Seule une **exécution** prouve — d'où le §4.
- **Une variable absente ne lève presque jamais** : elle bascule sur un défaut, et le défaut est
  souvent raisonnable. C'est ce qui rend l'erreur invisible jusqu'en production. Vérifie ce que
  l'application a **réellement lu**, pas ce que ton manifeste déclare.
