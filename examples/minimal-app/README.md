# nodefony-minimal-app — app témoin & template cloud-native

App Nodefony **minimale** (HTTP + une route) qui sert de :

1. **Smoke test du pipeline release** (modèle B) : elle s'installe depuis les
   tarballs `npm pack` dans un environnement vierge → si la bascule
   `exports.types` ou les peers optionnels sont cassés, `npm install` ou `tsc`
   échoue ici, avant toute publication.
2. **Template Dockerfile de référence** pour une app Nodefony en production.

## Lancer le smoke test complet (depuis la racine du repo)

```bash
bash .claude/skills/nodefony-release/scripts/smoke-docker.sh
```

Il enchaîne : `pack-all.mjs` (13 tarballs, `exports.types` basculés au pack) →
copie de cette app dans `release/smoke-app/` (deps réécrites vers les tarballs) →
`docker build` (install vierge + `tsc` = gate types) → `docker run` → probes
`/livez` `/readyz` + `/api/hello` → **`docker stop` pendant une requête lente**
→ vérifie que la requête finit (200), que le container sort en exit 0 et que
les logs montrent le drain (`SHUTDOWN`).

## Ce que le Dockerfile fait — et pourquoi

| Ligne                                                               | Pourquoi                                                                                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-stage (`build` → runtime)                                     | La toolchain TS ne va jamais en prod ; image finale = dist + node_modules prod.                                                                                                       |
| `CMD ["node_modules/.bin/nodefony", "production"]` (forme **exec**) | node = PID 1 → reçoit le SIGTERM de `docker stop`. La forme shell met `/bin/sh` en PID 1 qui ne forward pas les signaux → jamais de graceful shutdown.                                |
| `USER node` + `chown /app`                                          | Jamais root ; le boot écrit (tmp/, logs éventuels).                                                                                                                                   |
| `servers.https: false` (nodefony.config.ts)                         | TLS terminé à l'ingress/LB → le pod ne génère aucun certificat et ne sert qu'en clair (HTTP + WS sur 5151). Retirer cette ligne pour un TLS pod-level.                                |
| `HEALTHCHECK` → `/readyz`                                           | Probe native Nodefony (config `health` du module http, on par défaut). ⚠️ k8s **ignore** HEALTHCHECK : déclarer `livenessProbe: /livez` + `readinessProbe: /readyz` dans le pod spec. |
| `EXPOSE 5151` (HTTP clair)                                          | Modèle cloud-native : le TLS est terminé à l'ingress/LB.                                                                                                                              |
| 1 process = 1 container                                             | Le scaling horizontal appartient à l'orchestrateur (répliques), pas à un process manager dans l'image.                                                                                |

## Le contrat SIGTERM (graceful shutdown du framework)

```
SIGTERM → /readyz passe 503 (le LB retire le pod, + `health.shutdownDelay` optionnel)
        → WebSockets fermées proprement (close 1001)
        → requêtes in-flight terminées (drain, `servers.*.shutdownTimeout` 5 s/serveur)
        → exit 0 — le tout borné par `shutdownDeadline` (15 s) sinon exit 1 forcé
```

Garder `shutdownDeadline` < grace period de l'orchestrateur (30 s k8s,
`docker stop -t 10` par défaut → passer `-t 20` si vos requêtes sont longues).

## Adapter en app réelle

- `package.json` : remplacer les deps `"*"` par `"^10.0.0"` (registry npm) et
  supprimer `COPY tarballs/` du Dockerfile.
- Probes k8s :

  ```yaml
  livenessProbe: { httpGet: { path: /livez, port: 5151 } }
  readinessProbe: { httpGet: { path: /readyz, port: 5151 } }
  ```
