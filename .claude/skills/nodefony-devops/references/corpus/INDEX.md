# Docker Corpus — Référence hors ligne pour audit du Dockerfile généré

Date: 2026-09-10 | Taille totale: ~1.6 MB | Fichiers: 23

## Index des pages récupérées

| Fichier                          | Taille | URL d'origine                                                                                         | Couverture                                                               |
| -------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A-docker-build-best-practices.md | 28K    | https://docs.docker.com/build/building/best-practices/                                                | Pratiques de construction d'image: optimisation couches, cache, sécurité |
| A-compose-reference.md           | 17K    | github:docker/docs/_vendor/.../docker/compose/.../compose.md                                          | Référence Docker Compose v5                                              |
| A-docker-daemon-reference.md     | 58K    | github:docker/docs/_vendor/.../docker/cli/.../dockerd.md                                              | Référence daemon Docker, options runtime                                 |
| A-docker-multistage.md           | 103K   | https://docs.docker.com/build/building/multi-stage/                                                   | Builds multi-étages, optimisation légèreté image                         |
| A-docker-nodejs-ci-cd.md         | 191K   | https://docs.docker.com/guides/nodejs/configure-ci-cd/                                                | CI/CD Node.js, tests conteneurisés, registres                            |
| A-docker-nodejs-containerize.md  | 26K    | https://docs.docker.com/guides/nodejs/containerize/                                                   | Containeriser une app Node.js, Dockerfile template                       |
| A-docker-nodejs-deploy.md        | 26K    | https://docs.docker.com/guides/nodejs/deploy/                                                         | Déploiement Node.js, préparation production                              |
| A-docker-nodejs-develop.md       | 26K    | https://docs.docker.com/guides/nodejs/develop/                                                        | Développement local avec Docker, HMR/watch                               |
| A-docker-run-reference.md        | 55K    | github:docker/docs/_vendor/.../docker/cli/.../run.md                                                  | Référence `docker run`, options runtime                                  |
| A-docker-security-engine.md      | 110K   | https://docs.docker.com/engine/security/                                                              | Sécurité Docker: isolation, AppArmor, SELinux, user namespaces           |
| B-nodejs-best-practices.md       | 8.4K   | github:nodejs/docker-node/master/docs/BestPractices.md                                                | Pratiques Node.js en conteneur (versions, health checks)                 |
| B-nodejs-docker-node-readme.md   | 14K    | github:nodejs/docker-node/master/README.md                                                            | Images officielles Node.js: tags, variantes (alpine, slim)               |
| C-distroless-readme.md           | 11K    | github:GoogleContainerTools/distroless/main/README.md                                                 | Images minimales Google distroless pour production                       |
| D-k8s-pod-lifecycle.md           | 64K    | https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/                                     | Cycle de vie d'un pod: init, hooks, termination gracieuse                |
| D-k8s-pod-security-standards.md  | 135K   | https://kubernetes.io/docs/concepts/security/pod-security-standards/                                  | Standards de sécurité pod (restricted, baseline, etc.)                   |
| D-k8s-probes.md                  | 136K   | https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/ | Probes K8s: liveness, readiness, startup — détection failures            |
| D-k8s-resources.md               | 40K    | https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/                        | Gestion ressources K8s: requests, limits, QoS, eviction                  |
| D-k8s-security-context.md        | 35K    | https://kubernetes.io/docs/tasks/configure-pod-container/security-context/                            | SecurityContext pod: user, fsGroup, capabilities, SELinux                |
| E-buildah-readme.md              | 8.5K   | github:containers/buildah/main/README.md                                                              | Buildah: outil de construction image OCI, alternative Dockerfile         |
| E-podman-docs.md                 | 38K    | https://docs.podman.io/en/latest/markdown/podman.1.html                                               | Podman: docs principales, modes exécution                                |
| E-podman-run-docs.md             | 132K   | https://docs.podman.io/en/latest/markdown/podman-run.1.html                                           | Podman run: options runtime, pods, network, volumes                      |
| F-oci-annotations.md             | 5.9K   | github:opencontainers/image-spec/main/annotations.md                                                  | Annotations OCI pour métadonnées image                                   |
| F-oci-image-spec.md              | 4.1K   | github:opencontainers/image-spec/main/spec.md                                                         | Spécification OCI Image Format v1.1.0-rc3                                |

## Sommaire par source

### A. Docker (8 fichiers, ~620 KB)

Référence officielle Docker: Dockerfile, build, Node.js, sécurité.

### B. Node.js en conteneur (2 fichiers, ~22 KB)

Images officielles nodejs/docker-node et pratiques.

### C. Distroless (1 fichier, ~11 KB)

Images minimalistes Google pour production.

### D. Kubernetes (5 fichiers, ~410 KB)

Probes, ressources, sécurité pod, cycle de vie, termination.

### E. Podman & Buildah (3 fichiers, ~179 KB)

Alternative Docker: Podman, Buildah, modes d'exécution.

### F. OCI (2 fichiers, ~10 KB)

Spécification OCI: format image, annotations.

## Non récupérés

| URL                                                                                | Motif                                                             | Statut |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------ |
| https://raw.githubusercontent.com/docker/docs/main/content/reference/dockerfile.md | Chemin supprimé dans docker/docs (structure migrée vers _vendor/) | 404    |

## Notes

- **Proxy d'accès**: r.jina.ai utilisé pour convertir HTML → Markdown (docs.docker.com, docs.podman.io, kubernetes.io)
- **GitHub raw**: URLs raw.githubusercontent.com pour Markdown natif (docker-node, distroless, OCI)
- **Vendored docs**: Docker utilise structure _vendor/ pour bundler les docs de CLI/Compose/Buildx
- **Encodage**: UTF-8, pas de truncation
- **Mise en place**: 2026-09-10 pour audit générateur Dockerfile Nodefony
