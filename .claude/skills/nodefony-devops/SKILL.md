---
name: nodefony-devops
metadata:
  version: 1.0.0
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

| Capacité                       | Où elle vit                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sondes `/livez` et `/readyz`   | `@nodefony/http/nodefony/service/http-kernel.ts:972-980` — **court-circuit du pipeline AVANT le rate-limit** ; posées par `configureHealth()` (`:462`), câblées au boot (`:506-507`) |
| Drain à l'arrêt                | `src/nodefony/src/config/defaults.ts:46` — `shutdownDeadline: 15_000` (15 s, sous les 30 s du kubelet)                                                                               |
| Délai avant drain              | `@nodefony/http/nodefony/config/config.ts:969` — `shutdownDelay`, pour laisser le répartiteur retirer le pod                                                                         |
| Identité du pod                | `src/nodefony/src/config/reservedEnv.ts:82` — `NF_POD_NAME` (Downward API)                                                                                                           |
| Secrets montés en fichier      | `src/nodefony/src/config/defineEnv.ts:120` — suffixe `_FILE` sur **toute** variable du catalogue                                                                                     |
| Utilisateur non root numérique | `src/nodefony/templates/app/base/Dockerfile.tpl:319` — `USER 1000:1000` (`WORKDIR /app` `:257`, `EXPOSE 5151` `:320`)                                                                |

> 🔴 **`tmp/` et `var/` n'ont pas le même ancrage.** `Kernel.ts:1015` résout `tmp` sur
> **`process.cwd()`**, `Kernel.ts:1023` résout `var` sur **`this.path`**. Deux volumes montés sur
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

Variable de branchement : **`it.db`** (`src/nodefony/src/cli/scaffold/engine.ts:1504`, alimentée
`:1453-1456` par `resolveDatabase`, valeurs `:387-402`). Elle vaut **`null` pour sqlite** ; sinon
un objet `{choice, service, label, scheme, port, url, …}` pour postgres, mariadb ou mysql. C'est
donc `it.db` qui dit s'il y a une base **serveur** — et par là, en Kubernetes, s'il peut y avoir
plusieurs répliques.

Commande du produit qui inspecte une image : `src/nodefony/src/cli/image/` (`index.ts`,
`suspectFiles.ts`), éprouvée par `src/nodefony/src/tests/imageCheck.test.ts`.

Pages publiques associées : `docs/guides/docker-cloud-native.md`, `docs/guides/kubernetes.md`,
`docs/guides/reverse-proxy.md`, `docs/guides/persistence.md`,
`docs/guides/integration-continue.md`.

## 4. Le corpus de référence — `references/corpus/`

24 pages figées hors ligne, ~1,3 Mo : Docker (construction, multi-étages, sécurité du moteur,
compose, Node.js en conteneur), Kubernetes (**sondes**, **ressources**, **Pod Security
Standards**, **contexte de sécurité**, **cycle de vie d'un pod**), Podman et Buildah, distroless,
OCI. L'index complet, avec l'URL d'origine et la couverture de chaque page, vit dans
`references/corpus/INDEX.md`.

**S'en servir** : ouvrir la page, citer `fichier:ligne`. C'est ce corpus qui tranche les questions
où l'intuition se trompe — qu'une limite CPU se paie en throttling, qu'un `emptyDir` en mémoire
compte dans la limite du conteneur, que l'**absence** d'un profil seccomp est elle-même prohibée
par la politique Restricted, qu'une sonde de démarrage se dimensionne sur le pire cas.

> ⚠️ **La dérive de ce corpus n'est PAS contrôlée aujourd'hui, et il faut le savoir avant de
> citer.** `npm run refs:check` (`nodefony-rfc/scripts/check-amont.mjs`) ne balaye que le dossier
> `references/` de `nodefony-rfc`, et son manifeste `AMONT.json` n'accepte qu'**un seul** dépôt
> GitHub. Or 15 des 24 pages viennent de sites rendus en Markdown par un proxy (docs.docker.com,
> kubernetes.io, docs.podman.io) et les 9 autres de **cinq** dépôts distincts. Conséquence à
> assumer : une page du corpus peut avoir vieilli sans que rien ne le dise. Pour une affirmation
> qui engage — une politique de sécurité, un comportement d'orchestrateur — **relire l'amont**
> plutôt que de s'appuyer sur la copie seule.

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
