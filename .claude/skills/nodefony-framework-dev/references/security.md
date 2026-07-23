# Référence SÉCURITÉ (coder AVEC la sécurité) — intemporel

> Chargé à la demande par `SKILL.md`. Ce fichier = comment CODER en sûreté + où vérifier.
> Pour ATTAQUER/auditer un diff (red/blue-team, conformité RFC) → skill **`nodefony-security-review`**.
> Usage des décorateurs `@IsGranted`/`@RequireScope`/`@CsrfProtect` → `references/http.md`.
> (Avancement, phases, « ce qu'il reste » = `MIGRATION_STATUS.md`, PAS ici.)

## Sommaire

- Sources normatives à CONSULTER (RFC/OWASP/ANSSI — jamais trancher de mémoire)
- Dépendances & supply-chain — `npm audit` (OWASP A06)

---

## 10. Sécurité & conformité (PRIORITÉ MAX — directive permanente)

Nodefony doit être une **référence** sécurité (dev classique + agentic). Sur CHAQUE diff :

- SQL/ORM **bindé** ; **0 secret** loggé/renvoyé en clair (redaction serveur) ; **0 `any`** ;
  **Zero Trust** (API admin → 403 sans rôle) ; JWT stateless cookie HttpOnly Secure SameSite ;
  crypto mdp (bcrypt/argon2, jamais MD5/SHA1) ; entrées **validées** au boundary ;
  endpoints qui EXÉCUTENT (run tests/scaffold) → **DEV-ONLY** (403 hors `development`).
- **Avant commit** → passer le diff au skill **`nodefony-security-review`**. Signaler tout écart proactivement.

### Sources normatives à CONSULTER (ne jamais trancher de mémoire)

| Domaine                                                  | Source / skill                                                                                                                                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocole HTTP/HTTP2/WS/CORS/cookies                     | skill **`nodefony-rfc`** (RFC 9110/9113/6455/6265, Fetch — IETF/W3C bruts)                                                                                                                                              |
| Types TS / API Node.js                                   | skill **`nodefony-ts-docs`** (handbook, @types/node)                                                                                                                                                                    |
| Sécu applicative (checklist vérifiable)                  | **OWASP** : ASVS + Cheat Sheet Series en **raw GitHub** — `raw.githubusercontent.com/OWASP/ASVS`, `raw.githubusercontent.com/OWASP/CheatSheetSeries` ; Top 10 via proxy                                                 |
| Recommandations & vulnérabilités (FR, autorité étatique) | **ANSSI / CERT-FR** via **proxy** : guides `https://r.jina.ai/https://cyber.gouv.fr/publications` (sécurisation web, RGS crypto) ; avis/alertes `https://r.jina.ai/https://www.cert.ssi.gouv.fr/avis/` et `.../alerte/` |

⚠️ **Règle universelle** (CLAUDE.md racine) : NE JAMAIS charger les pages HTML lourdes
(`owasp.org`, `cyber.gouv.fr`, `cert.ssi.gouv.fr`, `tools.ietf.org`) directement → toujours **raw
GitHub** ou **proxy `https://r.jina.ai/`**. Citer la source (RFC §, OWASP ASVS V#, CERT-FR n°) dans le
commit/diff quand un choix sécu/conformité s'y appuie.

> Réflexe : touche à de la crypto / un header de sécu / une entrée non maîtrisée / une dépendance
> sensible → vérifier OWASP (Cheat Sheet du sujet) **et** un éventuel avis ANSSI/CERT-FR sur la lib/version
> AVANT de livrer, puis `nodefony-security-review`. La sécurité prime sur la vitesse.

### Dépendances & supply-chain — `npm audit` (OWASP A06 : composants vulnérables)

Une faille la plus fréquente n'est pas TON code mais une **dépendance**. AVANT d'ajouter/bumper une dep,
et périodiquement :

```bash
npm audit                       # CVE connues dans tout l'arbre (workspaces inclus)
npm audit --omit=dev            # ne garder QUE les deps de prod/runtime (ce qui ship réellement)
npm audit --audit-level=high    # gate : échoue si ≥ high (utile en CI)
npm outdated                     # versions en retard (ou commande `npx nodefony outdated`)
```

- ⚠️ **`npm audit fix --force` = INTERDIT sans accord** (bump majeur → casse). Lire l'avis, bumper la
  version **précise** corrigée, re-tester (build + typecheck + suite). `--force` rebascule des majeures.
- **Distinguer prod vs dev** : une CVE dans une devDep (build/test) ≠ une CVE runtime exploitable.
  Prioriser `--omit=dev` ; documenter le résiduel accepté.
- **Avant TOUTE nouvelle dep runtime** (règle CLAUDE.md) : peser bundle size + mémoire + maintenance +
  surface d'attaque ; préférer l'API Node native. Vérifier mainteneur/téléchargements/dernière release
  (typosquatting, paquet abandonné). Une nouvelle dep doit être **externalisée** dans le rolldown.config si peerDep
  (cf skill `nodefony-check-externals`).
- **Lockfile** : commiter `package-lock.json` ; ne jamais éditer l'arbre à la main. Croiser une CVE avec
  un **avis CERT-FR/ANSSI** (§ sources) sur la lib/version pour la criticité réelle.
- Idéal CI/hook : `npm audit --omit=dev --audit-level=high` en avertissement (non bloquant au commit,
  comme eslint), revu périodiquement.
