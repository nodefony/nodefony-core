---
name: nodefony-devops
metadata:
  version: 1.0.0
description: >
  Déploie et exploite CETTE application Nodefony : construire et vérifier son image, la mettre
  derrière un frontal, la porter sur Kubernetes, la jouer sous Podman, lire sa chaîne
  d'intégration. Son apport : la liste de ce que l'application FOURNIT DÉJÀ — sondes, arrêt
  gracieux, identité de pod, secrets montés, utilisateur non root — pour qu'aucun manifeste ne
  réécrive ce qui existe, et celle de ce que l'orchestrateur doit poser en face, faute de quoi
  l'application se dégrade SANS erreur. À charger AVANT d'écrire un manifeste, un compose ou une
  étape de déploiement. Déclencheurs : "déployer mon application en production", "mettre mon app
  en production", "construire et vérifier l'image", "docker compose", "derrière nginx",
  "Kubernetes", "manifeste k8s", "Deployment", "Ingress", "mon pod redémarre", "mon pod perd des
  requêtes", "redéploiement sans coupure", "arrêt gracieux", "readOnlyRootFilesystem", "politique
  Restricted", "secrets Kubernetes", "Podman", "podman kube play", "la CI de mon app", "GitLab CI".
---

# nodefony-devops — déployer cette application

> **Maintenance** : vérité courante, jamais un journal. Éditer en place.

## 1. D'abord : ce qui est DÉJÀ dans ton dépôt

Le générateur a rendu ces fichiers **à ton nom**. Ils ne se recopient pas d'une documentation et
ils ne se réécrivent pas — ils s'ajustent.

| Fichier                    | Ce qu'il porte                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`               | Image de production multi-étages, utilisateur non root **numérique** (`USER 1000:1000`), `WORKDIR /app`, `EXPOSE 5151`, `HEALTHCHECK` sur `/readyz` |
| `.dockerignore`            | Ce qui n'entre jamais dans l'image — **la matière cryptographique en fait partie**                                                                  |
| `compose.yaml`             | L'application et ses services, par profils (base de données, cache, outils, frontal)                                                                |
| `deploy/migrate-job.yaml`  | Le travail Kubernetes qui joue les migrations, avec un compte de schéma séparé — son mode d'emploi est en tête du fichier                           |
| `.github/workflows/ci.yml` | La chaîne d'intégration                                                                                                                             |
| `.gitlab-ci.yml`           | La même, pour GitLab                                                                                                                                |

> Si un fichier de cette liste manque, c'est que l'application a été créée avec un preset plus
> léger. Ne pas l'écrire à la main : le régénérer.

## 2. Ce que l'application FOURNIT à un orchestrateur

C'est la section qui évite le plus de travail inutile. Rien de ce qui suit n'est à coder.

| Capacité                               | Comment s'en servir                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sonde de vivacité** `/livez`         | Reste à `200` **même pendant l'arrêt** — c'est voulu : un pod qui draine est vivant, il ne doit pas être tué                                                  |
| **Sonde de mise en service** `/readyz` | `503` tant que l'application n'est pas prête, et `503` **dès le début de l'arrêt** — c'est ce qui retire le pod du répartiteur                                |
| Les deux court-circuitent le pipeline  | Elles répondent **avant** la limitation de débit : un kubelet limité en `429` croirait le pod mort                                                            |
| **Arrêt gracieux**                     | `SIGTERM` → drain, borné à **15 s** par défaut — sous les 30 s qu'accorde le kubelet                                                                          |
| **Délai avant drain**                  | Réglable, pour laisser le répartiteur retirer le pod avant qu'il refuse                                                                                       |
| **Identité du pod**                    | `NF_POD_NAME`, à poser depuis `metadata.name`                                                                                                                 |
| **Secrets montés en fichier**          | Toute variable accepte le suffixe `_FILE` : `NF_CSRF_SECRET_FILE=/run/secrets/csrf` lit le contenu du fichier. Vrai pour les secrets Docker **et** Kubernetes |

Une sonde de démarrage dédiée n'est pas nécessaire : `/readyz` en fait office. La dimensionner sur
le **pire** temps de démarrage, pas sur le meilleur.

## 3. Ce que l'orchestrateur doit poser EN FACE

Ce que l'application ne peut pas deviner. Chacun de ces points, oublié, produit une dégradation
**silencieuse** — pas une erreur.

- **`NF__HTTP__TRUSTPROXY`** dès qu'un frontal ou un Ingress termine le TLS. Sans lui,
  l'application constate un schéma `http` et **un cookie `__Host-` ne part pas** : la session ne
  tient plus, sans le moindre message. Le vérifier en le retirant : ce qui marchait doit tomber.
- **Deux volumes inscriptibles**, sur `/app/tmp` et `/app/var`, si le système de fichiers est en
  lecture seule. Ce sont les deux seuls endroits où l'application écrit.
- **Une seule réplique si la base est SQLite**, avec une stratégie `Recreate`. Un déploiement
  progressif sur un volume monté par un seul nœud attend un disque que l'exemplaire précédent
  tient encore : il reste en attente **pour toujours**, sans nommer la cause.
- **Une fenêtre d'arrêt d'au moins 30 s**, supérieure au drain de 15 s.
- **Pas de limite processeur.** Une limite mémoire, oui — elle tue proprement et le pod
  redémarre ; une limite processeur, elle, se paie en ralentissement permanent.

## 4. L'image

```bash
docker build -t <app> .                 # le Dockerfile est déjà là
npx nodefony image:check <app>          # refuse une image qui embarque ce qu'elle ne doit pas
```

`image:check` lit les **couches**, pas l'image aplatie : un fichier copié puis effacé dans une
couche ultérieure reste présent dans l'archive, et c'est précisément le cas le plus fautif.

Un arrêt de conteneur qui se solde par le code **137** signifie qu'il a été **tué** — donc que les
requêtes en vol ont été perdues. Le seul verdict acceptable est **0**.

## 5. Derrière un frontal

```bash
npx nodefony proxy:generate nginx -o docker/edge/default.conf
npx nodefony proxy:generate haproxy
```

La configuration est **dérivée de l'application** — ses hôtes de confiance, ses fichiers statiques
réels, sa taille de corps maximale, son battement de cœur temps réel. Elle ne s'écrit pas à la
main : une configuration écrite à la main se périme au premier montage statique ajouté.

## 6. Kubernetes

La politique **Restricted** est la cible d'un cluster sérieux. Elle exige six choses ; cinq sont
immédiates parce que l'image est déjà conforme (`runAsNonRoot`, `runAsUser` numérique,
`allowPrivilegeEscalation: false`, `capabilities.drop: ["ALL"]`, `seccompProfile: RuntimeDefault`).

La sixième — **`readOnlyRootFilesystem: true`** — demande les deux volumes du §3. Sans eux, le
conteneur ne démarre pas.

Éprouver les manifestes sans rien laisser derrière :

```bash
kind create cluster --name <app>
kubectl label ns default pod-security.kubernetes.io/enforce=restricted
kubectl apply -f deploy/
kubectl rollout status deploy/<app>
kind delete cluster --name <app>
```

Le label est ce qui rend la politique **opposable** : sans lui, un manifeste non conforme passe et
l'on croit avoir prouvé quelque chose.

## 7. Podman — ce qui change

| Ce qui casse                                                  | Le remède                                                                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Le `HEALTHCHECK` disparaît en format OCI                      | `podman build --format docker`                                                                                 |
| `podman stop` coupe à **10 s**, sous le drain                 | `--stop-timeout 20`, ou `stop_grace_period: 20s`                                                               |
| Un montage lié n'est pas inscriptible en mode sans privilèges | Volume **nommé**, ou suffixe `:U`                                                                              |
| `--userns=keep-id` nu **écrase le `USER` de l'image**         | `--userns=keep-id:uid=1000,gid=1000`                                                                           |
| SELinux refuse les montages liés                              | Suffixe `:z`                                                                                                   |
| **L'adresse du client est perdue** en mode sans privilèges    | Rien à masquer : derrière un frontal, l'audit et la limitation par IP sont faux. Le **dire**, ne pas le cacher |

`podman kube play deploy/` joue les manifestes **sans cluster**. Utile comme preuve locale — mais
il ne rejoue ni l'admission de la politique, ni l'Ingress, ni un déploiement progressif.

## 8. Pièges

- **Un manifeste recopié depuis une documentation perd son contexte de sécurité.** Ce que le
  générateur rend est à ton nom ; ce qu'une page montre est un exemple.
- **« Ça construit » ne prouve rien.** Une image qui se construit peut refuser de démarrer, perdre
  ses requêtes à l'arrêt, ou embarquer une clé. Seule une exécution prouve.
- **Une variable absente ne lève presque jamais** : elle fait basculer sur un défaut. Vérifier ce
  que l'application a **réellement** lu, pas ce que le manifeste déclare.
