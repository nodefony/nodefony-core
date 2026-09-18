# Kubernetes — ton Deployment

> **Maintenance** : vérité courante. Éditer en place.

## 1. Ce qui est rendu, et ce qui ne l'est pas

**Rendu à ton nom** : `deploy/migrate-job.yaml`, le travail qui joue les migrations. Son mode
d'emploi est en tête du fichier.

**Pas rendu** : le Deployment, le Service, l'Ingress, les Secret et ConfigMap. Tu les écris. Cette
page dit quoi y mettre ; le guide `kubernetes.md` du framework en donne un exemple complet.

```bash
kubectl apply -f deploy/migrate-job.yaml     # les migrations AVANT les nouveaux exemplaires
kubectl wait --for=condition=complete job/<nom> --timeout=300s
kubectl apply -f <ton-deployment>.yaml
```

L'ordre n'est pas négociable : un exemplaire neuf face à un schéma ancien écrit dans des colonnes
qui n'existent pas.

## 2. Le contexte de sécurité — politique Restricted

Six exigences. **Quatre sont acquises** parce que l'image les porte : `runAsNonRoot`, un
`runAsUser` **numérique** (l'image déclare `USER 1000:1000`, donc tu reportes `1000`),
`allowPrivilegeEscalation: false`, `capabilities.drop: ["ALL"]`.

**Deux te reviennent :**

```yaml
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 1000
    fsGroupChangePolicy: OnRootMismatch # c'est LUI qui donne le volume au bon porteur
    seccompProfile: { type: RuntimeDefault }
  containers:
    - name: <app>
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities: { drop: ["ALL"] }
      volumeMounts:
        - { name: tmp, mountPath: /app/tmp }
        - { name: var, mountPath: /app/var }
  volumes:
    - { name: tmp, emptyDir: { sizeLimit: 256Mi } }
    - { name: var, emptyDir: {} }
```

- **`seccompProfile`** : la politique traite l'**absence** de profil comme une violation, pas comme
  un défaut permissif. Aucun coût : rien ici n'appelle de fonction système exotique.
- **`readOnlyRootFilesystem: true`** : possible **uniquement** avec les deux volumes ci-dessus.
  Sans eux, le conteneur ne démarre pas — l'application crée `tmp/` et `var/` au démarrage.

> ⚠️ **Un volume éphémère en mémoire compte dans la limite mémoire du conteneur.** Laisse
> `emptyDir: {}` sur disque, et pose une `sizeLimit` — un dossier temporaire sans borne est un
> moyen de faire évincer ton propre pod.

**Le rendre opposable, sinon ça ne prouve rien :**

```bash
kubectl label ns <ns> pod-security.kubernetes.io/enforce=restricted
kubectl apply -f <ton-deployment>.yaml       # doit passer SANS avertissement
```

Puis **débranche** : retire un `emptyDir`, réapplique. Le pod ne doit plus démarrer. Une politique
qu'on n'a jamais vue refuser quelque chose n'est pas une politique.

## 3. Les sondes

```yaml
startupProbe:
  {
    httpGet: { path: /readyz, port: 5151 },
    periodSeconds: 2,
    failureThreshold: 30,
  }
readinessProbe: { httpGet: { path: /readyz, port: 5151 }, periodSeconds: 5 }
livenessProbe: { httpGet: { path: /livez, port: 5151 }, periodSeconds: 10 }
```

- **Pas de sonde de démarrage dédiée côté application** : `/readyz` en fait office. Dimensionne
  `failureThreshold × periodSeconds` sur le **pire** temps de démarrage, pas le meilleur — c'est la
  cause n° 1 des pods qui redémarrent en boucle avec des journaux muets.
- **`livenessProbe` sur `/livez`, jamais sur `/readyz`.** `/livez` reste à `200` pendant le drain :
  un exemplaire qui draine est vivant. Sonder `/readyz` en vivacité le ferait **tuer** au milieu de
  son arrêt propre — exactement ce qu'on cherche à éviter.
- Les deux répondent **avant la limitation de débit** : un kubelet limité recevrait `429` et
  conclurait à un échec.

## 4. L'arrêt — ne perdre aucune requête

```yaml
terminationGracePeriodSeconds: 30
lifecycle: { preStop: { sleep: { seconds: 2 } } }
```

La chronologie réelle :

```
SIGTERM ──► /readyz passe à 503 ──► le répartiteur retire le pod ──► drain ≤ 15 s ──► sortie 0
            │                                                                          │
            └── preStop : le temps que les points d'accès se propagent ────────────────┘
                                          fenêtre de grâce : 30 s
```

**La fenêtre doit être strictement supérieure au drain** (15 s). À l'expiration, le kubelet tue —
code **137**, requêtes en vol perdues, aucun message. Le `preStop` court existe parce que le
retrait d'un point d'accès n'est pas instantané : sans lui, du trafic arrive encore après le début
du drain.

**Vérifier que ça marche** — sous charge constante, `kubectl rollout restart deploy/<app>` : zéro
`5xx`. C'est la seule preuve qui compte.

## 5. Les ressources

```yaml
resources:
  requests: { cpu: 250m, memory: 256Mi }
  limits: { memory: 512Mi } # PAS de limite CPU
```

**Pas de limite processeur.** Une limite mémoire tue proprement et le pod redémarre ; une limite
processeur ne tue pas — elle **ralentit en permanence**, et ça ne ressemble pas à une limite, ça
ressemble à une application lente. Les demandes suffisent à garantir la part.

Si tu bornes le tas de la machine virtuelle JavaScript face à une limite mémoire de cgroup,
dimensionne-le avec une mesure, pas au jugé.

## 6. La base de données — elle n'est pas dans le cluster

C'est la différence la plus structurante avec le compose de développement.

1. **Aucun manifeste de base n'est fourni**, et c'est voulu : en production elle est administrée.
2. **Ne reporte jamais l'hôte du compose.** `compose.yaml` pointe un **service du compose** ; le
   même nom dans un cluster désigne un Service qui n'existe pas. Rien ne casse au déploiement, tout
   casse au premier accès.
3. **L'URL passe par un Secret, en `_FILE`** — elle porte un mot de passe, elle n'a rien à faire
   dans un ConfigMap.
4. **Le plafond de connexions.** Une base administrée les compte strictement. N exemplaires × le
   pool de chacun peuvent la saturer, et l'erreur sort de **son** côté, pas du tien. Reste prudent
   sur le nombre d'exemplaires.

| Ta base                | Exemplaires      | Volume pour `var/`        | Stratégie       |
| ---------------------- | ---------------- | ------------------------- | --------------- |
| SQLite (fichier local) | **1, impératif** | revendication persistante | **`Recreate`**  |
| Serveur (administrée)  | plusieurs        | `emptyDir`                | `RollingUpdate` |

> 🔴 **SQLite impose `strategy: Recreate`.** Un déploiement progressif sur un volume monté par un
> seul nœud attend un disque que l'exemplaire précédent tient encore : le nouveau pod reste en
> attente **pour toujours**, sans que rien ne nomme la cause.

## 7. Les variables du manifeste

```yaml
env:
  - { name: NODE_ENV, value: production }
  - { name: NF_POD_NAME, valueFrom: { fieldRef: { fieldPath: metadata.name } } }
  - { name: NF__HTTP__TRUSTPROXY, value: uniquelocal }
  - { name: NF_CSRF_SECRET_FILE, value: /run/secrets/csrf }
  - { name: NF_DATABASE_URL_FILE, value: /run/secrets/db-url }
```

`NF_POD_NAME` vient de l'API descendante. Elle dérive l'identité d'origine du bus temps réel : sans
elle, plusieurs exemplaires se confondent et les messages s'écoutent eux-mêmes.

`NF__HTTP__TRUSTPROXY` est **obligatoire** dès qu'un Ingress termine le TLS —
[`frontal.md`](frontal.md) dit ce qui tombe sans lui, et comment le voir tomber.

## 8. Éprouver sans cluster de production

```bash
kind create cluster --name <app>
kubectl label ns default pod-security.kubernetes.io/enforce=restricted
kubectl apply -f deploy/migrate-job.yaml
kubectl apply -f <ton-deployment>.yaml
kubectl rollout status deploy/<app>
kind delete cluster --name <app>
```

`podman kube play` joue les mêmes fichiers **sans cluster du tout** — mais il ne rejoue ni
l'admission de la politique, ni l'Ingress, ni un déploiement progressif. Ce qu'il ne prouve pas
doit être dit, pas supposé prouvé.
