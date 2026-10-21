---
name: nodefony-devops
metadata:
  version: 1.1.0
description: >
  Porte le déploiement d'une application Nodefony côté FRAMEWORK : les gabarits qui rendent son
  image, son compose, sa topologie, ses manifestes Kubernetes et sa chaîne d'intégration. Donne la
  carte de ce que le générateur rend déjà, et embarque HORS LIGNE le corpus de référence (Docker,
  Kubernetes, Podman, OCI, distroless) sur lequel toute décision se tranche. À charger AVANT de
  toucher à un gabarit de déploiement ou d'affirmer ce qu'un orchestrateur fait : les réponses se
  lisent dans le corpus, elles ne se déduisent pas. Le skill livré aux applications vit dans le
  paquet devkit. Déclencheurs : "gabarit de déploiement", "Dockerfile généré", "manifeste
  Kubernetes du scaffold", "politique Restricted", "readOnlyRootFilesystem", "sondes liveness et
  readiness", "arrêt gracieux d'un pod", "Podman", "corpus docker", "corpus kubernetes",
  "la CI de l'application générée", "GitLab CI", "scanner l'image".
---

# nodefony-devops — déployer ce que le générateur produit

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`. Une leçon durable devient une règle d'une section, pas une entrée datée.

## 1. Quand m'utiliser — et quand passer la main

| Le besoin                                                      | Qui le porte              |
| -------------------------------------------------------------- | ------------------------- |
| Image, compose, topologie, Kubernetes, Podman, CI **de l'app** | **ici**                   |
| Publier les paquets npm **du framework**                       | `nodefony-release`        |
| Mesurer la charge, dimensionner un pod                         | `nodefony-load-test`      |
| Prouver le cross-pod sur un bus Redis partagé                  | `nodefony-multipod-bench` |
| Un symptôme runtime à diagnostiquer                            | `nodefony-debug`          |
| Éditer le code du cœur (pipeline, kernel, services)            | `nodefony-framework-dev`  |
| Écrire une page publique de documentation                      | `nodefony-documentation`  |

## 2. La règle qui gouverne tout le reste

**Ce que le framework offre déjà ne se réinvente pas dans un manifeste.** Le premier geste n'est
jamais d'écrire du YAML : c'est de regarder ce que l'image expose. La liste ci-dessous est ancrée
au code et se relit au moment où l'on s'en sert.

| Capacité                        | Où elle vit                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sondes `/livez` et `/readyz`    | `@nodefony/http/nodefony/service/http-kernel.ts#HttpKernel.dispatchHttpRequest` — **court-circuit du pipeline AVANT le rate-limit** ; posées par `configureHealth()` (`nodefony/http/nodefony/service/http-kernel.ts#HttpKernel.configureHealth`), câblées au boot (`nodefony/http/nodefony/service/http-kernel.ts#HttpKernel.init`) |
| Drain à l'arrêt                 | `src/nodefony/src/config/defaults.ts#defaultAppConfig` — `shutdownDeadline: 15_000` (15 s, sous les 30 s du kubelet)                                                                                                                                                                                                                 |
| Délai avant drain               | `@nodefony/http/nodefony/config/config.ts#healthSchema` — `shutdownDelay`, pour laisser le répartiteur retirer le pod                                                                                                                                                                                                                |
| Identité du pod                 | `src/nodefony/src/config/reservedEnv.ts#RESERVED_ENV` — `NF_POD_NAME` (Downward API)                                                                                                                                                                                                                                                 |
| Secrets montés en fichier       | `src/nodefony/src/config/defineEnv.ts#resolveFileEnv` — suffixe `_FILE` sur **toute** variable du catalogue                                                                                                                                                                                                                          |
| Utilisateur non root numérique  | `src/nodefony/templates/app/base/Dockerfile.tpl:319` — `USER 1000:1000` (`WORKDIR /app`, `EXPOSE 5151`)                                                                                                                                                                                                                              |
| Frontal dérivé (nginx, HAProxy) | `@nodefony/http/nodefony/src/proxy/generateProxyConfig.ts#generateNginxConfig` et `#generateHaproxyConfig`, commande `proxyGenerateCommand.ts#ProxyGenerate` — inactivité dérivée du battement WS (4 battements, plancher 300 s), `timeout tunnel`, corps max, `Forwarded` effacé, schéma constaté sur `ssl_fc`                      |
| HTTP/2 en clair vers un proxy   | `src/nodefony/src/config/schema.ts` (`servers.h2c`, port 5153, désactivé) ; HAProxy généré l'emprunte en `proto h2` quand il est actif, les WebSocket restent sur le port HTTP ; sondes sur le port HTTP seulement                                                                                                                   |
| Dimensionnement d'un pod        | constantes publiées `docs/performance/data/<version>.json` (`.capacity`, produites par `capacity.mjs --json` du skill `nodefony-load-test`) ; la méthode livrée aux apps vit dans `src/packages/@nodefony/devkit/skills/nodefony-devops/references/dimensionnement.md` — à recaler à chaque nouvelle mesure                          |

> 🔴 **`tmp/` et `var/` n'ont pas le même ancrage.** `Kernel.ts#Kernel.startBoot` résout `tmp` sur
> **`process.cwd()`**, `Kernel.ts#Kernel.startBoot` résout `var` sur **`this.path`**. Deux volumes montés sur
> `/app/tmp` et `/app/var` ne se rejoignent donc que si le répertoire courant EST la racine de
> l'application — vrai dans l'image, faux dès qu'un `command:` change de dossier, et **sans aucune
> erreur** : l'application écrira ailleurs, en silence.

## 3. Ce que le générateur rend — la carte

| Fichier rendu                                                | Preset     |
| ------------------------------------------------------------ | ---------- |
| `templates/app/base/Dockerfile.tpl`                          | `base`     |
| `templates/app/base/github/workflows/ci.yml.tpl`             | `base`     |
| `templates/app/base/gitlab-ci.yml.tpl`                       | `base`     |
| `templates/app/complete/compose.yaml.tpl`                    | `complete` |
| `templates/app/complete/github/workflows/production.yml.tpl` | `complete` |
| `templates/app/complete/deploy/migrate-job.yaml.tpl`         | `complete` |

Variable de branchement : **`it.db`** (`src/nodefony/src/cli/scaffold/engine.ts#listTargets`, alimentée
`src/nodefony/src/cli/scaffold/engine.ts#readRootManifest` par `resolveDatabase`, valeurs `src/nodefony/src/cli/scaffold/engine.ts#resolveDatabase`). Elle vaut **`null` pour sqlite** ; sinon
un objet `{choice, service, label, scheme, port, url, …}` pour postgres, mariadb ou mysql. C'est
donc `it.db` qui dit s'il y a une base **serveur** — et par là, en Kubernetes, s'il peut y avoir
plusieurs répliques.

Commande du produit qui inspecte une image : `src/nodefony/src/cli/image/` (`index.ts`,
`suspectFiles.ts`), éprouvée par `src/nodefony/src/tests/imageCheck.test.ts`.

Pages publiques associées : `docs/guides/docker-cloud-native.md`, `docs/guides/kubernetes.md`,
`docs/guides/reverse-proxy.md`, `docs/guides/persistence.md`,
`docs/guides/integration-continue.md`.

## 4. Le corpus de référence — `references/corpus/`

22 pages figées hors ligne, ~1,1 Mo : Docker (construction, multi-étages, sécurité du moteur,
compose, Node.js en conteneur), Kubernetes (**sondes**, **ressources**, **Pod Security
Standards**, **contexte de sécurité**, **cycle de vie d'un pod**), Podman et Buildah, distroless,
OCI. L'index complet, avec l'URL d'origine et la couverture de chaque page, vit dans
`references/corpus/INDEX.md`.

**S'en servir** : ouvrir la page, citer `fichier:ligne`. C'est ce corpus qui tranche les questions
où l'intuition se trompe — qu'une limite CPU se paie en throttling, qu'un `emptyDir` en mémoire
compte dans la limite du conteneur, que l'**absence** d'un profil seccomp est elle-même prohibée
par la politique Restricted, qu'une sonde de démarrage se dimensionne sur le pire cas.

**Avant de citer une page, savoir si elle a vieilli** : `npm run refs:check`. Chaque page nomme
dans `references/corpus/AMONT.json` le fichier de dépôt dont elle sort — y compris celles des sites
(docs.docker.com, kubernetes.io, docs.podman.io), rendus depuis `docker/docs`,
`kubernetes/website`, `containers/podman` —, le blob Git qu'elle reflète et l'empreinte de son
contenu. La commande nomme la page dont la source a changé (avec la date), et celle retouchée ici
sans être re-figée. Une page signalée se **relit à l'amont** avant d'être citée pour une
affirmation qui engage ; une fois remplacée et relue :
`node .claude/skills/nodefony-rfc/scripts/check-amont.mjs --pin <page>`. Les trois
`A-docker-nodejs-*` sont une seule page (le guide Node.js de Docker est d'un seul tenant), servie
sous trois URL.

## 5. Le décor local — ce qui est installé, et ce qui ne l'est pas

Une capacité se **constate**, elle ne se déduit pas de la plateforme :

```bash
for t in docker podman kubectl kind helm; do
  printf '%-8s ' "$t"; command -v "$t" >/dev/null 2>&1 && echo PRÉSENT || echo ABSENT
done
kubectl config current-context 2>/dev/null || echo "aucun cluster joignable"
```

Cluster jetable pour éprouver des manifestes, sans rien laisser derrière :

```bash
kind create cluster --name nodefony     # ~40 s, sur le Docker déjà présent
kubectl label ns default pod-security.kubernetes.io/enforce=restricted
kubectl apply -f deploy/
kind delete cluster --name nodefony
```

`podman kube play deploy/` joue les mêmes manifestes **sans cluster** — utile comme preuve locale,
mais il ne rejoue ni l'admission de la politique, ni l'Ingress, ni un `rollout`. Ce qu'il ne
prouve pas doit être dit, pas supposé prouvé.

## 6. Pièges constatés

- **Un manifeste écrit dans la documentation n'est pas un manifeste livré.** Un utilisateur qui
  recopie perd le contexte de sécurité et remplace des noms à la main. Ce que le générateur ne
  rend pas n'existe pas pour lui.
- **Derrière un frontal qui termine le TLS**, l'application reçoit du HTTP en clair et un en-tête
  `X-Forwarded-Proto`. Sans `trustProxy` posé, le schéma constaté est `http` et un cookie
  `__Host-` **tombe** — sans erreur. Le poser dans le manifeste, et le voir mordre en le retirant.
- **Une base sqlite impose une seule réplique ET une stratégie `Recreate`.** Un `RollingUpdate`
  sur un volume `ReadWriteOnce` attend un disque que l'ancien exemplaire tient encore : le
  déploiement reste `Pending` pour toujours, sans message qui nomme la cause.
- **`podman stop` coupe à 10 s**, sous le drain de 15 s du framework : les requêtes en vol sont
  perdues à chaque arrêt si le délai n'est pas relevé.
- **Un code de sortie 137 à l'arrêt d'un conteneur veut dire qu'il a été TUÉ**, donc que l'arrêt
  gracieux n'a pas eu lieu. Le seul verdict qui compte est **0**.

## 7. Gate

```bash
node .claude/skills/nodefony-skill/scripts/skills-doc.mjs --check   # conformité + fiche publique
```
