# Niveau 3 — A/B perf mono prod : détails

> Complète le `SKILL.md` (§ Niveau 3), qui garde sous les yeux la commande de base de l'A/B
> atomique. Cette page porte la cible de banc dédiée, la méthode du diff structurel, les
> pré-requis, les résultats déjà engrangés, la matrice de store et le banc comparatif de
> frameworks.
>
> **Maintenance** : édition en place. Les chiffres cités sont des mesures — les dater dans le
> texte serait un journal ; s'ils se périment, les remesurer et remplacer en place.

## Table des matières

- [La cible de banc applicatif](#-la-cible-de-banc-applicatif--une-seule-et-elle-est-faite-pour-ça)
- [Sonde in-situ scope/fabrique](#sonde-in-situ-scopefabrique--nf_perf_probe1)
- [Matrice store — memory vs sqlite](#matrice-store--memory-vs-sqlite-coût-du-backend-sur-route-authentifiée)
- [Banc comparatif frameworks](#banc-comparatif-frameworks-bench-frameworks-nodefony-vs-expressfastifynu)

### 🎯 La cible de banc applicatif — une seule, et elle est faite pour ça

**`GET /nodefony/kernel/bench`** (`BenchController`, `@nodefony/framework`), montée **uniquement**
sous `NF_BENCH_ROUTE=1` (zéro surface en production par défaut). Un controller ordinaire qui rend un
corps **figé** (`Object.freeze` — pas d'allocation par requête), sur un chemin **hors aire admin**
(pas de segment `/api/` → aucune zone firewall ne matche). Elle emprunte donc le trajet d'une route
applicative normale — routing, contexte, sérialisation, réponse — et **rien d'autre** : c'est ce
« rien d'autre » qui fait qu'on mesure le pipeline plutôt qu'un handler.

Le script la pose par défaut, avec son drapeau. **Ne pas lui substituer** :

| Substitut tentant               | Ce qu'on mesurerait à la place                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/nodefony/kernel/api/livez`    | + résolution de zone, + un authenticator, + le broker admin, + `getBootReport()` dans le handler                       |
| `/nodefony/test/als-test/state` | **un 404** : `@nodefony/test` est `policy:"dev"`, absent en production — et un 404 répond plus vite qu'une vraie route |

Seule exception : la comparaison **inter-frameworks** (`bench-frameworks/`), dont les apps
bare/express/fastify répliquent ce même payload et le décor de routing (186 routes, cible en #31) —
passer alors `BENCH_URL` explicitement.

### Sonde in-situ scope/fabrique — `NF_PERF_PROBE=1`

Quand un **profil échantillonné** impute un poste au pipeline (scope DI, fabrique de contexte),
sa répartition interne peut mentir (code inliné, builtins imputés à l'appelant) — et un
**micro-bench isolé** ment dans l'autre sens (heap froid, IC monomorphes). L'arbitre est la
**sonde in-situ** : des compteurs hrtime cumulés DANS le serveur réel sous wrk.

- **Activation** : `NF_PERF_PROBE=1` au spawn (flag lu 1× au chargement de `http-kernel.ts` ;
  éteinte = branche morte, zéro coût). Se combine au décor mono prod habituel.
- **Ce qu'elle mesure, par requête HTTP** : `enterScope`, `new HttpContext` (fenêtre totale),
  `leaveScope` — plus les **tranches internes de la fabrique** via des sous-marques dans les
  ctors `Context`/`HttpContext` : ctor `Service`, queue du ctor `Context`, lookup DI `upload`,
  `new Request`+`new Response`, queue du ctor `HttpContext`.
- **Lecture** : `GET /nodefony/kernel/bench/probe` (JSON, µs moyens) — `?reset=1` remet à zéro.
  **Toujours reset APRÈS le warmup wrk** pour ne pas diluer la mesure avec le code froid.
- **Overhead mesuré** : ~3 % de RPS sonde allumée ; chaque tranche inclut ~0,1 µs de borne hrtime.
- **Piège batterie** : les µs absolus se dilatent sur batterie (CPU bridé — RPS −25 % constatés
  à thermal 0) ; les **proportions** entre tranches restent décisionnelles, les absolus se
  publient depuis une fenêtre sur secteur.

Verdict de référence (celui qui a suspendu S2/S3 et réorienté D4) : poste total ~18,7 µs/req —
le profil avait raison sur le TOTAL, faux sur la répartition (`enterScope` réel ~2 µs, pas 17 % ;
les vrais postes : `new Request`+`new Response` ~47 % et ctor `Service` ~36 % de la fabrique).
`%HasFastProperties` innocente le dictionary mode du `protoService` (fast à 100 services).

**Diff STRUCTUREL sans toggle env** (RETEX 06-11) : flipper par
`git stash push -- <fichiers du diff>` / `git stash pop` — ⚠️ **le dist ne suit PAS le stash** →
rebuild du package après CHAQUE flip (new→stash→rebuild→old→pop→rebuild→new2…), et une dernière
fois après le pop final, sinon on benche l'autre code. **Verdict honnête = 3 issues** : gain net
(2 paires disjointes, > bruit ±5 %), structurel-gardé-en-le-disant (médiane positive MAIS
chevauchement → écrire « RPS bruit » dans le commit), ou rejet. Un levier profilé ~2 % est
INDISTINGUABLE du bruit machine → prévoir d'emblée l'argument structurel (Pdu/GC/closures).
Pour tout poste O(N) (scan routes…) : mesurer AUSSI un cas défavorable (fin de table) — un profil
mono-route position-dépendante ment (vécu : « 0,9 % » → +15,3 % NET une fois indexé).

🚨 **Pré-requis banc** (sinon mesures fausses — vécu) :

- **Ne pas rebasculer `@nodefony/test` en `policy:"optional"` pour bencher** : la cible dédiée
  (`/nodefony/kernel/bench`, ci-dessus) existe précisément pour éviter cette manipulation — et le
  revert qu'on oublie ensuite.
- `wrk` requis (`brew install wrk`) ; build à jour (`npm run build`) ; tuer les **Vite orphelins**
  (le script le fait : `pkill -f vite.js`) sinon throttle fantôme.
- Profilage CPU complémentaire (`node --prof` + `--prof-process`, piège macOS du faux symbole
  `BlobSerializerDeserializer`) : méthode complète en mémoire IA `reference_perf_profiling_method`.

Résultats engrangés avec ce banc (mono prod, route session-free) : **router-first +28 %**,
**retrait `setParameters("query.*")` morts +3.2 %** ; **différer le `JSON.stringify` audit −5.3 %**
(REJETÉ — le ring buffer paie un objet plus cher qu'une string → discipline A/B = ne garder que
le mesuré). L'audit complet reste ON par défaut ; `log.requestLogger.sampleRate` = levier opt-in.

### Matrice store — memory vs sqlite (coût du backend sur route authentifiée)

Valide que le choix de store (`NF_STORE`) se comporte comme attendu : `memory` est
~gratuit, `sqlite` (`better-sqlite3`, **sync**) paie un SELECT **bloquant** par reprise
de session. On compare une route qui TOUCHE le store à une route session-free (contrôle),
**INTRA-RUN** (même serveur → aucune dérive machine ; jamais comparer des absolus cross-run).

```bash
# 1 serveur par backend (start.sh propage process.env) :
NF_STORE=memory bash .claude/skills/nodefony-start-server/start.sh   # tout en memory
bash .claude/skills/nodefony-start-server/start.sh                   # défaut = sqlite (drizzle)
# Login → cookie de session, puis wrk (baseline + route session DANS LE MÊME run) :
JAR=$(mktemp); curl -sk -c "$JAR" -X POST \
  https://127.0.0.1:5152/nodefony/security/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"secret"}' -o /dev/null
COOKIE=$(awk 'NF>=7 && $6 ~ /nodefony/ {print $6"="$7}' "$JAR" | head -1)
wrk -t4 -c25 -d8s https://127.0.0.1:5152/nodefony/test/als-test/state              # contrôle session-free 0-ORM
wrk -t4 -c25 -d8s -H "Cookie: $COOKIE" https://127.0.0.1:5152/nodefony/security/api/auth/me  # reprise session/req
```

**Lecture (ce qui est LOGIQUE)** — comparer les RATIOS intra-run :

- `als-test/state` (contrôle) ~IDENTIQUE memory vs sqlite (ne touche AUCUN store) → un écart
  ici = **dérive machine**, PAS le store. ⚠️ NE PAS prendre `/nodefony/test/index` comme baseline
  (rend du HTML lourd → fausse le ratio).
- `auth/me` **memory** ≈ son propre `als-test/state` (Map.get ≈ gratuit, coût ~10 %).
- `auth/me` **sqlite** ~2× plus lent que SON baseline (le `.get()` `better-sqlite3` sérialise
  l'event-loop) → **memory ~1.9× sqlite** sur la reprise de session.
- Direction STABLE dans le temps ([[project_session_store_perf_finding]]) ; l'écart absolu a
  rétréci (6×→~2×) au fil des optims session (dirty-tracking, touch throttlé, modèle NIST). En
  prod multi-nœud le store async (`redis`) restaure le débit ; `better-sqlite3` reste mono-nœud.

### Banc comparatif frameworks (`bench-frameworks/`) — Nodefony vs Express/Fastify/nu

Sandbox **isolé** (`bench-frameworks/`, package.json propre, node_modules gitignoré — ne touche
PAS aux workspaces) : apps minimales **à conditions égales** (186 routes, route de bench en #31,
payload JSON identique à `als-test/state`, prod, logs off). Chiffre l'écart aux concurrents et le
ROI d'un chantier structurel AVANT de l'engager.

```bash
cd .claude/skills/nodefony-load-test/bench-frameworks && npm install   # 1er usage
bash bench.sh bare 5161 ; bash bench.sh express 5162 ; bash bench.sh fastify 5163
FASTIFY_SCHEMA=1 bash bench.sh fastify 5163 FASTIFY_SCHEMA=1           # fast-json-stringify
# Nodefony via bench-ab-mono.sh (flip policy module test, cf pré-requis ci-dessus)
```

**Mesuré 2026-06-11** (mémoire IA `core-dev/audits/bench-frameworks-2026-06.md`) : nu **23 985** · Fastify
**20 782** (schema neutre) · Express **11 740** · **Nodefony 5 264** RPS. Décomposition :
Nodefony→Express ×2,23 = **coût par requête** (Express scanne linéairement AUSSI → pas le
routing) ; Express→Fastify ×1,77 = index radix. → fast path : attaquer le coût/req AVANT
l'index de routes. ⚠️ Fenêtre : re-bencher une cible en fin de série (dérive ≤ ~2 % = propre).
