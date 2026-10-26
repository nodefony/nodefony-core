---
title: "nodefony-devkit-bench — fiche de skill"
navTitle: nodefony-devkit-bench
lang: fr
audience: [developer]
topic: skills
status: stable
updated: 2026-10-26
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-devkit-bench/SKILL.md"
---

# `nodefony-devkit-bench`

> Éprouve ce que Nodefony PRODUIT et ce qu'il fait CROIRE, par quatre mesures — le code généré tient-il debout (compilation, tests, HTTP réel), un agent lâché dans une application fraîche découvre-t-il l'outillage, le modèle de données d'un vrai logiciel libre est-il exprimable, et que conclut un agent qui lit le dépôt sans y entrer.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-devkit-bench**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **6/6** contrôles normatifs (MUST) · 🛡️ **3/3** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v1.5.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `1.5.0` |
| Famille | Autres |
| Corps | 498 lignes |
| Coût d'activation | ~8 916 tokens (le corps est chargé à l'invocation) |
| Description | 1014 / 1024 caractères |
| Déclencheurs | 0 |
| Ressources `references/` | 9 page(s) |
| Scripts | 20 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Éprouve ce que Nodefony PRODUIT et ce qu'il fait CROIRE, par quatre mesures — le code généré tient-il debout (compilation, tests, HTTP réel), un agent lâché dans une application fraîche découvre-t-il l'outillage, le modèle de données d'un vrai logiciel libre est-il exprimable, et que conclut un agent qui lit le dépôt sans y entrer. À charger AVANT de déclarer finie une évolution des gabarits, du moteur de génération ou des pages d'accueil : les assertions du dépôt lisent des chaînes dans des fichiers rendus — elles ne voient ni qu'un type généré ne compile pas, ni qu'un lecteur conclut le contraire de ce qu'on croit écrire. Déclencheurs - "j'ai modifié le scaffold", "le code généré compile-t-il ?", "est-ce que create entity marche encore ?", "rejouer le banc devkit", "l'agent trouve-t-il les générateurs ?", "un vrai schéma est-il exprimable ?", "combien de tours a pris l'agent ?", "un agent recommanderait-il ce framework ?", "que conclut un agent en lisant le dépôt ?", "notre accueil dit-il vrai ?".

## Prérequis

Ce que le décor doit fournir pour que ses scripts disent quelque chose : **serveur UP** · **redis** · **base de données** · **docker**.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`browser`](nodefony-browser.md) · [`framework-dev`](nodefony-framework-dev.md) · [`load-test`](nodefony-load-test.md) · [`release`](nodefony-release.md) · [`skill`](nodefony-skill.md)

## Ce que contient le corps

- Les DEUX buts — ne pas inventer, et ne pas tourner en rond
- Pourquoi trois bancs, et pas un
- Ce que les tests du dépôt ne peuvent pas prouver
- Les trois gros bancs — le protocole vit en `references/`
- Banc de schéma — un vrai modèle de données est-il exprimable ?
- Banc de portabilité — une app née en SQLite tient-elle ailleurs ?
- Banc de schéma réel — le kit tient-il un vrai logiciel ?
- Interpréter un échec — commencer par le décor
- Quand les lancer
- Quand passer la main
- Références

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/agents-et-porte-mcp.md` | Décor d'un run : quel AGENT, et quelle PORTE MCP | 386 |
| `references/banc-conformite.md` | Banc de conformité — l'application tient-elle les promesses du framework ? | 212 |
| `references/banc-decouvrabilite-lecons.md` | Banc de découvrabilité — leçons et études de cas | 662 |
| `references/banc-decouvrabilite.md` | Banc de découvrabilité — l'agent trouve-t-il ? | 253 |
| `references/banc-premiere-impression.md` | Banc de première impression — ce qu'un agent conclut du dépôt sans y entrer | 100 |
| `references/banc-schema-etudes-de-cas.md` | Banc de schéma — études de cas | 107 |
| `references/banc-verite.md` | Banc de vérité — le code généré tient-il debout ? | 230 |
| `references/methode-de-mesure.md` | Méthode de mesure — ce que le banc devkit a appris sur lui-même | 87 |
| `references/tache-zero.md` | La TÂCHE 0 du banc de découvrabilité — l'agent crée l'application | 226 |


## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/analyse-transcript.mjs` | Dépouille le transcript d'un agent — d'où qu'il vienne. | `--dialecte` `--echecs` `--grep` `--json` `--large` `--outils` `--timeline` | `USAGE` |
| `scripts/bench-discoverability.mjs` | Banc de DÉCOUVRABILITÉ du devkit — le gate de la release 10.0.0. | `--agent` `--all` `--allow-empty` `--analyze-only` `--ancien-args` `--answers-json` `--auth` `--check` `--check-port-free` `--cible` `--command` `--confirmer` `--corps` `--dangerously-skip-permissi` `--decor` `--depistage` `--describe-json` `--detach` `--diff-filter` `--dir` `--dry-run` `--enregistrer-reference` `--eval` `--example` `--format` `--frontend` `--hard` `--help` `--ignored` `--json` `--kind` `--left` `--link` `--max-parents` `--max-time` `--mcp-config` `--model` `--name` `--name-only` `--nf-login-` `--no-audit` `--no-check` `--no-fund` `--no-install` `--numstat` `--output-format` `--porcelain` `--porteur-args` `--preset` `--print` `--purge` `--repack` `--reset` `--rest` `--role` `--roles` `--route` `--runs` `--scope` `--selftest` `--setting-sources` `--setup-only` `--short` `--status` `--strict-mcp-config` `--task` `--temoin-args` `--temoin-mfa-args` `--ttl` `--unified` `--verbose` `--version` `--wait` `--yes` | `AGENT` `AGE_MAX_CONNEXION_S` `CANAL_OPS_ALERTES` `CHAMP_DEMANDE` `CONTROLLER_EN_PANNE` `CONTROLLER_RELU` `COULEUR_CONNEXION` `ENTITE_MIGREE` `FICHIER_RELECTURE` `JUGE_CSP` `JUGE_CSRF_PARTENAIRE` `JUGE_ENTITY_DELETE` `JUGE_LISTE` `JUGE_LOGIN_BRANDING` `JUGE_LOGIN_FRONT` `JUGE_LOGIN_RETURN` `JUGE_M2M` `JUGE_MCP_PORTE` `JUGE_MEDIA` `JUGE_MIGRATION` `JUGE_MODULE` `JUGE_PARAM` `JUGE_PREFIXE` `JUGE_REALTIME_CHANNEL` `JUGE_ROLE_HIERARCHY` `JUGE_ROUTE_RETABLIE` `JUGE_SCRIPT_API` `JUGE_SECURE` `JUGE_SESSION` `JUGE_STEP_UP` `JUGE_TACHE_ZERO` `JUGE_THROTTLE` `JUGE_UPLOAD` `JUGE_USER_FIELD` `JUGE_ZONE` `LINKED` `LOGO_CONNEXION` `LOTS_REINDEX` `MARQUE_CONNEXION` `MCP_REGIME` `NF_DEVKIT_BENCH_AGENT` `NF_DEVKIT_BENCH_AGENT_ARGS` `NF_DEVKIT_BENCH_AGENT_ENV` `NF_DEVKIT_BENCH_MCP` `NF_DEVKIT_BENCH_MODEL` `NF_MCP_TOKEN` `NOM_APP_TEMOIN` `ORIGINE_PARTENAIRE` `OUTIL_REINDEX` `OUTIL_STOCK` `PAGE_COMPTE` `PAGE_ESPACE` `PAGE_WIDGET` `PREPARE_BASE_MIGREE` `PREPARE_MODULE_ABSENT` `PREPARE_RELECTURE` `PREPARE_ROLE_HIERARCHY` `PREPARE_UTILISATEUR` `ROLE_FACTURATION` `ROUTE_ARTICLES` `ROUTE_COMMANDES` `ROUTE_COMPTE_FACTURES` `ROUTE_COMPTE_PROFIL` `ROUTE_DEPOT` `ROUTE_EN_PANNE` `ROUTE_FACTURATION` `ROUTE_IMPORT` `ROUTE_MACHINE` `ROUTE_MCP_APP` `ROUTE_RAPPORT_MACHINE` `ROUTE_RELUE` `ROUTE_SYNTHESE` `ROUTE_VIREMENT` `RUN_ROOT` `SCRIPT_RAPPORT` `TEXTE_SESSION_OUVERTE` `TITRE_SEME` `VAR_CLE_RAPPORT` `VAR_URL_RAPPORT` |
| `scripts/bench-discoverability.selftest.mjs` | Auto-contrôle des sondes du banc de découvrabilité — le juge, AVANT le verdict. | `--analyze-only` `--answers-json` `--describe-json` `--detach` `--dry-run` `--frontend` `--help` `--json` `--kind` `--limit` `--name` `--nf-login-` `--nf-login-brand` `--no` `--no-check` `--no-install` `--prove` `--yes` | `NF_CLE` |
| `scripts/bench-first-impression.mjs` | Banc de PREMIÈRE IMPRESSION — ce qu'un agent conclut du dépôt, sans y entrer. | `--answer` `--dangerously-skip-permissi` `--decor-only` `--keep` `--model` `--mount` `--out` `--prove` | `AGENT` `MODEL` `NF_DEVKIT_BENCH_AGENT` `NF_DEVKIT_BENCH_AGENT_ENV` `NF_DEVKIT_BENCH_MODEL` |
| `scripts/bench-portability.mjs` | Banc de PORTABILITÉ — une application NÉE en SQLite tient-elle sur les autres moteurs, dans le MÊME décor, en ne faisant que les gestes documentés ? | `--admin-` `--admin-mysql` `--column-case` `--config` `--database` `--detach` `--dialect` `--frontend` `--id` `--index` `--json` `--keep` `--name` `--no-audit` `--no-fund` `--no-install` `--no-timestamps` `--preset` `--repack` `--reuse` `--soft-delete` `--table` `--unique` `--wait` `--yes` | `APP` `DB_DEV` |
| `scripts/bench-real-schema.mjs` | Banc de schéma RÉEL — le kit de colonnes tient-il un logiciel écrit par d'autres, de bout en bout, sur chaque moteur ? | `--admin-` `--admin-postgres` `--database` `--frontend` `--json` `--keep` `--name` `--no-audit` `--no-fund` `--no-install` `--only` `--preset` `--profile` `--repack` `--yes` | `DB_APP` `DB_CONTRACT` `MATERIALIZER` `ONLY` `ROOT` `SPECS_FILE` |
| `scripts/bench-schema.mjs` | Banc de SCHÉMA — ce que la grammaire de champs ne sait pas exprimer. | `--allow-empty` `--analyze-only` `--dangerously-skip-permissi` `--database` `--detach` `--dialect` `--dir` `--dump-only` `--frontend` `--jq` `--json` `--link` `--model` `--no-audit` `--no-fund` `--no-install` `--output-format` `--preset` `--repack` `--schema` `--schema-only` `--setting-sources` `--setup-only` `--verbose` `--wait` `--yes` | `AGENT` `BENCH_DB` `DIALECT` `LINKED` `MODEL` `MOI` `NF_DEVKIT_BENCH_AGENT` `NF_DEVKIT_BENCH_AGENT_ARGS` `NF_DEVKIT_BENCH_AGENT_ENV` `NF_DEVKIT_BENCH_MODEL` `NF_MYSQL_URL` `NF_PG_URL` |
| `scripts/bench-schema.selftest.mjs` | Éprouve le BANC lui-même — avant qu'il ne juge quoi que ce soit. | `--allow-no-pg` `--database` `--dump-only` `--prove` `--schema` | `JUDGE_TABLE` `NF_PG_URL` |
| `scripts/build-devkit-report.mjs` | Construit la page « Un agent sait-il développer avec Nodefony ? ». | `--analyze-only` `--data` `--out` `--runs` | `DATA` `OUT` |
| `scripts/corpus-fetch.mjs` | Récupère le DDL MySQL d'ORIGINE d'un logiciel libre réel — un fichier par table (`*.sql`) et ses index et clés (`*.key.sql`) — dans un cache sous `tmp/bench/corpus/<nom>/`. | `--branch` `--corpus` `--depth` `--filter` `--no-cone` `--ref` `--refresh` `--sparse` | — |
| `scripts/jeton-mcp.selftest.mjs` | Auto-contrôle du JETON de la porte MCP — la durée de vie couvre-t-elle le run, et la ceinture voit-elle une porte sur le point de se fermer ? | — | — |
| `scripts/keycloak-login-probe.mjs` | Sonde — la connexion par Keycloak ouvre-t-elle une session dans CETTE application ? | `--app` `--username` `--password` `--ca` | — |
| `scripts/memoires-agent.selftest.mjs` | Auto-contrôle de la purge du cahier de mémoire que l'agent tient HORS du décor. | `--prove` | — |
| `scripts/mysql-ddl-to-specs.mjs` | Convertit un DDL MySQL réel (`*.sql` + `*.key.sql`) en descriptions d'entités NEUTRES — la grammaire du kit de colonnes (`colKit.spec.ts` de `@nodefony/drizzle`), sans un import d'ORM. | `--corpus` `--dir` `--out` `--table-prefix` | `ADDED_KEY` |
| `scripts/mysql-ddl-to-specs.selftest.mjs` | Auto-contrôle du convertisseur DDL MySQL → descriptions neutres. | `--coll` | — |
| `scripts/reinit-decor.selftest.mjs` | Auto-contrôle de la remise à zéro du décor — le mécanisme, AVANT de payer un agent pour s'en apercevoir. | `--allow-empty` `--format` | — |
| `scripts/selftests.mjs` | Lance TOUS les contrôles internes du banc, et rend un verdict unique. | `--prove` `--sans` | — |
| `scripts/suivre-run.mjs` | Suit un run du banc PENDANT qu'il se joue, au lieu d'attendre son rapport. | `--depuis` `--session` `--timeline` `--tout` | `NF_DEVKIT_BENCH_AGENT` `RACINE_RUNS` |
| `scripts/verify-generated.mjs` | Banc de VÉRITÉ du code généré — « ce que le scaffold produit tient-il debout ? » | `--admin` `--app` `--auth` `--ca` `--config` `--connector` `--controller` `--database` `--deny-warnings` `--detach` `--dialect` `--drop-accounts` `--env` `--exact` `--force` `--format` `--from-database` `--frontend` `--index` `--inject` `--input-type` `--issuer` `--json` `--jwt-keyset` `--keep` `--kind` `--link` `--module` `--name` `--no` `--no-audit` `--no-controller` `--no-e2e` `--no-fund` `--no-ignore` `--no-install` `--no-tests` `--nom` `--out` `--password` `--preset` `--profile` `--repack` `--resource` `--role` `--scope` `--service` `--ttl` `--unique` `--use-system-ca` `--username` `--wait` `--workspace` `--workspaces` `--write` `--yes` | `APP` `COMMAND_ACTION` `COMMAND_CLASS` `CONTROLLER_GARDE_CLASS` `DATABASE` `INJECTED_SERVICE` `KEYCLOAK_PORT` `MCP_LOCAL` `MCP_MIXTE` `MCP_OAUTH` `MODULE` `MODULE_PKG` `NF_DEVKIT_REQUIRE_DOCKER` `PASCAL_MODULE` `ROLE_GARDE` `SERVICE` `SERVICE_METHOD` |
| `scripts/verify-runtime.mjs` | Banc de CONFORMITÉ de l'application générée — « ce qui a été câblé tient-il les promesses du framework ? » | `--config` `--etage` `--keep` `--link` `--reporter` | `APP` |

**Invocation telle que documentée dans chaque script :**

```bash
node analyse-transcript.mjs <fichier> [--timeline] [--echecs] [--outils]
node bench-discoverability.selftest.mjs
node bench-first-impression.mjs                 # un run, décor sain
node bench-real-schema.mjs                          # sqlite, postgres, mysql, mariadb
node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.selftest.mjs
node scripts/build-devkit-report.mjs [--data docs/devkit/data/10.0.0.json] [--out tmp/devkit.html]
node corpus-fetch.mjs                     # corpus `erp`, cache réutilisé
node keycloak-login-probe.mjs --app <origine https> --username <u> --password <p> [--ca <PEM>]
node memoires-agent.selftest.mjs
node reinit-decor.selftest.mjs <runDir d'un run précédent>
node .claude/skills/nodefony-devkit-bench/scripts/selftests.mjs
node suivre-run.mjs                    # le run le plus récent
node scripts/verify-generated.mjs            # décor ISOLÉ + toutes les étapes
```

**Toutes les variables lues par ce skill** : `ADDED_KEY` · `AGENT` · `AGE_MAX_CONNEXION_S` · `APP` · `BENCH_DB` · `CANAL_OPS_ALERTES` · `CHAMP_DEMANDE` · `COMMAND_ACTION` · `COMMAND_CLASS` · `CONTROLLER_EN_PANNE` · `CONTROLLER_GARDE_CLASS` · `CONTROLLER_RELU` · `COULEUR_CONNEXION` · `DATA` · `DATABASE` · `DB_APP` · `DB_CONTRACT` · `DB_DEV` · `DIALECT` · `ENTITE_MIGREE` · `FICHIER_RELECTURE` · `INJECTED_SERVICE` · `JUDGE_TABLE` · `JUGE_CSP` · `JUGE_CSRF_PARTENAIRE` · `JUGE_ENTITY_DELETE` · `JUGE_LISTE` · `JUGE_LOGIN_BRANDING` · `JUGE_LOGIN_FRONT` · `JUGE_LOGIN_RETURN` · `JUGE_M2M` · `JUGE_MCP_PORTE` · `JUGE_MEDIA` · `JUGE_MIGRATION` · `JUGE_MODULE` · `JUGE_PARAM` · `JUGE_PREFIXE` · `JUGE_REALTIME_CHANNEL` · `JUGE_ROLE_HIERARCHY` · `JUGE_ROUTE_RETABLIE` · `JUGE_SCRIPT_API` · `JUGE_SECURE` · `JUGE_SESSION` · `JUGE_STEP_UP` · `JUGE_TACHE_ZERO` · `JUGE_THROTTLE` · `JUGE_UPLOAD` · `JUGE_USER_FIELD` · `JUGE_ZONE` · `KEYCLOAK_PORT` · `LINKED` · `LOGO_CONNEXION` · `LOTS_REINDEX` · `MARQUE_CONNEXION` · `MATERIALIZER` · `MCP_LOCAL` · `MCP_MIXTE` · `MCP_OAUTH` · `MCP_REGIME` · `MODEL` · `MODULE` · `MODULE_PKG` · `MOI` · `NF_CLE` · `NF_DEVKIT_BENCH_AGENT` · `NF_DEVKIT_BENCH_AGENT_ARGS` · `NF_DEVKIT_BENCH_AGENT_ENV` · `NF_DEVKIT_BENCH_MCP` · `NF_DEVKIT_BENCH_MODEL` · `NF_DEVKIT_REQUIRE_DOCKER` · `NF_MCP_TOKEN` · `NF_MYSQL_URL` · `NF_PG_URL` · `NOM_APP_TEMOIN` · `ONLY` · `ORIGINE_PARTENAIRE` · `OUT` · `OUTIL_REINDEX` · `OUTIL_STOCK` · `PAGE_COMPTE` · `PAGE_ESPACE` · `PAGE_WIDGET` · `PASCAL_MODULE` · `PREPARE_BASE_MIGREE` · `PREPARE_MODULE_ABSENT` · `PREPARE_RELECTURE` · `PREPARE_ROLE_HIERARCHY` · `PREPARE_UTILISATEUR` · `RACINE_RUNS` · `ROLE_FACTURATION` · `ROLE_GARDE` · `ROOT` · `ROUTE_ARTICLES` · `ROUTE_COMMANDES` · `ROUTE_COMPTE_FACTURES` · `ROUTE_COMPTE_PROFIL` · `ROUTE_DEPOT` · `ROUTE_EN_PANNE` · `ROUTE_FACTURATION` · `ROUTE_IMPORT` · `ROUTE_MACHINE` · `ROUTE_MCP_APP` · `ROUTE_RAPPORT_MACHINE` · `ROUTE_RELUE` · `ROUTE_SYNTHESE` · `ROUTE_VIREMENT` · `RUN_ROOT` · `SCRIPT_RAPPORT` · `SERVICE` · `SERVICE_METHOD` · `SPECS_FILE` · `TEXTE_SESSION_OUVERTE` · `TITRE_SEME` · `USAGE` · `VAR_CLE_RAPPORT` · `VAR_URL_RAPPORT`

### Détail des scripts auto-documentés

#### `scripts/keycloak-login-probe.mjs`


```bash
node keycloak-login-probe.mjs --app <origine https> --username <u> --password <p> [--ca <PEM>]
```

| Option | Rôle |
| --- | --- |
| `--app` | origine https de l'application (ex. https://localhost:5362) |
| `--username` | compte du realm |
| `--password` | son mot de passe |
| `--ca` | autorité qui signe les deux certificats (sinon : magasin |

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| en-tête analysable par un vrai parseur YAML | ℹ️ normatif | ✅ |  | spec § frontmatter : « YAML frontmatter » — un en-tête que YAML refuse n'est pas rendu par GitHub, alors que le parseur de l'agent, tolérant, l'accepte sans un mot |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 1014 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ✅ | 498 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-devkit-bench/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
