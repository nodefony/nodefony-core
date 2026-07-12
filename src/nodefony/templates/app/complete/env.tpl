# ══════════════════════════════════════════════════════════════════════════
#  Environnement de <%= it.appName %> — fichier COMMITÉ (défauts NON-secrets)
# ══════════════════════════════════════════════════════════════════════════
# Convention (celle du framework, style Vite/Next) :
#   .env        → CE fichier : catalogue + défauts partagés, JAMAIS de secret
#   .env.local  → tes valeurs machine + SECRETS (gitignoré via *.local,
#                 généré à la création de l'app)
# Priorité de chargement : .env.local PRIME sur .env (première clé gagne).
# Chaque variable est déclarée et validée dans env.ts (seul lecteur de
# process.env) — une variable non déclarée là-bas n'existe pas pour l'app.

# ── Observabilité ───────────────────────────────────────────────────────────
# Sink des logs : stdout (cloud-native, défaut) | file | null
# NF_LOG_DRIVER=stdout

# ── Persistance (infra déclarée → stores dérivés automatiquement) ───────────
# URL unique, dialecte déduit du scheme. ABSENTE = profil solo : sqlite local
# (var/databases/) — l'app persiste out-of-the-box (users, sessions, jetons).
# NF_DATABASE_URL=postgres://user:pass@localhost:5432/<%= it.appName %>

# Cache/éphémère partagé : sa présence CHARGE @nodefony/redis (sessions,
# idempotence, backplane realtime cross-pod).
# NF_REDIS_URL=redis://localhost:6379

# ── Secrets (module security) — VALEURS dans .env.local, jamais ici ─────────
# Générées à la création de l'app ; rotation/rattrapage :
#   npx nodefony security:secrets --write
# NF_TOTP_KEY=        → .env.local (chiffrement des secrets 2FA au repos)
# NF_WEBHOOK_KEY=     → .env.local (chiffrement des signatures webhook)
# NF_CSRF_SECRET=     → .env.local (jetons anti-CSRF, partagé en cluster)

# ── Compte admin (seedé au premier boot — nodefony/security/provisionUsers.ts)
# DEV : défaut admin / admin (local). PROD : OBLIGATOIRE, sans lui aucun compte
# n'est créé (le définir via le secret-manager, pas dans un fichier commité).
# NF_ADMIN_PASSWORD=
