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

**Commence par lire `deploy/migrate-job.yaml` : il passe la politique Restricted.** Recopie-en le
contexte de sécurité — mais pas son `readOnlyRootFilesystem: false`, qui convient à un travail
éphémère et pas à un exemplaire qui sert du trafic.

Restricted exige **quatre** champs, tous portés par le **manifeste** — aucun n'est « hérité de
l'image » : `runAsNonRoot: true` (et un `runAsUser`, s'il est posé, différent de 0),
`allowPrivilegeEscalation: false`, `capabilities.drop: ["ALL"]`, `seccompProfile` `RuntimeDefault`.
Ce que l'image apporte, c'est de les rendre satisfaisables sans contorsion : elle déclare
`USER 1000:1000`, donc l'identifiant numérique existe ; elle n'écoute qu'au-dessus de 1024, donc
aucune capacité n'est nécessaire. Aucun ne coûte rien.

**`readOnlyRootFilesystem: true` n'est PAS exigé par Restricted** : c'est un durcissement en plus,
recommandé, et le seul qui se travaille — il demande les deux volumes.

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

Puis **débranche** : retire `seccompProfile`, réapplique. L'admission doit **refuser** le pod. Une
politique qu'on n'a jamais vue refuser quelque chose n'est pas une politique. (Retirer un
`emptyDir` fait échouer le **démarrage**, pas l'admission : c'est une autre preuve, celle des
volumes.)

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
- **Toujours le port HTTP (5151)**, même si h2c est actif : le port h2c (5153) refuse HTTP/1.1,
  la langue d'une sonde de kubelet. Un pod qui sonde 5153 n'est jamais prêt.

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

Ces valeurs sont un **départ** pour un trafic modeste. Un pod qui doit tenir son plein débit
demande environ **un cœur** (`requests.cpu: "1"`) : ton code tourne sur une seule boucle. Combien
de pods, quelle mémoire par pod, et pourquoi c'est souvent le temps réel qui décide →
[`dimensionnement.md`](dimensionnement.md).

Si tu bornes le tas de la machine virtuelle JavaScript face à une limite mémoire de cgroup,
dimensionne-le avec une mesure, pas au jugé.

## 6. La base de données — elle n'est pas dans le cluster

C'est la différence la plus structurante avec le compose de développement.

1. **Aucun manifeste de base n'est fourni**, et c'est voulu : en production elle est administrée.
2. **Ne reporte jamais l'hôte du compose.** `compose.yaml` pointe un **service du compose** ; le
   même nom dans un cluster désigne un Service qui n'existe pas. Rien ne casse au déploiement, tout
   casse au premier accès.
3. **L'URL passe par un Secret** — elle porte un mot de passe, elle n'a rien à faire dans un
   ConfigMap. Deux formes, au choix : `valueFrom.secretKeyRef` (ce que fait
   `deploy/migrate-job.yaml`) ou le Secret monté en fichier et `NF_DATABASE_URL_FILE`. Ne pose
   jamais les deux : `NF_DATABASE_URL` et `NF_DATABASE_URL_FILE` ensemble arrêtent le démarrage.
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
  - name: NF_DATABASE_URL # ou NF_DATABASE_URL_FILE vers un Secret monté (§6)
    valueFrom: { secretKeyRef: { name: <app>-db, key: url } }
  # plusieurs exemplaires + temps réel : un bus partagé, sinon chaque pod parle seul
  - { name: NF_REALTIME_DRIVER, value: redis }
  - name: NF_REDIS_URL
    valueFrom: { secretKeyRef: { name: <app>-redis, key: url } }
```

`NF_POD_NAME` vient de l'API descendante. Elle dérive l'identité d'origine du bus temps réel : sans
elle, plusieurs exemplaires se confondent et les messages s'écoutent eux-mêmes.

`NF_REALTIME_DRIVER=redis` n'est utile qu'à partir de **deux** exemplaires : avec un seul, le bus
local suffit. Sans lui à deux exemplaires, un message n'atteint que les clients du pod qui l'émet,
**sans erreur** — détail dans [`dimensionnement.md`](dimensionnement.md) §4.

`NF__HTTP__TRUSTPROXY` est **obligatoire** dès qu'un contrôleur d'entrée termine le TLS —
[`frontal.md`](frontal.md) dit ce qui tombe sans lui, et comment le voir tomber. L'Ingress ou la
Gateway API, les annotations d'inactivité qui gardent les WebSocket, et le `Service` à deux ports
pour h2c : [`frontal.md`](frontal.md) §10.

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
