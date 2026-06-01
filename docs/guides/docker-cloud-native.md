---
title: Booter Nodefony en Docker / Kubernetes (cloud-native)
audience: humain
date: 2026-06-01
related: project_pm2_deprecation, project_cloud_native_plan, docs/audits/boot-performance-2026-06-01.md
---

# Booter Nodefony en Docker / Kubernetes

## Règle d'or : FOREGROUND, jamais détaché

En Docker/k8s, le process Node démarre **au premier plan** (foreground). **Jamais** en
arrière-plan (`&`), jamais de daemonisation (pas de PM2 — retiré du framework).

**Pourquoi** : l'orchestrateur (Docker, k8s, systemd) pilote le cycle de vie du container
**via ce process foreground** :

- s'il sort → le container est considéré comme terminé (restart policy / pod restart) ;
- détacher ferait croire au container qu'il a fini → il s'arrête aussitôt ;
- les signaux (`SIGTERM` au `docker stop` / arrêt de pod) doivent atteindre **directement**
  le process Node pour un arrêt propre.

`nodefony production` est **déjà** foreground : le Kernel boote, les serveurs HTTP/WS
écoutent (ce sont leurs handles qui gardent le process vivant), aucune daemonisation.

### Vérifié (2026-06-01)

- `nodefony production --workers 1` démarre foreground, serveurs up.
- `SIGTERM` (= `docker stop` / arrêt de pod) → **graceful shutdown en ~364 ms, exit 0**,
  serveurs HTTP/HTTPS fermés proprement. Pas de SIGKILL nécessaire.

## Trois régimes de boot, trois objets Docker/k8s

| Mode                                       | Commande                            | Type    | Objet k8s                   | Garde le process vivant via                 |
| ------------------------------------------ | ----------------------------------- | ------- | --------------------------- | ------------------------------------------- |
| **Serveur**                                | `nodefony production`               | SERVER  | `Deployment` + `Service`    | handles des serveurs HTTP/WS                |
| **Batch one-shot**                         | `nodefony <module>:<cmd>` (CONSOLE) | CONSOLE | `Job` / `CronJob`           | — (exécute puis `exit 0`)                   |
| **Daemon** (worker queue, consumer, agent) | commande CONSOLE qui park           | CONSOLE | `Deployment` (sans Service) | un handle explicite (socket/consumer/timer) |

> ⚠️ **Daemon CONSOLE** : un `await new Promise(() => {})` ne suffit PAS à garder Node vivant
> (une Promise pending n'est pas un handle d'event loop — Node sort dès l'event loop vide).
> Un vrai daemon tient un handle actif (consumer Kafka/Redis, socket, timer). Vérifié en test.

## Topologie : 1 process = 1 pod (défaut) vs cluster

- **Petit pod k8s + HPA** (recommandé cloud-native) : `nodefony production` = **1 process Node
  par pod**. Le scaling horizontal est délégué à l'orchestrateur (k8s HPA, Cloud Run, Fargate).
- **VPS / bare-metal multi-cœurs** : `nodefony cluster --workers N` (ou `NODEFONY_WORKERS`,
  cgroup-aware) = master superviseur + N workers dans **le même container**.

## Logs

Vers **stdout/stderr** (collectés par Docker → driver de logs / collecteur centralisé). Ne pas
écrire dans des fichiers depuis le container (éphémère). Le Log Backplane (drivers `loki`/
`opensearch`) pousse vers un backend externe en prod.

## Dockerfile de référence (multi-stage)

```dockerfile
# ---- build ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build          # rollup : dist/ de tous les workspaces

# ---- runtime ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/package*.json ./
# 1 process = 1 container, FOREGROUND. SIGTERM → graceful shutdown.
# Forme exec (pas de shell) → le process Node reçoit directement les signaux.
EXPOSE 5151 5152
CMD ["npx", "nodefony", "production"]
# Cluster intra-container (VPS multi-cœurs) : CMD ["npx","nodefony","cluster","-w","4"]
```

Notes :

- **Forme exec** `CMD ["...", "..."]` (pas `CMD npx nodefony production`) → le process est PID
  direct et reçoit `SIGTERM` sans wrapper shell qui l'avalerait.
- Pour garantir la propagation des signaux et le reaping des zombies, utiliser un init léger
  si nécessaire : `docker run --init` ou `tini`.

## Kubernetes — probes & timeouts

⚠️ Le framework n'expose **pas** d'endpoint santé générique par défaut
(`/nodefony/studio/api/health` existe mais dépend de Studio, non garanti monté en prod).
**Exposez une route santé applicative** (un controller qui renvoie 200) et pointez les probes
dessus :

```yaml
livenessProbe:
  { httpGet: { path: /health, port: 5151 }, initialDelaySeconds: 10 }
readinessProbe: { httpGet: { path: /health, port: 5151 }, periodSeconds: 5 }
terminationGracePeriodSeconds: 30 # > durée du graceful shutdown (~mesurée < 1 s)
```

- `NODEFONY_BOOT_TIMEOUT_MS` borne le temps de boot (fail-fast si un module pend).
- Le boot de l'app est dominé par l'import/instanciation des modules (cf
  `docs/audits/boot-performance-2026-06-01.md`) : un **pod réel** (app minimale) boote
  nettement plus vite que l'app de dev de démo. Ajuster `initialDelaySeconds` en conséquence.

> **Reco framework** (backlog cloud-native) : exposer un endpoint santé standard dans le core
> HTTP — `/nodefony/health` (liveness) + `/nodefony/ready` (readiness, vrai après
> `onServersReady`) — pour éviter à chaque app de le réécrire. Cf `project_cloud_native_plan`.
