---
adr: 6
title: Configuration unifiée — une source Zod par module + override env générique NF__* + précédence
date: 2026-06-28
status: accepted
deciders: [Christophe CAMENSULI]
tags: [config, dx, cloud-native, docker, env, zod, securite, devops]
---

# ADR-0006 — Configuration unifiée : une source Zod par module + override env générique + précédence explicite

## Statut

Accepté (2026-06-28). **Décision figée ; implémentation par slices (à faire).** Ce document EST la
spécification à respecter (comme ADR-0005 Partie 2). Slice 1 = `@nodefony/security` (module exemple).

## Contexte

La configuration « marche » mais est **devenue confuse au point de freiner chaque session** (constat
auteur : « marre de rien comprendre à la config »). Trois douleurs, **vérifiées dans le code** :

1. **Double source de défauts.** Le même défaut est défini à deux endroits qui **divergent**.
   Preuve : `@nodefony/security` —
   - `nodefony/config/defineSecurityConfig.ts:39` → `timeCost.default(3)` (le Zod),
   - `nodefony/config/config.ts:35` → `timeCost: 2` (re-tapé),
   - `config.ts:33` (commentaire) → exemple `1`.
     → **trois valeurs, trois endroits.** Idem la CSP, **copiée mot pour mot** dans les deux fichiers,
     avec un commentaire d'aveu (`defineSecurityConfig.ts:200` : « DOIT rester identique… divergence
     vécue »). Comme `config.ts` fait `...defineSecurityConfig({ timeCost: 2 })`, **ses valeurs écrasent
     les défauts Zod** : l'effectif est `2`, le `.default(3)` n'est jamais utilisé → le défaut
     « documenté » est un mensonge. C'est la cause matérielle du « je vois rien ».

2. **Structures hétérogènes (3 patterns coexistent).** Sondé le 2026-06-28 :
   - `security` = 2 fichiers (`config.ts` + `defineSecurityConfig.ts`) ;
   - `drizzle`/`mongoose`/`redis`/`realtime`/`frontend`/`documentation` = 3 (`+ schema.ts` en trop) ;
   - `framework` = 2 mais **sans** `defineFrameworkConfig` ; `http` = **4**
     (`config.ts` + `configMeta.ts` + `defineHttpConfig.ts` + `schema.ts`).

3. **Override env limité au catalogue câblé à la main.** `env.ts` est un excellent catalogue typé
   (`defineEnv`, seul lecteur de `process.env`), mais **seule** une variable déclarée ET câblée
   manuellement dans `nodefony.config.ts` (`driver: ctx.env.NF_LOG_DRIVER`) est surchargeable. Un
   devops qui veut changer `security.jwt.accessTtlS` ou `http.servers.https.port` en Docker **doit
   patcher le code** (ajouter la var + le câblage). Ce n'est pas acceptable pour une image officielle
   cloud-native — « un devops qui galère parle mal du framework ».

Besoins à satisfaire **simultanément** (dont deux en tension) : (a) **une seule source** de défauts ;
(b) **toute** la config surchargeable par env/Docker **sans code** ; (c) **simplicité radicale** —
pas d'usine à gaz ; (d) **héritable** quand Nodefony est une dépendance npm (le projet consumer hérite
de cette vision).

Veille (2025-2026, sources fetchées) : le modèle actuel `defaultAppConfig` + deep-merge + `use()` +
registre typé `NodefonyModuleConfig` + `z.toJSONSchema`→Studio **est déjà** Spring Boot (starter pose
les défauts en précédence basse, app surcharge) / Symfony (bundle `Configuration` deep-mergé) **bien
transposés en TS**, avec en bonus le formulaire auto-généré que ni Spring ni Symfony n'ont. La valeur
n'est **pas à refondre** mais à **unifier + rendre la précédence/provenance explicites + fermer les
gaps cloud-native** (override générique + `*_FILE`).

## Décision

### D1 — Règle d'or : UNE source de défauts par module = le schéma Zod

Le schéma Zod d'un module est l'**unique** source : il porte à la fois le **type** (`z.infer`), la
**validation**, le **défaut** (`.default(x)`), la **doc** (`.describe(...)`) et le **formulaire
Studio** (`z.toJSONSchema`). **Un défaut n'est JAMAIS re-tapé ailleurs** — ni dans un `config.ts` de
valeurs, ni dans un `.env.example`, ni dans un `Dockerfile`. Les défauts matérialisés = `schema.parse({})`.

### D2 — Convention « 2 fichiers, 1 source » par module

| Fichier            | Rôle                      | Contenu                                                                                                                                                            |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `config.ts`        | **QUOI** (lisible)        | le schéma Zod commenté (`.default().describe()`) + `export type IXConfig` + `export xConfigJsonSchema()`. Le **seul** fichier qu'on lit pour comprendre un module. |
| `defineXConfig.ts` | **COMMENT** (builder pur) | `parse(input) → valide → (hooks: detectConflicts…) → Object.freeze`. ~15 lignes. **Zéro valeur.**                                                                  |

- `schema.ts` séparé → **fusionné** dans le schéma (les 6 modules concernés). `http` (4 fichiers) → 2.
  `framework` → ajouter `defineFrameworkConfig`.
- Tolérance anti-cycle : si séparer `config.ts`/`defineXConfig.ts` crée un cycle `z.infer ↔ builder`,
  **tout regrouper dans un fichier** est acceptable (le but est _une source_, pas _deux fichiers_ dogmatiques).
- Le `config.ts` **ne re-tape rien** : les défauts du module = `defineXConfig()` (parse de `{}`).

### D3 — Override env GÉNÉRIQUE `NF__<MODULE>__<CHEMIN…>` (le chaînon Docker)

N'importe quel champ de n'importe quel module est surchargeable par variable d'environnement, **sans
écrire une ligne de code**, validé par le schéma Zod existant.

- **Forme** : `NF__<MODULE>__<CHEMIN…>=valeur`. **`__` (double underscore) = séparateur de niveau**
  (choix .NET Core / Docker — explicite, zéro magie). Le préfixe `NF__` (double) distingue sans
  ambiguïté du catalogue `NF_` (simple).
- **Mapping** : segments **insensibles à la casse**, résolus contre les clés réelles du schéma
  (`ACCESSTTLS` → `accessTtlS`). Le 1ᵉʳ segment = le module (`SECURITY` → `@nodefony/security`).
- **Coercion robuste** (avant le Zod, piège znv) : `"true"/"false"/"1"/"0"` → booléen ;
  numérique → nombre ; **CSV** `a,b,c` → tableau de strings ; `[...]`/`{...}` → JSON. Puis le Zod
  **valide** — invalide ⇒ **boot échoue, message clair nommant la variable** (fail-closed).
- **Secrets** : convention **`<VAR>_FILE`** (lire la valeur depuis un fichier monté — Docker secrets,
  K8s, Vault) ; erreur si la variable ET son `_FILE` sont posés ensemble.

```bash
NF__SECURITY__JWT__ACCESSTTLS=300
NF__HTTP__SERVERS__HTTPS__PORT=8443
NF__SECURITY__CORS__ORIGINS=https://a.com,https://b.com   # CSV → array
NF_WEBHOOK_KEY_FILE=/run/secrets/webhook_key             # secret depuis fichier monté
```

### D4 — Deux couches env, rôles distincts (et pourquoi deux)

- **Catalogue** `env.ts` (`NF_X`, nommé/typé via `defineEnv`) : **secrets, choix structurants,
  défauts à logique** (ex. `NF_BIND_ALL` qui règle domaine + trustProxy), exposés typés dans `ctx.env`.
  **Expérience développeur.** Conservé tel quel.
- **Override générique** `NF__X__Y` : surcharge ponctuelle de **n'importe quel** champ.
  **Expérience devops/Docker.** **Optionnel** — le cas simple (un `.env` avec le catalogue) ne le
  voit jamais. Règle de non-chevauchement : un champ qui a une variable dédiée au catalogue n'est pas
  aussi piloté par `NF__*` (la variable nommée fait foi) — à documenter par module.

### D5 — Précédence : UNE échelle, écrite

```
1. défaut Zod (core + module)                 ← le framework apporte
2. nodefony.config.ts (écarts app, par-env via ctx ; inclut ctx.env = catalogue)
3. NF__* (override env générique) + *_FILE    ← le déploiement / Docker
4. flags CLI (--workers, …)                   ← l'invocation
   le plus bas perd ; le plus haut gagne
```

Quatre niveaux (Spring en publie quinze). Studio affiche la **provenance par champ**
(défaut / surcharge app / env / flag) — réponse directe au « je vois rien ».

### D6 — Héritage projet consumer (`npm i nodefony`)

Le projet consumer a **les mêmes** `nodefony.config.ts` + `env.ts` (scaffoldés), **hérite**
automatiquement des défauts du core (`defaultAppConfig`) et de chaque module (leur Zod) par
deep-merge, n'écrit que ses **écarts**, et son devops surcharge par `NF__*`/`*_FILE` en Docker —
**sans toucher au code** du projet ni du framework. C'est le modèle Spring starter / Symfony bundle.

## Alternatives écartées

- **Statu quo (config.ts re-tape les défauts).** Cause de la double-source divergente (bug `timeCost`,
  CSP dupliquée). Rejeté : c'est le problème.
- **`_` simple comme séparateur d'override** (`NF_SECURITY_RATE_LIMIT_FREE_ATTEMPTS`). **Ambigu** avec
  le camelCase (`rate.limit.free.attempts` vs `rateLimit.freeAttempts`). Rejeté au profit de `__`.
- **Relaxed binding « magique » à la Spring** (tester plusieurs interprétations du nom contre le
  schéma). Trop implicite/difficile à débugger → contraire à l'exigence de simplicité. On garde `__`
  explicite (la résolution insensible à la casse suffit, sans deviner les frontières de mots).
- **Tout en env plat (12-factor strict), sans schéma.** Pas de typage, pas de validation, pas de
  structure, pas de provenance. Rejeté (limites documentées de 12-factor).
- **Config au build-time (valeurs baked dans l'image).** Casse _build once, run anywhere_ + force une
  image par environnement. Rejeté : la config s'injecte au **run**.
- **Hot-reload de la config par défaut.** Non : config **immuable au run**, un changement = nouveau
  déploiement (auditable, rollback atomique, conforme build/release/run). Le tag `hot|boot` par champ
  (déjà prévu) reste, le reload effectif est un raffinement futur, pas un défaut.

## Conséquences

**Positif**

- Fin de la double-source : le bug `timeCost` (3/2/1) et la CSP dupliquée **disparaissent
  mécaniquement** dès Slice 1.
- **Toute** la config surchargeable par env/Docker **sans code**, **validée par le Zod déjà écrit**.
- Précédence + provenance **explicites** → le « je vois rien » est traité à la racine.
- **Plus simple, pas plus** : on passe de 3 patterns (2/3/4 fichiers) + double-source à **1 pattern,
  1 source, 1 échelle, 1 spec d'override**. Clarifier = enlever. Le seul ajout (`NF__*`) est optionnel.
- Héritage consumer net (Spring/Symfony en TS) — prêt pour Nodefony-en-dépendance.

**Négatif / limites**

- Chantier de migration de tous les modules (par slices, cf plan) — mécanique mais transverse.
- L'override `NF__*` est une **nouvelle capacité à coder + tester** : parsing `__`, mapping
  insensible à la casse vers les clés du schéma, coercion robuste, `*_FILE`. Surface de tests à part
  entière (un mapping faux = config silencieusement ignorée).
- Risque de cycle `type ↔ builder` si `config.ts`/`defineXConfig.ts` sont mal séparés → mitigation D2
  (regrouper si nécessaire ; `security` tient déjà tout dans un fichier sans cycle).

**Plan d'implémentation (slices, 1 = 1 session)**

1. **S1 — `security` (modèle).** Vider `config.ts` des valeurs (règle d'or) → le bug `timeCost`/CSP
   meurt. Gate : `npm run build` + tests security verts.
2. **S2 — propager « 2 fichiers ».** Fusionner `schema.ts` (6 modules), créer `defineFrameworkConfig`,
   réduire `http` 4→2.
3. **S3 — couche cloud-native.** Implémenter `NF__*` (parse + coercion + mapping schéma) + `*_FILE`,
   au core (entre résolution de `nodefony.config.ts` et validation Zod) ; homogénéiser les stores
   (`NF_<X>_STORE` cohérents). Tests dédiés.
4. **S4 — Studio.** Provenance par champ (tag d'origine sur le merge) sur la page Configuration.

## Références

- Guide humain : [`docs/guides/configuration.md`](../guides/configuration.md) (mis à jour avec D2-D6).
- Code audité (preuves) : `src/packages/@nodefony/security/nodefony/config/{config.ts,defineSecurityConfig.ts}`,
  `env.ts`, `nodefony.config.ts` (racine), `src/nodefony/src/config/`.
- Veille modèles : Spring Boot (external config, relaxed binding, starters), Symfony (bundle
  `Configuration`, deep-merge, secrets vault), .NET Core (`Section__Key`), Grafana (`GF_<SECTION>_<KEY>`),
  Docker official images (`docker-entrypoint.sh`, `file_env`), 12-factor (factor III + ses limites).
- Mémoires IA : `project_config_clarity_chantier_kit`, `project_config_chantier_defineconfig_kit`.
- Règle perf/mémoire ABSOLUE (override résolu 1× au boot, 0 coût hot path) : `CLAUDE.md` racine.
