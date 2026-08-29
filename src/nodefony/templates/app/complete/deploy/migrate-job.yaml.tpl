<% if (it.db) { %># <%= it.appName %> — migration du schéma AVANT le déploiement (Kubernetes)
#
# Ce fichier est rendu à TON nom : image, secret et libellés portent déjà
# « <%= it.appName %> ». Il n'y a rien à recopier depuis une page de documentation.
#
# ── Pourquoi un travail séparé, et pas autre chose ───────────────────────────
# Au démarrage, N exemplaires partent EN MÊME TEMPS : appliquer les migrations
# depuis les pods, c'est N exécutions concurrentes, des privilèges de
# modification du schéma dans le processus qui sert le trafic, et un
# redémarrage en boucle généralisé si une migration échoue. Le verrou de
# Nodefony rend ces variantes SÛRES — elles restent le mauvais endroit. Un
# conteneur d'initialisation a le même défaut (une exécution par exemplaire).
# Ici : UN travail, avant le déploiement, avec son propre compte.
#
# ── La règle dure ────────────────────────────────────────────────────────────
# MÊME image et MÊME étiquette que le Deployment qui suit. Une migration jouée
# depuis une autre version applique un schéma que le code déployé ne connaît
# pas — et personne ne le voit avant la première requête.
#
# ── Le compte qui migre n'est pas le compte qui sert ─────────────────────────
# `NF_MIGRATE_DATABASE_URL` remplace la connexion du connecteur POUR CETTE
# COMMANDE SEULEMENT : le secret qui a le droit de modifier le schéma est monté
# ici, et nulle part ailleurs. Elle doit désigner une connexion DIRECTE — un
# répartiteur de connexions en mode transaction casse le verrou.
#
#   kubectl create secret generic <%= it.appName %>-db-migrator \
#     --from-literal=url='<%= it.db.scheme %>://migrator:MOT_DE_PASSE@db:<%= it.db.port %>/<%= it.appName %>'
#
# ── Le déroulé ───────────────────────────────────────────────────────────────
#   JOB=$(IMAGE_TAG=1.4.0 envsubst < deploy/migrate-job.yaml | kubectl create -f - -o name)
#   kubectl wait --for=condition=complete --timeout=10m "$JOB" \
#     || { kubectl logs "$JOB"; exit 1; }
#   kubectl set image deployment/<%= it.appName %> <%= it.appName %>=<%= it.appName %>:1.4.0
#
# Le travail échoue → le déploiement n'a PAS lieu, l'ancienne version continue
# de servir. Il réussit → les pods démarrent en `ddl: "none"` et leur sonde de
# disponibilité les met en service dès que le schéma est à jour.
#
# Si tu as un chart Helm, ce même corps se pose en accroche :
#   annotations: { "helm.sh/hook": pre-install,pre-upgrade }
# En ArgoCD : `argocd.argoproj.io/hook: PreSync` + `sync-wave: "-1"`.
#
# Le pourquoi complet, les droits SQL exacts des deux comptes et la règle N-1
# (compatibilité entre l'ancienne et la nouvelle version pendant le
# remplacement) : `node_modules/@nodefony/drizzle/docs/migrations.md`.
apiVersion: batch/v1
kind: Job
metadata:
  # `generateName`, pas `name` : un Job est IMMUABLE. Un nom fixe fait échouer
  # le second déploiement sur « existe déjà », et l'on croit à une panne de
  # migration. Le nom réel est rendu par `kubectl create -o name`.
  generateName: <%= it.appName %>-migrate-
  labels:
    app.kubernetes.io/name: <%= it.appName %>
    app.kubernetes.io/component: migrate
spec:
  # Aucune reprise : une migration qui échoue laisse un état à comprendre, pas
  # à rejouer en aveugle. Le travail est idempotent (rejouer n'applique rien),
  # mais c'est une DÉCISION humaine, pas un réflexe de l'orchestrateur.
  backoffLimit: 0
  # Borne dure. Le délai d'attente de ton outil de déploiement doit rester
  # AU-DESSUS, sinon il abandonne un travail qui, lui, tient toujours le verrou.
  activeDeadlineSeconds: 600
  # Le travail terminé s'efface seul — ses journaux restent le temps de les lire.
  ttlSecondsAfterFinished: 3600
  template:
    metadata:
      labels:
        app.kubernetes.io/name: <%= it.appName %>
        app.kubernetes.io/component: migrate
    spec:
      restartPolicy: Never
      securityContext:
        runAsNonRoot: true
      containers:
        - name: migrate
          image: <%= it.appName %>:${IMAGE_TAG}
          # Même forme que le `CMD` du Dockerfile : le binaire vit dans les
          # `node_modules` de l'image, jamais dans le PATH.
          command: ["node_modules/.bin/nodefony", "orm:migrate", "--json"]
          env:
            - name: NODE_ENV
              value: production
            - name: NF_MIGRATE_DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: <%= it.appName %>-db-migrator
                  key: url
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              memory: 512Mi
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: false
            capabilities:
              drop: ["ALL"]
<% } %>