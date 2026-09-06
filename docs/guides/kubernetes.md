---
title: "Déployer Nodefony sur Kubernetes — les manifests"
navTitle: Kubernetes
lang: fr
module: global
topic: kubernetes-guide
audience: humain
tags:
  [
    kubernetes,
    manifests,
    deployment,
    ingress,
    secret,
    hpa,
    migrations,
    backplane,
    exploitation,
  ]
version: "doc"
status: stable
updated: 2026-09-06
source: "docs/guides/kubernetes.md"
---

# Déployer Nodefony sur Kubernetes

📍 [Documentation](../index.md) › [Guides](README.md) › **Kubernetes**

[docker-cloud-native](./docker-cloud-native.md) explique le **modèle** — un process au premier plan,
l'orchestrateur au-dessus — et livre le Dockerfile. Cette page donne les manifests, et surtout les
quatre choses qu'on ne devine pas : l'identité du pod, le cloisonnement du bus, le moment des
migrations, et le délai d'arrêt.

## 🧠 Le modèle mental — ce que le cluster doit fournir

Le framework ne suppose rien de son environnement, et il ne le découvre pas non plus : tout ce dont
il a besoin lui est **déclaré**, par des variables. Trois familles, trois traitements dans un
cluster.

| Famille                                    | Exemple                                           | Où ça vit                           |
| ------------------------------------------ | ------------------------------------------------- | ----------------------------------- |
| Ce qui est **secret**                      | `NF_DATABASE_URL`, `NF_REALTIME_BACKPLANE_SECRET` | un `Secret`, monté en variables     |
| Ce qui est **public mais par déploiement** | `NF_REALTIME_BACKPLANE_NAMESPACE`, `NODE_ENV`     | un `ConfigMap`                      |
| Ce que **le cluster seul connaît**         | `NF_POD_NAME` (`reservedEnv.ts:82`)               | un `fieldRef` — jamais écrit en dur |

## 📖 Lexique

- **Backplane** — le bus qui relaie les messages temps réel entre pods. Sans lui, un message publié
  par un pod n'atteint que les clients connectés **à ce pod**.
- **Readiness** — l'état « je peux recevoir du trafic ». Distinct de « je suis vivant » : un pod qui
  vide ses connexions est vivant et indisponible.
- **fieldRef** — la façon dont un conteneur lit une information de son propre pod (son nom, son
  espace de noms) sans que personne ait à l'écrire.

## Qu'est-ce que ça résout — quatre pièges que le YAML par défaut ne voit pas

1. **Tous les pods portent la même identité** si `NF_POD_NAME` n'est pas câblé : l'origine des
   messages du backplane devient indistinguable, et un pod peut se réémettre à lui-même.
2. **Deux applications partagent un Redis** et se parlent sans le savoir, faute d'espace de noms.
3. **Les migrations partent en même temps que les pods**, et N exemplaires appliquent le même
   schéma en concurrence.
4. **Le délai d'arrêt est plus court que le drain**, et le déploiement coupe des requêtes en vol.

## 🚀 Démarrage rapide — le Deployment

```yaml
# deployment.yaml — un process = un pod
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mon-app
spec:
  replicas: 3
  selector:
    matchLabels: { app: mon-app }
  template:
    metadata:
      labels: { app: mon-app }
    spec:
      # > la durée du drain. Le drain mesuré est bien inférieur à la seconde,
      # mais c'est la requête la plus LENTE qui décide, pas la moyenne.
      terminationGracePeriodSeconds: 30
      containers:
        - name: app
          image: registry.example.com/mon-app:10.0.0
          ports: [{ containerPort: 5151 }]
          env:
            - name: NODE_ENV
              value: production
            # 🔴 L'identité d'origine du backplane. Sans elle, tous les pods
            # se présentent pareil sur le bus.
            - name: NF_POD_NAME
              valueFrom:
                fieldRef: { fieldPath: metadata.name }
          envFrom:
            - configMapRef: { name: mon-app-config }
            - secretRef: { name: mon-app-secrets }
          livenessProbe:
            httpGet: { path: /livez, port: 5151 }
            initialDelaySeconds: 10
          readinessProbe:
            httpGet: { path: /readyz, port: 5151 }
            periodSeconds: 5
          resources:
            requests: { cpu: 250m, memory: 256Mi }
            limits: { memory: 512Mi }
```

**`/livez` et `/readyz` ne se remplacent pas l'un l'autre.** `/livez` reste à `200` pendant l'arrêt :
un pod qui vide ses connexions n'est pas un pod mort, et le redémarrer casserait exactement ce qu'on
protège. `/readyz` bascule en `503` **dès le début de l'arrêt**, ce qui retire le pod du service
avant que la première connexion ne tombe. Les deux sont servies par un court-circuit total du
pipeline (`http-kernel.ts:477`), monté **avant** la limitation de débit (`http-kernel.ts:980`) — un
kubelet qui reçoit un `429` croit le pod mort. Le détail vit dans
[servers](../../src/packages/@nodefony/http/docs/servers.md).

> **`initialDelaySeconds` ne se recopie pas.** Le boot est dominé par l'import et l'instanciation
> des modules de **votre** application : mesurez le vôtre. `NF_BOOT_TIMEOUT_MS` le borne — un module
> suspendu fait échouer le pod vite (`reservedEnv.ts:98`), au lieu de le laisser à moitié vivant.

## Secret et ConfigMap — ce qui va où

```yaml
apiVersion: v1
kind: Secret
metadata: { name: mon-app-secrets }
type: Opaque
stringData:
  # La base : le SCHÉMA de l'URL décide du dialecte (`infra.ts:91`), et un schéma
  # inconnu fait échouer le boot — jamais de choix silencieux.
  NF_DATABASE_URL: "postgres://app:…@postgres:5432/app"
  NF_REDIS_URL: "redis://redis:6379"
  # Scelle les enveloppes du bus temps réel (`reservedEnv.ts:130`) : sans lui, tout
  # ce qui peut publier sur le Redis peut injecter un message qui ressortira chez
  # vos clients.
  NF_REALTIME_BACKPLANE_SECRET: "…"
---
apiVersion: v1
kind: ConfigMap
metadata: { name: mon-app-config }
data:
  NODE_ENV: production
  # 🔴 Ce qui CLOISONNE deux applications sur un même bus (`reservedEnv.ts:134`).
  # Deux déploiements qui partagent un Redis sans espaces de noms distincts se
  # voient mutuellement.
  NF_REALTIME_BACKPLANE_NAMESPACE: mon-app-prod
```

Les alias de plateforme `DATABASE_URL` et `REDIS_URL` sont acceptés — ce sont les noms qu'un
hébergeur pose lui-même —, mais la forme préfixée `NF_` gagne quand les deux sont présentes ; la
lecture est faite une seule fois, par `resolveInfra()` (`infra.ts:134`). Le
détail des trois familles d'infrastructure et des profils qui en découlent vit dans
[persistence](./persistence.md).

## Service et Ingress

```yaml
apiVersion: v1
kind: Service
metadata: { name: mon-app }
spec:
  selector: { app: mon-app }
  ports: [{ port: 80, targetPort: 5151 }]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: mon-app
  annotations:
    # Le battement WebSocket est de 20 s : une inactivité plus courte tranche
    # des sockets VIVANTES. Viser au moins quatre battements.
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "300"
spec:
  ingressClassName: nginx
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend: { service: { name: mon-app, port: { number: 80 } } }
```

L'ingress est un reverse-proxy : la moitié applicative du contrat — `trustProxy`, `trustedHosts` —
reste à poser, et elle est décrite dans [reverse-proxy](./reverse-proxy.md). Sans elle, toutes vos
IP clientes seront celles de l'ingress.

## Les migrations passent AVANT les pods

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: mon-app-migrate
  annotations:
    # Le Job s'exécute avant que le déploiement ne soit mis à jour.
    "helm.sh/hook": pre-upgrade,pre-install
spec:
  backoffLimit: 2
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: registry.example.com/mon-app:10.0.0
          command: ["npx", "nodefony", "orm:migrate"]
          envFrom:
            - secretRef: { name: mon-app-secrets }
```

**Un Job, pas un `initContainer`.** Un `initContainer` s'exécute dans **chaque** pod : trois
exemplaires appliqueraient la même migration en concurrence. Le Job passe une fois, et le
déploiement ne démarre que s'il a réussi.

Et si un pod démarre avec un schéma en retard, il peut **retenir sa mise en service** plutôt que de
servir des erreurs : `kernel.setReadiness("schema", false, "3 migrations en attente")`
(`Kernel.ts:2999`) fait répondre
`503` à `/readyz` sans redéploiement, et l'ancien exemplaire continue de servir. Le geste complet et
ses règles vivent dans [servers](../../src/packages/@nodefony/http/docs/servers.md).

## Mise à l'échelle

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: mon-app }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: mon-app }
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        { name: cpu, target: { type: Utilization, averageUtilization: 70 } }
```

Deux conditions pour que l'ajout d'un pod serve à quelque chose :

- **les sessions sont partagées** — un stockage en mémoire déconnecte un utilisateur sur deux à
  chaque montée en charge ([session-storage](./session-storage.md)) ;
- **le backplane est déclaré** — sinon un message publié n'atteint que les clients du pod qui l'a
  publié.

> ⚠️ **Le pool de connexions à la base n'est pas réglable aujourd'hui** : le pilote PostgreSQL est
> instancié avec ses défauts (`DrizzleOrm.ts:1017`), soit dix connexions par process. Dix pods
> demandent donc jusqu'à cent connexions, à confronter au `max_connections` du serveur avant de
> pousser `maxReplicas`.

## ⚠️ Pièges (symptôme → cause → correction)

| Symptôme                                                       | Cause                                                                 | Correction                                                              |
| -------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Le déploiement coupe des requêtes en vol                       | `terminationGracePeriodSeconds` plus court que le drain               | l'allonger — c'est la requête la plus lente qui décide, pas la moyenne  |
| Des messages temps réel arrivent en double, ou d'une autre app | espace de noms du backplane absent ou partagé entre deux déploiements | `NF_REALTIME_BACKPLANE_NAMESPACE` distinct par déploiement              |
| Les pods se présentent tous pareil sur le bus                  | `NF_POD_NAME` non câblé                                               | le `fieldRef` sur `metadata.name`                                       |
| Le pod redémarre en boucle pendant l'arrêt                     | la sonde de vivacité pointe `/readyz`                                 | `/livez` pour la vivacité, `/readyz` pour le service — jamais l'inverse |
| Le kubelet déclare le pod mort sous charge                     | les sondes se font limiter en débit                                   | rien à faire : elles sont montées **avant** la limitation               |
| Les migrations s'appliquent N fois                             | elles sont dans un `initContainer`                                    | un `Job`, en amont du déploiement                                       |
| Le pod démarre, sert, et rend des erreurs de colonne inconnue  | le schéma est en retard et rien ne retient la mise en service         | `kernel.setReadiness("schema", false, …)`                               |
| La base refuse des connexions quand le nombre de pods augmente | dix connexions par process, multipliées par le nombre d'exemplaires   | confronter `maxReplicas × 10` au `max_connections` du serveur           |

## 🧪 Tests & couverture

Les chiffres exacts vivent dans la carte de l'aperçu, régénérée en comptant — jamais figés ici.

<!-- prettier-ignore -->
| Type | Où | Ce qui est prouvé |
| --- | --- | --- |
| Unitaires — signaux | `nodefony` `Cli.test.ts` | les signaux attachés, le second qui coupe court, les codes de sortie |
| Unitaires — grappe | `nodefony` `ClusterManager.test.ts`, `ClusterProbeAggregator.test.ts` | la supervision des ouvriers et l'agrégation des sondes |
| Intégration — CLI réelle | `nodefony` `CliIntegration.test.ts` | le démarrage effectif d'un processus |

> **Ce que rien ici ne prouve** : le comportement d'un cluster Kubernetes réel. Le contrat
> « SIGTERM → arrêt propre » est vérifié sur le processus ; ce que l'orchestrateur en fait dépend de
> vos sondes et de votre délai d'arrêt. Le banc qui s'en approche le plus est le banc multi-pods du
> dépôt, qui fait tourner plusieurs applications sur un bus Redis partagé — il éprouve le
> cloisonnement et le relais, pas l'ordonnanceur.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Guides](README.md) · [Toute la documentation](../index.md)
- 🐳 **Le modèle, les signaux, le Dockerfile** : [`docker-cloud-native.md`](./docker-cloud-native.md)
- 🛡️ **Ce que l'ingress doit poser, et ce que l'application doit croire** : [`reverse-proxy.md`](./reverse-proxy.md)
- 🗄️ **Les trois familles d'infrastructure et les profils qui en découlent** : [`persistence.md`](./persistence.md)
- 🗝️ **Pourquoi les sessions décident de votre mise à l'échelle** : [`session-storage.md`](./session-storage.md)
- 📖 [Lexique général](../lexique.md) du framework.
