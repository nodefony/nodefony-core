# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Template Nodefony cloud-native — 1 process = 1 container.
# Le scaling horizontal = répliques de l'orchestrateur (k8s/Swarm/Cloud Run),
# jamais un process manager dans l'image. Le container DIALOGUE avec
# l'orchestrateur via SIGTERM (docker stop / éviction k8s) : le framework
# draine (readyz 503 → WS close 1001 → in-flight terminées → exit 0) sous
# `shutdownDeadline` (15 s) — garder la grace period au-dessus (k8s 30 s ok,
# `docker stop -t 10` par défaut ok).
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage build : install + compile — la toolchain ne va PAS en prod ─────────
FROM node:24-slim AS build
WORKDIR /app
# Tarballs locaux (smoke test release / installation hors registry). Une app
# réelle installe depuis npm : supprimer COPY tarballs/ et pointer des
# versions "^10.0.0" dans package.json.
COPY tarballs/ ./tarballs/
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json index.ts env.ts nodefony.config.ts ./
COPY nodefony/ ./nodefony/
# tsc = AUSSI le smoke test des types publiés (exports.types des tarballs).
RUN npx tsc && npm prune --omit=dev

# ── Stage runtime : minimal, non-root ────────────────────────────────────────
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
# /app doit appartenir à node : le boot écrit (tmp/, logs éventuels).
RUN chown node:node /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
# Jamais root — les ports Nodefony (5151/5152) n'exigent aucun privilège.
USER node
EXPOSE 5151
# Probe Docker/compose/Swarm sur /readyz (natif Nodefony). k8s IGNORE
# HEALTHCHECK : y déclarer livenessProbe=/livez + readinessProbe=/readyz.
HEALTHCHECK --interval=10s --timeout=2s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:5151/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Forme EXEC obligatoire : node devient PID 1 et reçoit le SIGTERM de
# `docker stop`. La forme shell (CMD npx nodefony…) met /bin/sh en PID 1,
# qui ne forward PAS les signaux → jamais de graceful shutdown, SIGKILL
# systématique à chaque déploiement.
CMD ["node_modules/.bin/nodefony", "production"]
