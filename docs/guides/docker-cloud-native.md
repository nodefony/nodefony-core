---
title: "Booter Nodefony en Docker / Kubernetes (cloud-native)"
navTitle: Docker & cloud-native
lang: fr
module: global
topic: cloud-native-guide
audience: humain
tags: [docker, kubernetes, cloud-native, production, signaux, probes, cluster]
version: "doc"
status: stable
updated: 2026-09-01
source: "docs/guides/docker-cloud-native.md"
related: project_pm2_deprecation, project_cloud_native_plan
---

# Booter Nodefony en Docker / Kubernetes

📍 [Documentation](../index.md) › [Guides](README.md) › **Docker & cloud-native**

## Le modèle — un process au premier plan, et l'orchestrateur au-dessus

Un conteneur n'est pas une machine : c'est **un process**, et l'orchestrateur ne connaît que
celui-là. Tout le reste — redémarrage, arrêt, sondes de vie, montée en charge — se décide sur ce
process unique. D'où le principe qui gouverne toute cette page : Nodefony démarre **au premier
plan**, reçoit les signaux directement, et ne se met jamais en arrière-plan.

C'est aussi pourquoi la mise à l'échelle ne se fait pas dans le conteneur mais **au-dessus** : un
process par pod, et l'orchestrateur en lance autant qu'il faut.

## Règle d'or : au premier plan, jamais détaché

En Docker et Kubernetes, le process Node démarre **au premier plan**. **Jamais** en
arrière-plan (`&`), jamais de mise en démon (PM2 a été retiré du framework).

**Pourquoi** : l'orchestrateur (Docker, k8s, systemd) pilote le cycle de vie du container
**via ce process foreground** :

- s'il sort → le container est considéré comme terminé (restart policy / pod restart) ;
- détacher ferait croire au container qu'il a fini → il s'arrête aussitôt ;
- les signaux (`SIGTERM` au `docker stop` / arrêt de pod) doivent atteindre **directement**
  le process Node pour un arrêt propre.

`nodefony production` est **déjà** foreground : le Kernel boote, les serveurs HTTP/WS
écoutent (ce sont leurs handles qui gardent le process vivant), aucune daemonisation.

### Ce que ça donne, mesuré

`nodefony production --workers 1` démarre au premier plan, serveurs à l'écoute. Un `SIGTERM` —
c'est ce qu'envoient `docker stop` et l'arrêt d'un pod — déclenche l'arrêt gracieux : serveurs
HTTP et HTTPS fermés proprement, sortie en code 0, en quelques centaines de millisecondes. Aucun
`SIGKILL` n'est nécessaire.

Les quatre signaux d'arrêt sont attachés au même endroit (`Cli.ts:367`), et un **second** signal
pendant l'arrêt coupe court plutôt que d'attendre (`Cli.ts:348`) — c'est ce qui évite un pod
bloqué en fin de vie.

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
- **Serveur dédié multi-cœurs** : `nodefony cluster --workers N` (ou `NF_WORKERS`, qui tient
  compte des limites cgroup — `ProdCommand.ts:24`) = un superviseur et N ouvriers dans **le même
  conteneur**.

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
RUN npm run build          # rolldown : dist/ de tous les espaces de travail

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

Le framework expose **deux sondes, actives par défaut** — rien à écrire :

| Sonde         | Chemin    | Ce qu'elle répond                                                                                                                                            |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Vivacité      | `/livez`  | 200 tant que le process sert — **y compris pendant l'arrêt** : un pod qui vide ses connexions n'est pas un pod mort, le tuer couperait les requêtes en cours |
| Disponibilité | `/readyz` | 200 quand le pod peut recevoir du trafic, **503 dès le début de l'arrêt** — l'équilibreur le retire avant que la première connexion tombe                    |

Elles sont montées **avant la limitation de débit** (`http-kernel.ts:967`) : un kubelet qui sonde
toutes les secondes ne doit pas se faire limiter, puis déclarer le pod mort. Les chemins et
l'activation se règlent dans la configuration du module http (`config.ts`, `enabled` à `true` par
défaut).

```yaml
livenessProbe:
  { httpGet: { path: /livez, port: 5151 }, initialDelaySeconds: 10 }
readinessProbe: { httpGet: { path: /readyz, port: 5151 }, periodSeconds: 5 }
terminationGracePeriodSeconds: 30 # > durée du graceful shutdown (~mesurée < 1 s)
```

- `NF_BOOT_TIMEOUT_MS` (`reservedEnv.ts:98`) borne le temps de boot : si un module reste
  suspendu, le pod échoue vite au lieu de rester à moitié vivant.
- Le boot d'une application est dominé par l'import et l'instanciation de ses modules : un **pod
  réel** démarre nettement plus vite que l'application de démonstration du dépôt. Ajustez
  `initialDelaySeconds` en conséquence plutôt que de recopier une valeur.

## 📖 Lexique

| Terme                                    | Ce que c'est                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Premier plan** (_foreground_)          | Le process reste le process principal du conteneur. C'est lui que l'orchestrateur surveille et signale.              |
| **Arrêt gracieux**                       | Fermer les serveurs, laisser finir les requêtes en cours, puis sortir — au lieu d'être tué. Déclenché par `SIGTERM`. |
| **Sonde de vivacité** (_liveness_)       | Ce qui dit « ce pod est-il encore vivant ? ». S'il échoue, le pod est redémarré.                                     |
| **Sonde de disponibilité** (_readiness_) | Ce qui dit « ce pod peut-il recevoir du trafic ? ». S'il échoue, il est retiré du service sans être tué.             |
| **Forme exec**                           | `CMD ["a", "b"]` plutôt que `CMD a b` : sans shell intermédiaire, donc les signaux atteignent Node.                  |
| **Init**                                 | Un petit process parent (`--init`, `tini`) qui récolte les process orphelins et relaie les signaux.                  |

## ⚠️ Pièges

- **Un `&` ou un `CMD` en forme shell fait perdre les signaux.** Le process Node n'est alors plus
  le PID 1 : `docker stop` parle au shell, Node ne reçoit rien, et l'orchestrateur finit par tuer
  brutalement — au milieu des requêtes en cours.
- **Un `terminationGracePeriodSeconds` trop court annule l'arrêt gracieux.** Il doit dépasser la
  durée réelle de fermeture, sinon le `SIGKILL` arrive avant la fin et le bénéfice est perdu.
- **Ne pointez pas vos sondes sur une route applicative que vous écrivez vous-même** alors que
  `/livez` et `/readyz` existent : la vôtre ne saura pas répondre 503 pendant l'arrêt, et le pod
  continuera de recevoir du trafic qu'il ne peut plus servir. C'est exactement ce que `/readyz`
  fait, et qu'un `return 200` ne fait pas.
- **Écrire des journaux dans des fichiers, dans un conteneur, revient à les jeter.** Le système de
  fichiers est éphémère : la sortie standard est le seul chemin qui atteigne un collecteur.
- **Un démon qui n'a aucun handle actif sort tout seul.** `await new Promise(() => {})` ne retient
  pas Node : il faut un vrai handle — un consommateur, une socket, un minuteur.

## 🧪 Tests & couverture

Les chiffres exacts vivent dans la carte de l'aperçu, régénérée en comptant — jamais figés ici.

<!-- prettier-ignore -->
| Type | Où | Ce qui est prouvé |
| --- | --- | --- |
| Unitaires (signaux, CLI) | `nodefony` `Cli.test.ts` | les signaux attachés, le second signal qui coupe court, les codes de sortie |
| Unitaires (cluster) | `nodefony` `ClusterManager.test.ts`, `ClusterProbeAggregator.test.ts`, `ClusterRelay.test.ts` | la supervision des ouvriers, l'agrégation des sondes, le relais entre process |
| Intégration (CLI réelle) | `nodefony` `CliIntegration.test.ts`, `detachedStart.test.ts` | le démarrage effectif, et ce que le détachement change |

> Ce que ces tests ne couvrent **pas** : le comportement d'un orchestrateur réel. Le contrat
> « SIGTERM → arrêt propre » est vérifié sur le process ; ce que Kubernetes en fait dépend de vos
> `terminationGracePeriodSeconds` et de vos sondes.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Guides](README.md) · [Toute la documentation](../index.md)
- 🗄️ **Ce que devient la persistance quand il y a plusieurs pods** :
  [`persistence.md`](./persistence.md)
- 🗝️ **Les sessions en cluster** (pourquoi `memory` ne convient plus) :
  [`session-storage.md`](./session-storage.md)
- ⚙️ **Surcharger la configuration sans reconstruire l'image** :
  [`configuration.md`](./configuration.md)
- 🔄 **Ce qui se passe pendant le boot que vous bornez** :
  [cycle de boot du Kernel](../architecture/cycle-boot-kernel.md)
- 📖 [Lexique général](../lexique.md) du framework.
