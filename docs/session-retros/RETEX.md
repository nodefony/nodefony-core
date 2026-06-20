# RETEX.md — digest des retours d'expérience (SAS, lu à chaque début de session)

> **Rôle** : ce fichier est le **sas** entre les retex bruts (`docs/session-retros/<date>-<id>.md`,
> jamais relus seuls) et les leçons durables (mémoires `feedback_*` indexées dans `MEMORY.md`).
> Il porte les **frictions récentes pas encore confirmées** (vues 1-2×). Le skill `nodefony-session`
> le **lit au START/RESUME** et le **met à jour au END** (ajout de 3-5 bullets du jour, par thème).
>
> **Règle anti-doublon (CRITIQUE)** : une leçon est **soit** ici (sas, non confirmée), **soit** en
> `feedback_*` (graduée, prouvée). **JAMAIS les deux.** Quand une friction atteint **3×** → mode
> CONSOLIDATE la promeut en `feedback_*` et la **retire d'ici**. Sinon dérive garantie (cf l'anti-pattern
> « liste dupliquée » que dénonce `nodefony-check-externals`).
>
> **Taille bornée** : ce fichier ne grossit jamais. Deux sorties (gérées par CONSOLIDATE, tous les
> 10-20 retex) : (a) friction ≥3× → graduée en `feedback_*` puis retirée ; (b) retex bruts vieillis →
> `archive/` + 1 ligne de résumé ici. Cible : ~1 écran. Format = bullet `[N× — date courte]` par thème.

---

## 🏎️ Perf / bancs A/B

> ♻️ CONSOLIDATE 2026-06-12 : les patterns A/B (mono-route ment / verdict 3 issues / stash+rebuild
> par flip / banc concurrent bench-frameworks) sont **gravés dans `nodefony-load-test` SKILL.md**
> (niveau 3) — retirés d'ici (anti-doublon). Restent les leçons non couvertes :

- `[1× — 2026-06-11]` **Optimiser en RÉDUISANT l'ensemble scanné, sans toucher la logique de match** :
  l'index de routes ne court-circuite jamais `resolver.match()` (merge ordonné par position, skip des
  seules candidates qui ne POUVAIENT pas matcher) → sémantique préservée par construction, banc 25
  invariants vert du 1ᵉʳ coup, 0 itération de débogage. Pattern : prouver « skip inobservable » (pas
  d'effet de bord avant hit) plutôt que réécrire la sémantique dans la structure d'index.
- `[1× — 2026-06-11]` **« 1× par socket » naïf = piège keep-alive** : node RÉ-ARME socket.setTimeout aux
  transitions keep-alive (server.timeout 120 s ↔ keepAliveTimeout 5 s) → tout état posé « une fois par socket »
  peut être écrasé dès la requête 2. Toujours re-vérifier la valeur par requête (check conditionnel cheap).
- `[1× — 2026-06-14]` **Sync/async = débit vs concurrence (test discriminant)** : un store/op SYNCHRONE
  qui bloque l'event-loop donne un débit PLAT quand la concurrence monte (mesuré : reprise session
  better-sqlite3 ~400 RPS de c=5 à c=50) ; de l'I/O async MONTE avec la concurrence (redis ~1900, ×4,7).
  Pour qualifier « est-ce sync-bloquant ou CPU pur ? » → bencher c=5/10/25/50, pas un seul point.
- `[1× — 2026-06-14]` **Bench « coût de la sécu » = isoler firewall vs store** : le coût d'une requête
  authentifiée était à ~98 % la **reprise de session** (SELECT store), pas le firewall (~gratuit, −6 % sur
  rejet 401). Toujours décomposer (route hors-zone vs en-zone vs session-hors-zone) avant d'accuser la sécu.
  Réflexe AVANT d'hypothéser le store : `grep "SESSION STORAGE active"` (perdu 2 hypothèses faute de l'avoir fait).

## 🐚 Shell / environnement d'exécution

- `[1× — 2026-06-20]` **Parsing de sortie d'outil système → forcer `LC_ALL=C`.** `ps -o pcpu` formate `%CPU` avec une VIRGULE décimale en locale FR (`0,0`) → regex `[\d.]` ne matchait pas → 0 process détecté (faux « aucune instance », bug silencieux). Fix : `env: {LC_ALL:"C", LANG:"C"}` au spawn + parse tolérant `,`. Vaut pour TOUT `ps`/`df`/`date`/`numfmt` parsé.
- `[3× — 2026-06-13, 2026-06-14, 2026-06-19]` **variable shell multiligne/espacée NON quotée passée à grep = erreur
  trompeuse « No such file or directory »** : `NEW="a.ts b.ts"` puis `grep motif $NEW` → en **zsh** `$VAR` ne
  word-split PAS (chaîne entière = 1 nom) ; en bash multiligne = re-split n'importe comment (ugrep concatène 2
  chemins). + le `|| echo "0…"` de garde donne un **faux négatif rassurant**. → lister les fichiers EXPLICITEMENT
  en arguments (fait), ou `xargs grep` ; jamais `$VAR` nue en argument multi-chemins. Re-vécu J4 (7 fichiers neufs)
  puis **P6.12** (scan revue sécu zsh). **Bonus ugrep** : pas de lookahead `(?!...)` → filtrer en 2 temps
  (`grep | grep -v`). **→ 3× : candidat graduation `feedback_shell_no_unquoted_multipath`.**
- `[1× — 2026-06-12]` **un subagent background hérite des permissions de la session → sa veille web peut être
  refusée silencieusement** : l'agent « état de l'art auth » s'est vu refuser WebSearch/WebFetch/Bash → livré
  100 % connaissance interne (cutoff) en le signalant. → avant de déléguer une veille web, vérifier qu'une
  requête réseau passe (1 WebFetch direct en session), sinon assumer la veille offline + marquer les statuts
  de drafts « à re-vérifier ».
- `[1× — 2026-06-12]` **`grep -c` qui compte 0 = exit 1 → saute silencieusement la suite d'une chaîne `&&`** :
  `npm run build | grep -c "warn" && start.sh` → build vert, 0 warning… et le start.sh n'a JAMAIS tourné
  (exit 1 du grep). Ne jamais chaîner `&&` derrière un `grep -c` dont 0 est le résultat ATTENDU (séparer
  les commandes, ou `|| true`).
- `[1× — 2026-06-12]` **`git stash` peut réussir l'ENTRÉE puis échouer le reset (index.lock) → stash DUPLIQUÉ,
  arbre intact, `pop` refuse** (« local changes would be overwritten »). Vérité avant tout drop :
  `git stash show -p | git apply --check --reverse` — passe = l'arbre contient déjà exactement le stash
  → `git stash drop` sûr, AUCUNE perte. Ne jamais `checkout`/`reset` pour « débloquer » un pop qui refuse.

> ♻️ CONSOLIDATE 2026-06-12 : **gradués/couverts, retirés d'ici** — `Edit` exige `Read` (4×) →
> [[feedback_edit_requires_read_tool]] · cwd persiste / `cd X && cmd1 ; cmd2` (5×+) →
> [[feedback_cd_startsh_relative_path]] enrichie · ENOSPC fantôme + shell instable sous charge →
> skill `nodefony-debug` recette F.

- `[1× — 2026-06-11]` **`replace_all` peut réécrire le corps de la méthode qu'on vient d'INTRODUIRE** : T4c,
  extrait `fireRequestEnd()` contenant `return this.context.fireAsync("onRequestEnd", this)` PUIS `replace_all`
  de ce même appel vers `this.fireRequestEnd()` → la méthode s'appelle elle-même = récursion infinie (Maximum
  call stack au 1er hit). Attrapé par le HEALTH check du start.sh (500). → quand on extrait une méthode puis
  qu'on `replace_all` les call sites, EXCLURE la nouvelle méthode (ordre inverse : replace_all D'ABORD, extraire
  ENSUITE — ou re-vérifier son corps après).
- `[1× — 2026-06-10]` **client/preuve WS standalone = `WebSocket` GLOBAL natif (Node ≥ 22), PAS le package `ws`** :
  `import WebSocket from "ws"` depuis un `.mjs` sous `src/modules/*/nodefony/poc/` → `ERR_MODULE_NOT_FOUND` (ws
  non résolvable à cette profondeur). Le global natif marche sans dép — **API WHATWG** : `ws.addEventListener("message",
e => JSON.parse(e.data))` (string), `.send()`, PAS `.on()`.
- `[1× — 2026-06-06]` **daemon `claude daemon run --origin transient` zombie à ~96 % CPU pendant ~11 h** (le user
  en voyait 4) : un daemon claude détaché peut rester hung et saturer le CPU. → `ps -Ao pid,%cpu,etime,command | grep
claude` au moindre doute perf machine ; **le USER tue** le daemon transient hung (`kill <pid>`) — ne pas tuer un
  process claude depuis la session active. Le serveur dev (nodefony+vite) à 0 % CPU n'était PAS le coupable.
- `[2× — 2026-06-12]` **tmpfs du harness sature (ENOSPC) ≠ disque plein** : rediriger les gros logs (build turbo ~1m24, suites
  vitest 7000+ lignes) vers `/tmp/x.log` remplit le **filesystem temp dédié du harness** (`/private/tmp/claude-*/.../tasks`,
  petit quota) alors que `df` du disque montre 3 To libres → les Bash suivants échouent « ENOSPC ». → rediriger vers `/dev/null`
  - `grep` le résultat, ou `> /tmp/x.log` PUIS `rm` aussitôt après extraction. Ne pas accumuler les logs verbeux.
    Re-vécu J2 (builds turbo répétés) ; dépannage : `rm /private/tmp/claude-*/.../tasks/*.output` (tâches finies) débloque.

## 🎨 Front / Studio / UX

- `[1× — 2026-06-17]` **GPU à fond (ventilation) sur un dashboard live = chercher l'animation PERMANENTE de `box-shadow`/`filter`/`backdrop-filter`, pas le re-render.** Coupables sur `/nodefony/supervision` (90 %→63 %) : (a) `.nf-live-card` animait un `box-shadow` **glow en boucle infinie** = **copie DIVERGENTE** de styles live (`utils/ormFormat.ensureLivePulseStyle` ≠ `components/ui/FlashValue.ensureLiveStyles`, déjà passée opacity + anneau statique) → 2 définitions du même `.nf-live-card`, la dernière injectée dans `<head>` gagne (non-déterministe) ; (b) `LoadingOverlay overlayProps={{blur}}` = **backdrop-filter caché** ; (c) page **3315 lignes sans `contain`** → un tick repeint toute la page (+ LCP render delay ~4 s en dev). Fix : styles live compositor-only + `prefers-reduced-motion`, retrait `blur`, `contain:content` sur la brique partagée `KpiCard`. **Dette** : fusionner les 2 sources de styles live en une.
- `[1× — 2026-06-17]` **un `<style>` injecté-une-fois (flag de garde) n'est PAS retiré par le HMR Vite** → après un fix CSS, l'ANCIENNE règle (animation) reste dans `<head>` et tourne toujours → le fix « ne se voit pas » tant qu'on n'a pas **hard-reload** (Cmd+Shift+R). Exiger le hard-reload avant de juger un fix de style insuffisant. Diag perf navigateur = **user-driven** (gestionnaire GPU / Paint Flashing / LCP — pas de headless, règle projet) ; test discriminant le plus rapide = **couper « Temps réel »** (GPU retombe ⇒ rendu live ; reste haut ⇒ coupable statique).

- `[1× — 2026-06-15]` **UX login multi-credentials = modéliser « ce compte A-T-IL un mot de passe ? », PAS
  « quel était le dernier mode »** (rebonjour social/passkey/mdp — 3 allers-retours, user « on a perdu la
  logique !! »). Erreur intermédiaire : masquer le champ mdp pour un compte passkey → BLOQUÉ (un passkey est
  une commodité EN PLUS, le compte garde son mdp). Bonne règle : **social** = sans mdp → bouton fournisseur
  seul ; **passkey** = passkey primaire + **choix EXPLICITE « se connecter avec un mot de passe »** (révélé à
  la demande) ; **mdp** = champ. « Changer » repasse au mdp. Mémoriser le mode (social promu sur SUCCÈS via
  marqueur transient, pas au clic → une annulation ne fausse pas l'affichage). UI honnête = n'afficher que les
  providers découverts ET brandés (`SOCIAL_META`) → exclut la fixture dev `test-oidc`.
- `[1× — 2026-06-15]` **feature à TEST VISUEL ITÉRATIF (auth/sessions) → persistance dès le DÉBUT en dev, pas
  un store volatile** (J9). Le store credentials en MÉMOIRE était vidé à CHAQUE restart serveur ; comme je
  redémarrais pour chaque fix, le passkey enregistré par le user était perdu à la passe suivante → « rien ne
  marche / verification failed » (3-4 cycles perdus, frustration). → dès qu'une feature se teste par
  ré-enregistrement + ré-login MANUEL (le user clique), prévoir le **driver persistant (fichier)** d'emblée
  (atomique tmp+rename + flush `onTerminate`), pas après N pertes. Bonus : ça force un store propre + testable.
- `[1× — 2026-06-13]` **Écran VITRINE (login) = N itérations UI si on improvise le rendu** (~12 allers-retours
  user sur le seul login cette session). Pour un écran « vu en premier », faire un **mini-cahier des charges
  VISUEL validé AVANT** (structure + comportement des erreurs + responsive + ce qui doit/ne doit PAS bouger),
  pas improviser. Renforce [[feedback_session_hygiene]] (mini-cahier amont) — cas spécifique « vitrine ».
- `[1× — 2026-06-13]` **Layout shift d'erreur = anti-pattern ergo MAJEUR** (senti 3× par le user, jusqu'à
  « c'est pas la souris, c'est mon ŒIL qui bouge »). Recette zéro-saut : (a) **TOUTES** les erreurs (auth ET
  validation de champ) dans **UNE zone à hauteur RÉSERVÉE** (`mih` fixe) ; **JAMAIS** d'erreur inline Mantine
  sous le champ (`error=`/`validate` poussent le form), ni au-dessus (recentrage), ni en bas (l'œil descend) ;
  (b) zone **EN HAUT** près du regard ; (c) centrage vertical conservé car hauteur constante (réserve) →
  `justify-content: safe center` ne saute plus. Détail gravé → skill `nodefony-studio-dev`.
- `[1× — 2026-06-13]` **Overlay plein écran qui RAME la machine (Brave) au switch de fenêtre** = `backdrop-filter:
blur` plein écran (paint GPU permanent, recomposé même onglet caché) + `setInterval` re-render sans pause. Fix :
  **0 `backdrop-filter`** + **Page Visibility** (couper tick + animations quand `document.hidden`) +
  `prefers-reduced-motion`. Règle : tout widget/overlay animé se **met en pause quand l'onglet est caché**.
- `[1× — 2026-06-13]` **Login moderne sûr** : identifier-first **sans appel serveur à l'étape 1** (anti-énumération
  OWASP) ; **429 throttle = NON réessayable** (countdown + bouton désactivé) ; erreurs **classées** (credentials
  générique / réseau / serveur / throttle) `role="alert"`, s'efface à la frappe ; méthodes alternatives (SSO
  Keycloak / Passkey WebAuthn) visibles **aux 2 étapes** (sinon invisibles en « rebonjour » qui démarre au mdp).

## 🔌 Conception — dépendances tierces & arbitrage de design

- `[1× — 2026-06-18]` **Quand un design bute sur une limite d'INFRA, corriger l'infra — ne PAS dégrader le design pour la contourner.** CSRF étape 2 : `Response.setCookies()` n'émettait qu'UN `Set-Cookie` (boucle de `setHeader('Set-Cookie', str)` → Node REMPLACE, seul le dernier survit ; **prouvé** par un node one-liner ; AUCUN test ne le couvrait). J'allais router AUTOUR (token CSRF header-only, sans cookie) → le user a tranché « il n'y a pas de test double cookies !!! ». Le VRAI problème était le bug du flush. Fix : `setCookies()` batch en TABLEAU → N lignes `Set-Cookie` (session + csrf coexistent) + test 0/1/2 cookies + preuve e2e double cookie. **Leçon : signaler explicitement au user le bug d'infra découvert plutôt que livrer un design appauvri qui l'évite en silence.** Le user flaire le trou de test.
- `[1× — 2026-06-15]` **Dev = UN SEUL host (`localhost`), jamais `127.0.0.1`** : WebAuthn/passkeys REFUSENT une
  IP comme `rpId` (seul `localhost` ou un vrai domaine). Avoir mis le callback OAuth par défaut en `127.0.0.1` a
  CASSÉ le passkey (rpId=localhost ≠ page 127.0.0.1 → `SecurityError`, mal classé « réseau » par classifyError —
  un `SecurityError` WebAuthn n'a pas de `status` HTTP). Règle : callback OAuth + rpId WebAuthn + cookie de
  session partagent le MÊME host → défaut dev `https://localhost:5152`.
- `[1× — 2026-06-15]` **GitHub : OAuth App (`client_id` `Ov…`) ≠ GitHub App (`Iv…`)** — pour un social login c'est
  une **OAuth App** ; une GitHub App ignore les scopes + règle son callback ailleurs → « redirect_uri is not
  associated ». Diagnostiquer un OAuth tiers = LIRE le `client_id` / l'URL d'autorisation, pas deviner.
- `[1× — 2026-06-15]` **Config d'un provider social = niveau APP, pas le package générique** (user « config dans
  studio, pas la racine » → mais `@nodefony/studio` est un package réutilisable). Secrets + CHOIX des fournisseurs =
  décision de DÉPLOIEMENT. Une config de MODULE est un objet statique (ne lit pas `ctx.env`) → lire `process.env`
  dans un package = mauvais (viole sa propre règle « seul env.ts lit process.env »). Solution : **extraire** dans
  `config/oauth.ts` app-level (recette #6) — racine propre, env propre, package générique. + **surcharges PAR
  FOURNISSEUR** (redirect/rôles) pour qu'un provider réel coexiste avec la fixture E2E `test-oidc` SANS toucher le
  banc (le deep-merge `extend(true,{})` ferait gagner l'override de module sur les scalaires globaux → le
  per-provider contourne le conflit ; vérifié : oauth2-flow 6/6 intact).
- `[1× — 2026-06-15]` **Lib tierce = cerner son PÉRIMÈTRE exact** (arctic, OAuth2 J9 ; user a challengé « si arctic
  donne 50 providers il faut en coder 50 ?! »). arctic gère le **protocole** (URL d'autorisation + échange de tokens)
  mais **PAS le profil utilisateur** (Google = decode idToken OIDC ; GitHub = fetch `/user`+`/user/emails`). → un
  **helper générique** (OIDC mutualisé) + un **registry pluggable** : on ne code QUE les fournisseurs offerts clé-en-main
  (Google/Keycloak/GitHub), pas les 50 ; le mapping profil = la SEULE valeur ajoutée. Toujours répondre « ce que la lib
  fait » vs « ce qui reste » AVANT de coder.
- `[1× — 2026-06-15]` **Avant d'« arbitrer » un design, chercher la CONTRAINTE déjà gravée** (Shadow User persisté vs
  virtuel) : pas un choix esthétique — **forcé** par une décision antérieure (re-fetch BFF J3 : la session stocke
  l'identifiant et re-résout l'user à chaque requête → un user non persisté = 401). La « bonne » réponse était déjà
  écrite dans le code. Réflexe : grep décisions/code amont AVANT de présenter un choix au user.
- `[1× — 2026-06-15]` **Extensibilité ≠ tâche planifiée** (auto-correction LDAP, user « tu es sûr ? ») : présenter
  « l'archi le permet en plugin » comme « c'est prévu » = faux. Distinguer **capacité d'extension** (gratuite, propriété
  de `IUserProvider`/`IAuthenticator`) vs **travail au programme** (« pas de consommateur → on ne construit pas »). LDAP :
  vraie réponse 2026 = via Keycloak/OIDC (fédère LDAP) ; client LDAP direct = jamais sauf besoin réel rare.
- `[1× — 2026-06-15]` **Test rouge → curl/prouver l'ÉTAT RÉEL avant d'accuser le code** (banc oauth2-flow `/me` undefined) :
  curl du flux → le code marchait (session BFF + Shadow User OK), c'était mon **assertion** qui était fausse (`/me` rend
  `{user:{…}}`, pas `{username}`). Sur un banc NEUF rouge, suspecter d'abord le test (forme présumée), pas le code. Le même
  banc a aussi exposé un VRAI bug (InMemoryUserRepository.create ignorait `socialProviders` → find-or-create cassé, invisible
  en unit) → re-confirme « banc réel > unit à stubs ».

## 🧩 Archi / isomorphisme

- `[1× — 2026-06-18]` **`Resolver.match` (qui pose déjà `sessionIntent` au resolve) = le seam CANONIQUE de tout décorateur "policy lue par le firewall/pipeline".** Recette gravée (réutilisée 2× en 1 session pour `@Csp` ET `@CsrfProtect`/`@CsrfExempt`) : (1) décorateur écrit une métadonnée Reflect (classe+méthode, dual) ; (2) `computeActionMeta` la mémoïse sur `route.actionMeta` (1 lecture Reflect/route, 0 par requête) ; (3) `Resolver.match` pose `context.<flag>` au match (écrit SEULEMENT si vrai → champ `false`/`null` par défaut, 0 alloc hot-path) ; (4) le consommateur (firewall) lit `context.<flag>` POST-resolve. Chaque nouveau décorateur de ce type = ~1 passe, 0 surcoût. Tout décorateur de policy futur (`@RateLimit`, `@AuditLog`…) suit ce moule.
- `[1× — 2026-06-18]` **Pose d'un effet cross-module quand un seul module possède le type** : `@nodefony/security` ne peut pas `new Cookie()` (import RUNTIME de http interdit, cycle). Solution = **le module qui MINTE la donnée la pose sur le `context` ; le module qui POSSÈDE le type fait l'objet**. CSRF : le firewall (security) mint le token → `context.csrfToken` ; `HttpContext.writeHead` (http) crée le `Cookie` lisible depuis ce champ. Généralise au-delà des cookies (tout artefact dont la classe vit dans un module amont).
- `[1× — 2026-06-13]` **Un doc-comment qui AFFIRME un câblage ≠ le câblage réel** (devise « confiance n'exclut pas
  contrôle ») : `IRealtimePeer` dit « `RealtimeClient` compose le même `JsonRpcPeer` » → **FAUX**, le client
  réimplémente son propre JSON-RPC partiel (pas de `register`/callee, pas de seams `beforeDispatch`/audit). Cause =
  chronologie (prouvée `git log --diff-filter=A`) : client **antérieur de 5 j** (18/05) au moteur isomorphe (23/05),
  refactor jamais fait. Dette **L0** = brancher le `JsonRpcPeer` interne au client → `register` + seams isomorphes.
- `[1× — 2026-06-13]` **Série socket isomorphe L0→L4 LIVRÉE** (`d0934fa0`/`9a51438f`/`40684721`/`f428d2cd`) : L0 client
  compose le peer (dette ci-dessus close) ; L1 `RealtimeController.requestClient`/`notifyClient` (duplex S→C par
  connexion) ; L3 `RealtimeController<Emit, Actions>` **générique à défauts permissifs** (0 casse des sous-classes ;
  ⚠️ TS6133 sur un type param inutilisé → ne garder QUE les params réellement référencés, j'ai retiré `Listen`) ;
  L4 façade serveur `ServerRealtimeSocket implements IRealtimeSocket` au-dessus du hub. `request` côté hub = **pas de
  pair unique** (multi-clients) → non supporté, renvoie vers `requestClient`. L5 (mutations via `api.request`) = post-P6.
- `[1× — 2026-06-14]` **un contrat « portable » cache des pièges de moteur — les lire AVANT de transposer** (3 stores
  `ITokenStore` Drizzle/Mongoose/Redis) : (a) `IS NULL` **inexprimable** via le critère portable — `eq(col, null)` est
  toujours faux en SQL ; heureusement Mongo applique le **type bracketing** (`$lte:number` n'inclut pas les `null`) →
  les DEUX convergent, donc un `gc` portable (`delete {expiresAt:{$lte}}` + `find {revokedAt:{$lte}}` puis filtre JS
  `expiresAt===null` + `delete {id:{$in}}`) marche sur les 2 SQL/NoSQL sans descendre au natif ; idempotence de `revoke`
  (ne pas écraser la 1ʳᵉ date) = **read-then-write** (pas de critère `revokedAt:null`). (b) Le contrat orm-core
  **hijacke `id`→`_id`** (`MongooseRepository#resolveField`) : pour un id **fourni par l'appelant** (jti ≠ ObjectId auto),
  il FAUT poser `_id` explicitement à l'écriture (`create({_id:id,...})`) et **normaliser `id`←`_id`** en lecture (ne pas
  dépendre du virtuel). Lu dans le code du repo AVANT de coder → 0 itération.
- `[1× — 2026-06-14]` **Redis : HASH > blob JSON pour un record dont 1 champ est écrit à chaque usage** (user a challengé
  « tu enregistres le json ? ») : `markUsed` (lastUsedAt/ip/ua à chaque requête authentifiée) en `HSET` partiel **préserve
  le TTL de la clé** et ne réécrit pas le record (vs read-parse-rewrite d'un blob `SET KEEPTTL`). TTL natif (`EX`/`EXPIRE`)
  → `gc()` est un **no-op** (refresh par leur exp, PAT révoqué reçoit `EXPIRE=rétention` au revoke, denylist par EX) — la
  maintenance se délègue au moteur, contrairement à Drizzle/Mongoose qui balaient.
- `[1× — 2026-06-14]` **tester un TTL sans serveur = double à horloge injectée** : `FakeRedis implements RedisClientLike`
  (sous-ensemble structural des commandes v6) modélise `EX`/`EXPIRE` contre un `now()` contrôlé → expiration **déterministe**
  (avancer `CLOCK`, le double purge à la lecture), + un smoke `describe.skipIf(!REDIS_TEST_URL)` contre un vrai Redis pour
  prouver les **noms de commandes** node-redis v6 (le double seul ne le prouve pas — cf leçon « stubs ne prouvent pas »).
  Piège mesuré : un `gc`/compteur sur store **partagé entre `describe`** dérape (résidu d'un test précédent expiré) → **pré-purger** avant de mesurer un delta exact.

- `[1× — 2026-06-14]` **vérifier le CODE de la lib, pas le plan/cheat-sheet** (devise) : jose v6 exige
  `generateKeyPair("Ed25519", {extractable:true})` (pas `"EdDSA"` que disait le kit ; `extractable` requis pour
  `exportPKCS8`) ; header JWT + allowlist verify restent `"EdDSA"` (JWA RFC 8037). Un script end-to-end
  (génère→exportPKCS8→importPKCS8→sign→verify + reject aud/alg) lancé AVANT de coder a tranché 3 ambiguïtés et
  donné 0 itération. Lire les `.d.ts` + 1 run > présumer depuis le kit.
- `[1× — 2026-06-14]` **jitter d'un timer périodique = décaler la PHASE, pas l'intervalle** : `setInterval` est
  fixe ; pour étaler N timers en cluster, `setTimeout(initial + random)` PUIS `setInterval(base)` → phase décalée
  CONSTANTE (l'intervalle variable dérive/bat). `+ .unref()` = n'empêche pas l'arrêt. Corollaire cloud-native : un
  gc périodique a un **point d'entrée public** (`runGc()`) pour déléguer à un ordonnanceur externe (cron P5.0b) —
  store LOCAL (memory/file) = timer par-process OBLIGATOIRE (mémoires disjointes), store PARTAGÉ (ORM) = un seul
  balayeur (cron worker / élection). Le user a fait remonter ce dernier point (« on a un cron à faire »).
- `[1× — 2026-06-14]` **tester un Service Nodefony hors serveur** : le `Service` fait `this.kernel = container.get("kernel")`
  → fournir un VRAI `Container` + un faux kernel `{container, once(ev,cb){…}}` qui CAPTURE `onBoot`, puis déclencher le
  handler = exécuter `#build` à la demande (store/keystore RÉELS posés au container, pas de stub) ; `notificationsCenter:false`
  coupe les events. Banc d'intégration déterministe (émission/rotation/reuse/gc prouvés) sans démarrer de serveur.
- `[1× — 2026-06-15]` **transposer le frère VIVANT > croire le commentaire d'un registry** (drivers WebAuthn store
  Redis/Drizzle/Mongoose, J9) : le doc du `webAuthnCredentialStoreRegistry` disait « les adapters s'enregistrent depuis
  LEUR module » → laissait croire à un couplage runtime backend→security. FAUX. Le frère vivant `RedisTokenStore` (J4b)
  révèle l'**approche B** : l'adapter vit dans le module backend en `import type` SEUL (effacé → 0 dép runtime, **0 modif
  package.json**, le workspace résout le type), exporte la classe, et c'est **l'app** qui `registerXStore(...)`. Lire le
  frère le plus récent (pas le commentaire générique d'un registry) a tranché l'archi en 1 passe — 3 adapters + entités +
  34 tests, build/non-rég verts du 1er coup. (Variante de la leçon `[06-13]` « doc-comment ≠ câblage réel ».)
- `[1× — 2026-06-15]` **copier le frère SANS le copier aveuglément — diverger quand le CONTRAT l'exige** : `DrizzleTokenStore`
  renvoie la row du repo DIRECTEMENT (`IAccessTokenRecord` = AccessTokenRow, tout `| null`, 0 readonly) → 0 mapping. Mais
  `IWebAuthnCredential` a `nickname?` (optionnel, ≠ `| null`) + champs `readonly` → une row `{nickname:null}` ne satisfait
  PAS `nickname?: string` et casse `deepEqual` en test. Solution : `WebAuthnCredentialRow` plate (`nickname: string|null`) +
  mapping `#toCredential`/`#toRow` (null→omis). Comprendre POURQUOI le frère ne mappe pas AVANT de décider de (ne pas) mapper.

## ⚙️ Build / dist / boot (frictions confirmées → voir mémoires)

- `[1× — 2026-06-20]` **« Vert mais cassé » EN CASCADE : 1 `dist` absent → fail-soft silencieux en chaîne.** `@nodefony/security/dist` absent → fail-soft de security → `@nodefony/test` (l'importe) tombe → `test:batch` invisible → un test CLI rouge. Visible SEULEMENT en `-d` (WARNING fail-soft noyé). Leçon : `turbo build` exit 0 ≠ outputs présents (cache-hit peut ne pas restaurer un dist supprimé) → vérifier le TERRAIN (parade `missingWorkspaceDists` dans `#ensureBuilt`). Démo : `mv security/dist` → turbo a fait `cache miss` + rebuild de TOUTE la chaîne security→… (165 s) ; la post-vérif reste le filet pour le cas cache-hit trompeur.
- `[1× — 2026-06-20]` **Outillage de PROCESS ≠ booter le kernel.** `nodefony status`/`stop` bootaient le CliKernel → exigeaient une trunk (hors projet → menu interactif « Create Project »). Fix : fast-path standalone dans `CliKernel.start` AVANT `new Kernel` → pur `ps`/sonde ports, marche de PARTOUT, zéro effet de bord (supprime aussi un log `terminate` parasite). Règle : une commande de diagnostic/contrôle système ne doit PAS dépendre du boot applicatif.
- `[1× — 2026-06-20]` **Suspecter son diff PUIS prouver (devise) : 3 fails « de mon commit » = 2 transitoires + 1 état repo.** Après commit `status`, 3 tests CLI `--help` rouges. Vérif : 2 TRANSITOIRES (le watch du DevSupervisor rebuildait le dist PENDANT mes tests → fichiers en cours d'écriture), 1 dû au `dist` security/test absent (état repo, `git status` du module = vide → hors mon diff). Relancer après stabilisation + croiser `git status` = la preuve. Ne jamais qualifier « mon diff » NI « pré-existant » sans le prouver.
- `[1× — 2026-06-20]` **404 e2e inexpliqué = dist module PÉRIMÉ au boot, PAS le code.** Le DevSupervisor
  spawnait l'enfant sur le `dist/` existant **sans le vérifier** → provider OAuth `test-oidc` absent du dist
  module test → 404 sur TOUT le flux OAuth (banc nominal inclus) alors que la SOURCE était bonne. WebAuthn
  passait (indépendant). Réflexe : banc e2e en 404 → `start.sh --force-build` AVANT d'accuser le code.
  **Corrigé `aefb8281`** : `DevSupervisor.#ensureBuilt()` (turbo) au boot + annonce (fail-loud). Le watcher
  excluant `tests/`, créer un fichier de test ne redémarre rien → ce n'était PAS un restart.
- `[1× — 2026-06-20]` **Modifier le CORE en boucle = turbo cache FROID → boot lent (140s) à chaque `nodefony dev`**
  (changer `core` invalide le hash de tous ses dépendants → `#ensureBuilt` rebuild la chaîne). À cache CHAUD,
  turbo = **~80ms (FULL TURBO)**. Réflexe en session « dev du framework » : grouper TOUTES les modifs core avant
  UN rebuild, et pré-chauffer (`npm run build` racine) avant un test runtime — sinon chaque boot remoud.
- `[1× — 2026-06-19]` **`start.sh` « SKIP build » alors qu'on a changé la CONFIG d'un module test** → le
  serveur boote avec l'ANCIENNE config (zone `test-api` sans `apikey`) → le banc e2e taperait une zone périmée
  (un PAT valide → 401 inexplicable). Le build conditionnel par mtime peut rater l'effet d'un `config.ts` modifié.
  Réflexe : `start.sh --force-build` dès qu'on a touché `src/modules/test/**` ET qu'un banc en dépend. Vécu P6.12
  (1ʳᵉ tentative SKIP → forcé au 2ᵉ essai).
- `[2× — 2026-06-20]` **DB dev au schéma périmé : `CREATE TABLE IF NOT EXISTS` ne migre JAMAIS** : (1) table
  `User` créée avant l'ajout de `createdAt`/`updatedAt` → `no such column "createdAt"` au LOGIN ; (2) table
  `session` créée avec `context NOT NULL` puis colonne RETIRÉE du code → `SqliteError: NOT NULL constraint failed:
session.context` à chaque WRITE de session → **serveur pendu 499/timeout 5s** sur toute route à session (banc
  intég muet/hung — cf section Vérification). Symptôme « no such column X » OU « NOT NULL constraint X » à l'usage
  (pas au boot) = schéma d'entité changé après création de la table. Fix dev : `DROP TABLE X` (better-sqlite3) →
  l'ORM la recrée au schéma courant au reboot (prod = drizzle-kit). **Réflexe à graduer (`feedback_*`) : TOUTE
  modif de colonne d'une entité ORM ⇒ DROP la table dev avant de tester runtime.**

- `[1× — 2026-06-16]` **`npm run build` lancé EN BACKGROUND pendant que le serveur dev tourne = 404 fantômes**
  (J5 headers). Le `run_in_background:true` masque le piège (on ne « voit » pas le build mouliner) : il réécrit
  TOUS les `dist/`, le DevSupervisor redémarre sur des dist à DEMI-écrits → routes perdues (`/nodefony/test/*`,
  `/nodefony/security/api/*` en 404, Studio root 200 mais API mortes). En plus la non-régression qui tape ce
  serveur cassé devient ROUGE = faux négatif. Le user voyait « que des 404 sur Studio ». **Règle (déjà CLAUDE.md,
  re-violée) : JAMAIS de build — surtout background — concurrent d'un serveur live.** Soit `stop.sh` AVANT le
  build, soit build d'abord PUIS `start.sh` (restart propre). Diagnostic : `lsof -ti:5151` (PID changé = a
  redémarré) + curl la route de santé (404 = routes perdues). Cf [[feedback_watch_rollup_pitfall]] +
  [[feedback_root_dist_stale_modules]].
- `[1× — 2026-06-15]` **dual-package hazard sur un SINGLETON process-wide via un module non externalisé** (J8).
  Un module (`src/modules/test`) qui `extends RealtimeController` mais ne déclare PAS `@nodefony/realtime` en
  `peerDependencies` + `external` rollup → rollup **bundle une COPIE** du module dans son `dist/` →
  `getRealtimeHub()` rend un **2ᵉ `RealtimeHub`** distinct du canonique → tout ce que le firewall câble sur le
  hub canonique (authenticator WS) est invisible côté copie. Même classe que `orm-core`/`drizzle`/`entityRegistry`
  (déjà commentée dans le `external`). **Règle : tout module qui consomme un service/registre/hub singleton d'un
  autre `@nodefony/*` DOIT l'externaliser** (peerDep + liste `external`). Candidat `nodefony-check-externals`
  (il audite déjà la dérive external↔peerDeps — l'étendre aux singletons). Symptôme trompeur : le runtime
  « marche » (welcome OK) mais le comportement attaché au singleton manque silencieusement.
- `[2× — 2026-06-12]` **restart serveur juste après des edits `.ts` = RACE watch-rebuild ↔ import au boot** (re-vécu
  session Ph.3 front : serveur laissé UP par la session précédente était en BOOT dégradé — 3 dist absents à l'import,
  régénérés APRÈS coup ; détecté au RESUME par le grep filet, restart propre a suffi) :
  le watch détecte les sources modifiées et relance rollup PENDANT que le Kernel importe les dist → rollup
  VIDE `dist/` → `Cannot find module .../realtime/dist/index.js` → modules en **fail-soft** (boot dégradé)
  MAIS health 200 (module test chargé) → 9 timeouts de suite intég « inexpliqués ». Après tout
  rebuild-manuel + restart : `grep -c "BOOT dégradé\|fail-soft" /tmp/nodefony-server.log` AVANT de lancer
  une suite (le health du start.sh ne prouve PAS l'intégrité des modules — variante du filet 06-01).
- `[1× — 2026-06-12]` **TS4114 ⇄ TS4113 inconciliables entre les 2 programmes du core (node augmente `Error`
  global avec `code?: any`, client non)** : un champ de classe `code` exige `override` côté node et l'interdit
  côté client. Sortie propre = **declaration merging** (`export interface X { code: number }` + classe qui
  assigne dans le ctor) : la prop fusionnée échappe au check `override` et type `number` partout.
- `[1× — 2026-06-12]` **un import STATIQUE de peerDep optionnelle dans UN fichier du barrel rend TOUT le
  barrel dépendant d'elle** (ESM runtime n'a PAS de tree-shaking : importer `{ anonymousUser }` du barrel
  user évalue `BcryptEncoder.ts` → chargeait le binaire natif `@node-rs/bcrypt` à CHAQUE boot consommant
  le module, crash si la peerDep optionnelle est absente — la TSDoc promettait l'inverse). Détecté par la
  directive lazy du user (flair, J1). → dep lourde/optionnelle = **`import()` dynamique DANS l'instance au
  premier usage** (méthodes async du contrat), caché ensuite ; les fabriques d'un registre restent SYNC
  (lazy dans l'instance, pas la fabrique — pas de `#build` async/race boot). Fix `ecd3dab7` ; règle gravée
  au kit P6 pour argon2 (J2) / jose (J4) / simplewebauthn (J9). À auditer : autres barrels à peerDep
  optionnelle (candidat skill check-externals).

- `[1× — 2026-06-08]` **`npm install` ne purge pas le bloc workspace orphelin du `package-lock`** après suppression d'un package :
  l'arbre transitif est bien pruné (−2820 L, symlink `node_modules/@nodefony/X` retiré) mais l'entrée `"src/packages/@nodefony/X"`
  reste, marquée `"extraneous": true` → un futur `npm ci` serait incohérent. → la **retirer à la main** (Edit du bloc), puis
  `node -e JSON.parse` + `npm install --package-lock-only` pour confirmer que npm ne la réintroduit pas.
- `[1× — 2026-06-08]` **un script `test: "vitest run"` SANS `vitest` en devDep = latemment cassé** : drizzle ET mongoose
  déclaraient le script mais pas la dep → binaire introuvable, et `npm install` dit « up to date » (il ne devine pas une dep
  manquante non déclarée). → **déclarer la devDep** puis install. Diagnostiquer la résolution avec
  **`node --input-type=module -e "await import.meta.resolve('x')"` (ESM)**, PAS `require.resolve` (trompeur : échoue sur un
  package `exports` import-only comme `@nodefony/http` alors que l'`import` ESM marche → faux négatif).
- Ces frictions sont **déjà graduées** — ne pas les redupliquer ici, juste les rappeler :
  - `npm run clean` détruit le **dist racine** (app) → `npm run build` foreground + `npx rollup -c`
    racine avant tout start → [[feedback_root_dist_stale_modules]].
  - `cd` dans une commande fait dériver le cwd → chemins relatifs cassés → [[feedback_cd_startsh_relative_path]].
  - Turbo cache sert des logs/dist périmés → [[feedback_turbo_cache_stale_logs]].
- `[1× — 2026-05-31]` **build turbo en arrière-plan incomplet** : après `clean`, un `npm run build`
  lancé en background n'avait pas régénéré tous les dist (drizzle/studio manquants) → 2 boots ratés.
  → build complet **foreground** et vérifier `ls dist/index.js` des modules clés avant start. (variante
  du pattern « created dist menteur » — à fusionner si revu.)
- `[2× — 2026-06-10]` **build turbo répété en itération = douleur user** : `npm run build` (turbo, tout le
  monorepo) à CHAQUE petit changement → « build long !!! » (re-frappé 06-10 : 2 full builds quand 1 ciblé +
  1 `npx rollup -c` racine suffisaient). → en itération, builder **CIBLÉ** workspace par workspace
  (`cd src/packages/@nodefony/<m> && npm run build`) ; **`nodefony.config.ts`/app racine = `npx rollup -c`
  à la racine SEUL** ; réserver le turbo complet aux merges/refactors croisés ou code+config simultanés.
  Un changement de type du core qui n'impacte que le runtime des consommateurs (ils importent le dist)
  ne nécessite PAS de les rebuilder. → candidat graduation `feedback_*` au prochain frappé.
- `[1× — 2026-06-09]` **multi-restarts du DevSupervisor empilent les boots dans `/tmp/nodefony-server.log`** :
  plusieurs « ✓ Prêt » dans le log → on diagnostique un VIEUX boot et on conclut à tort que le code ne marche
  pas (vécu sur le détail ORM, qui marchait en réalité). → AVANT de diagnostiquer un boot : `grep -c "✓  Prêt"`
  le log ; si > 1, ne lire que le DERNIER bloc (ou `stop.sh` + `start.sh` propre, log neuf).
- `[1× — 2026-06-09]` **`onServersReady` émis en fire-and-forget** (`Kernel.initServers` : `fireAsync(…)` NON
  awaité) → ses listeners courent APRÈS le récap `onPostReady` (race microtask) : un détail posé par un listener
  `onServersReady` (ex. report ORM) n'est pas vu par le récap. → **`await fireAsync("onServersReady")`** garantit
  que ses listeners ont fini avant `onPostReady` (boot-only, surcoût négligeable).
- `[1× — 2026-06-09]` **ajouter une méthode PUBLIQUE au `Kernel` casse `IKernel → Kernel`** : un consommateur
  cross-module passe `this.kernel: IKernel` à un param typé `Kernel` (classe) ; ça compile tant qu'`IKernel`
  couvre l'API publique, mais une nouvelle méthode du Kernel non déclarée dans `IKernel` → TS2345 « not
  assignable » (latent, révélé par rebuild turbo). → (1) déclarer la nouvelle API publique dans `IKernel` ;
  (2) typer les consommateurs cross-module sur le **contrat `IKernel`**, jamais la classe concrète.
- `[1× — 2026-06-04]` **un bare import non listé dans `external` (rollup root) n'est PAS forcément bundlé** :
  ajouté `import { z } from "zod"` dans la config app (zod absent de l'array `external` de `rollup.config.ts`).
  Présumé « zod va gonfler le dist » → FAUX : `dist/.../schema.js` faisait 3.5 KB avec `import 'zod'` conservé
  (node-resolve a laissé le bare specifier externe, résolu au runtime via le hoisting npm). → **vérifier le
  dist** (taille + `grep import 'zod'`) plutôt que présumer un bundle ; pas besoin de toucher `rollup.config.ts`
  (interdit) pour un peerDep hoisté résolvable au runtime.
- `[1× — 2026-06-04]` **MAIS le rollup du CORE externalise par ALLOWLIST stricte** (`external.some(...)`,
  ≠ app lenient) → un nouveau peerDep (`zod`) y est **bundlé** s'il n'est PAS ajouté à l'array `external`.
  Conséquence directe de D1 = 1 ligne dans `rollup.config.ts` (protégé → demandé avant). Vérif post-build :
  `schema.js` 3.4 KB + `grep "import 'zod'"` conservé. « peerDep auto-externe » DÉPEND du rollup du package.
- `[1× — 2026-06-04]` **erreur ESM runtime juste après l'ajout d'un dep = suspecter un dist PARTIEL/racy
  AVANT la résolution elle-même** : `Cannot find '.../zod/index.js'` à un test d'intégration venait d'un
  **build partiel** (watch rebuildant en plein edit), pas d'un vrai bug (zod/index.js existait). → `clean &&
build` + tester le **bin directement** (`./bin/nodefony --version`) avant d'enquêter sur la résolution.
- `[1× — 2026-06-05]` **le dist du CORE est sous `dist/node/`, pas `dist/`** (build isomorphe node/browser) :
  vérifier qu'un `.ts` du core est compilé → `find dist -name X.js` (ex. `dist/node/service/dev/DevSupervisor.js`),
  pas `dist/service/...` (faux négatif). Les packages `@nodefony/*` restent en `dist/` plat.
- `[1× — 2026-06-05]` **retirer les types d'un test-runner (`@types/mocha`) expose des milliers de warnings build** :
  `@rollup/plugin-typescript` type-check TOUT le programme du `tsconfig.json` → un test laissé dans `include`
  warne (describe/it non typés TS2593, `import "mocha"` TS2882, `before` TS2304). 2024 warnings d'un coup.
  → **exclure les tests du build tsconfig** (`nodefony/tests/**`+`tests/**`+`**/*.test.ts`) ; convention déjà
  chez core/frontend/drizzle/... ; les tests ont leur `tsconfig.tests.json` (`types:["node","vitest/globals","chai"]`).
- `[1× — 2026-06-05]` **`tail -N` sur un build MASQUE les warnings** (un build « réussit » AVEC warnings) : j'ai loupé
  2024 warnings http à la migration vitest car je ne regardais que `tail -15`. → juger un build propre par **comptage
  explicite** : `grep -cE "@rollup/plugin-typescript TS[0-9]+|\(!\)"`, jamais au `tail`.
- `[1× — 2026-06-05]` **`exports.types: ./index.ts` (anti-race) est une CHAÎNE** : security(source)→user→orm-core→core.
  Convertir UN maillon en source-types fait **cascader** (ses deps doivent l'être aussi, sinon TS2307 « Cannot find
  module » sur les consommateurs amont qui compilent la source). Vérifié 2026-06-05 : fixer user a révélé user→orm-core,
  fixer orm-core a fermé (orm-core ne dépend que du core, buildé en 1er). Documenté table types `CLAUDE.md`.
- `[1× — 2026-06-05]` **commitlint `subject-case` rejette un sujet commençant par un mot MAJUSCULE** (« README … »)
  → sujet en minuscule après le type : `docs(x): readme …`. (macOS : pas de `timeout` → `gtimeout` ou background+kill.)
- `[1× — 2026-06-07]` **écrire dans un dossier d'infra PARTAGÉ (`docker/`) = `find` + Read l'existant AVANT** : le
  `docker/docker-compose.yml` était déjà l'infra dev (Redis/Kafka/Loki/Grafana/OpenSearch, par PROFILS) → un `Write`
  l'aurait écrasé, mais le tool a refusé (« file not read ») = garde-fou. → intégrer via le **pattern existant**
  (nouveau `--profile proxy`), pas un fichier compose séparé (convention-frère). Vérifier `git ls-files docker/`
  - `find docker -type f` quand on ajoute à un répertoire qu'on n'a pas créé.

## 🧭 Conception / fondation / vocabulaire (frictions du jour)

- `[1× — 2026-06-14]` **le kit/plan disait « décorateurs au hook `beforeResolve` » — FAUX (vérifié dans le code)** :
  `beforeResolve` fire AVANT la résolution de route (test : « fires before route resolution even for 404 ») → à ce
  hook on ne connaît NI le controller NI la méthode → impossible de lire `@IsGranted`. Le bon seam = `Resolver.executeAction`
  (post-résolution, pré-`newController`) — qui en bonus est partagé HTTP+WS `api.request` (« 1 garde = N transports »).
  DEVISE confirmée : un ancrage de kit ne remplace pas le terrain. (cf [[feedback_security_audit_surface_matrix]])

- `[2× — 2026-06-13]` **le kit/mémoire peut être PÉRIMÉ sur l'état du code → vérifier les contrats DANS le
  code au cadrage d'un lot** : (a) le kit P6 disait « IUserProvider implémenté nulle part » alors que
  `UserService.loadUserByIdentifier` était livré (J1/J2) → 2 min de Read ont réduit le lot 1 de moitié ;
  (b) re-vécu le soir : le kit P6 disait encore « PROCHAINE = J3 » alors que J3 était livré le matin même.
  Même famille que le garde-fou « \_state périmé vs commits » du RESUME, appliqué aux kits.
- `[1× — 2026-06-13]` **ne jamais dire « sûr de toute la chaîne » sans avoir lu les call-sites/deps RÉELS**
  (le user a exigé 3 passes de contrôle avant de trancher) : présumé « handleSecurity tourne après le
  resolve » et « security câble realtime » sans vérifier → les 2 étaient à confirmer (l'un favorable
  `http-kernel:966→980`, l'autre = couplage par nom `"realtimeService"` car 0 dep). Distinguer EXPLICITEMENT
  vérifié (fichier:ligne) vs présumé ; un seam « ✅ livré » peut être une prise vide non câblée (le
  RealtimeController ne passait pas `beforeDispatch` au peer). Cf [[feedback_security_audit_surface_matrix]].
- `[1× — 2026-06-13]` **un regex de sécurité se valide contre l'inventaire RÉEL des routes** : le pattern de
  zone `^/nodefony/[^/]+/api/` (slash final) rate `/nodefony/profiler/api` (sans slash) → `…/api(/|$)`.
  Grepper les paths réellement enregistrés avant de figer un pattern de firewall (un trou de regex = trou de sécu).
- `[1× — 2026-06-13]` **mesurer le rayon d'impact AVANT de trancher un design qui touche les suites** :
  la zone pérenne `/nodefony/*/api` semblait casser « des dizaines » de tests data plane → 1 grep = 2
  fichiers seulement. La peur n'est pas une mesure ; le grep si (2 min, décision éclairée).
- `[1× — 2026-06-10]` **un POC qui touche un pipeline RÉVÈLE des seams imprévisibles → annoncer le scope comme PROVISOIRE.**
  Annoncé « 1 ligne framework » (`resolveByPath`) ; coder le pont WS a exposé que `callController` COUPLE exécuter+rendre
  (`returnController` auto-`send`) → fallu extraire `executeAction` (2ᵉ brique, iso-comportement, 609 tests verts). C'est LA
  valeur du POC (faire remonter le couplage exécution/rendu), mais l'estimation initiale était fausse. → pour un POC sur du
  code chaud : dire « ≥1 modif, le POC tranchera », **signaler chaque seam au fil de l'eau** (fait), regater (tests+mémoire).
- `[1× — 2026-06-08]` **convention-frère ≠ copier les défauts du frère.** Adapter User Mongoose : j'ai répliqué la structure Drizzle (`src/user/` + entité dans `src/`) alors que le module a DÉJÀ un `entity/` (sessionEntity) → incohérence `entity/` vs `src/user/`, reprise **2×** par le user. → avant de copier un frère, **vérifier qu'il est cohérent** ; trancher UNE règle (`entity/`=schéma, `src/`=repo) et l'appliquer aux DEUX modules.
- `[2× — 2026-06-08]` **emprunt de nom d'un autre framework = réflexe à tuer** (au-delà de [[feedback_nodefony_not_symfony_clone]]) : pas que « Symfony » — proposé `IPrincipal` (Spring/.NET) → rejeté pareil. → penser le **besoin/concept** d'abord, nommer en **vocabulaire Nodefony** ; ne pas plaquer un terme étranger pour « faire sérieux ».
- `[1× — 2026-06-08]` **fondation (user/sécu) = AUDIT avant code.** Le user a stoppé P5.8 pour exiger un audit (état de l'art NIST 800-63B/OWASP/WebAuthn/OAuth 2.1 + code réel + décisions datées). Révélé : décisions de mai périmées (full-stateless, MikroORM) + `IUserProvider` **jamais implémenté**. → sur une brique structurante, confronter **état de l'art + code + décisions** AVANT de coder.
- `[1× — 2026-06-08]` **« durci/complet » sans préciser le niveau = survente, challengée.** Dit ORM mongoose « durcissement complet » → 0 test E2E système (memory-server + boot hors-kernel, pas de serveur réel). → distinguer **unit / composant / E2E système** ; jamais « complet » sans le niveau atteint.
- `[1× — 2026-06-19]` **brainstorming ≠ décision actée — ne jamais restituer une idée comme « actée ».** Affirmé « on a acté d'oublier les sockets TCP/UDP pour le realtime » → user « c'est PAS acté » + « regarde le legacy ». Le legacy `../nodefony/.../realtime-bundle` (tcpSocket/udpSocket/unixSocket/spawnSocket sous interface unifiée `connect/send/close`) révèle que TCP/UDP = **capacité socket polymorphe du framework** (parler à TCP/UDP/Unix/process), PAS le transport navigateur (WS only) — j'avais télescopé 2 concepts. → distinguer EXPLICITEMENT « vérifié/acté » vs « évoqué » ; sur un positionnement realtime, **lire le legacy AVANT d'affirmer** (la capacité voulue peut y être prouvée). Variante de la devise appliquée au mot « acté ».
- `[1× — 2026-06-19]` **ne pas garantir « zéro modif structurelle » sans lire le code — nuancer les garanties d'archi.** Annoncé « le multi-tenant se dev PAR-DESSUS security » → user « sûr ? pas de modif structurelle ? ». Vérif code : contrats publics STABLES (`IToken.getAttribute` slot, voter `subject`, `decide`) MAIS `UserToken.getRoles()` (`UserToken.ts:58-60`) lit `user.roles` GLOBAUX en dur → RBAC incapable de distinguer 2 tenants → modif INTERNE inévitable (rôles scopés + peuplement à `resolveTenant`), neutralisable SI P6.8 conçu tenant-aware. → réponse honnête = « additif, pas refonte, SOUS condition X », jamais un « oui » de confort (j'avais moi-même dit « 1 hook firewall » = déjà non-zéro).
- `[1× — 2026-06-19]` **user qui PANIQUE sur une « erreur d'archi fondamentale » → FAITS comparatifs, pas réassurance vide.** « C'est pas possible qu'un framework comme Nodefony ne soit pas SaaS compliant !!! ». Recadrage qui a porté : (1) AUCUN framework n'est multi-tenant par défaut (Rails/Django/Nest/Laravel/Spring = couche ajoutée) → SaaS-_enabling_, jamais _compliant_ nativement ; (2) l'audit PROUVE l'inverse d'une erreur (fondations dures déjà là : ALS, Repository, firewall central, `withTransaction`, slots `tenantId` = anticipation) ; (3) cohérent avec SON credo « rien de métier dans le core ». → désamorcer avec l'état de l'industrie + la preuve terrain (ancrages), pas « t'inquiète ».

## 🧹 Refonte / consolidation (frictions du jour)

- `[1× — 2026-06-17]` **audit MIGRATION_STATUS (passe 3) — 3 pièges.** (a) La ligne **GLOBAL ne sommait PAS ses propres lignes** (57 % affiché vs **62 % réel**) → recompter en sommant les lignes du bandeau (`grep '^ P[0-9]' | perl`), jamais se fier au total écrit à la main. (b) Les **refs « mortes »** (mikroorm/pm2/sequelize) étaient **déjà correctement marquées `⏭️ caduc`/abandonné** → vérifier AVANT de « purger » (j'allais retirer des marqueurs LÉGITIMES — la confiance n'exclut pas le contrôle ; « purger le vivant, préserver l'historique »). (c) Un **livrable peut être tracké sous un AUTRE nom** : le « data plane sécu persisté » (P6.12 API Keys) existait déjà via `ITokenStore`/`IAccessTokenRecord` kind:`pat` + stores ORM (révélé par le user) → l'audit doit chercher le BESOIN, pas le mot-clé. Module `@nodefony/documentation` (14 src) **non tracké** → ajouté P10.14. Outil : `perl -CSD` ne matche PAS un emoji littéral du script (input décodé ≠ script en octets) → **sans `-CSD`** ; l'`awk` macOS compte `⏭️` (1ʳᵉ cellule) comme `⬜`.

- `[1× — 2026-06-12]` **le dashboard RE-ENGRAISSE en 7 jours si les sessions appendent au § Séquencement** :
  cellule-journal 2 767 car. reconstituée entre les 2 passes vérité (06-05 → 06-12) malgré la convention en
  tête du fichier. → au END, AJOUTER le jalon en ~1 ligne avec hash et RIEN d'autre (détail = git log/retros) ;
  la passe vérité périodique reste le filet, pas l'excuse.
- `[1× — 2026-06-12]` **le bandeau Avancement décroche dès qu'on marque des lignes P sans le recompter** :
  6 phases fausses en 7 jours (P11 33 %→44 réel, P9 38→63…). → quand un END coche des lignes P, relancer
  l'awk 1ʳᵉ cellule (skill migration-audit) OU dater le bandeau comme périmé — jamais le laisser muet.
- `[1× — 2026-06-12]` **archiver les kits clos AU FIL DE L'EAU, pas au warning** : index MEMORY.md à 29,7 KB
  (limite 24,4) → 33 entrées closes archivées d'un coup. → au END, si le chantier du jour CLÔT un kit,
  déplacer sa ligne vers MEMORY_ARCHIVE.md dans la même passe (1 min) au lieu d'accumuler.

- `[1× — 2026-06-06]` **changer le TYPE d'un contrat (interface) casse les `implements`, PAS les casts** : unifier
  `ISessionStorage` (retypé) a cassé `drizzle` (`class … implements ISessionStorage`, retours `Promise<unknown>` non
  conformes) mais PAS `sequelize`/`mongoose` (pas d'`implements` → le cast `as unknown as` au register absorbe). →
  après un changement de contrat, `tsc --noEmit -p <module>` par module localise les non-conformes ; un diff **type-only**
  (aliases + types) n'impacte pas le runtime → gate mémoire reportable au 1er vrai changement runtime (réécriture cœur).
- `[3× — 2026-06-04, 2026-06-05, 2026-06-12]` **une option de config peut être un FOSSILE** ⚠️ candidate
  graduation (≥3×) : (a) consolider des « défauts » depuis un config.ts existant → recopie de
  `watch`/`devServer`/`orm:"sequelize"`/`domainCheck` morts ; (b) Lot 5 : le bloc
  `certificates.{path,privateKeyPath,certPath}` de l'app était **INERTE** (`certificates.ts` hardcode ses
  chemins) ; (c) P6 J1 : le bloc `firewalls:{main:{path,helmet,cors}}` de `nodefony.config.ts` était un
  **format MORT** (le firewall S1 lit `areas`) → l'app dev tournait SANS AUCUNE zone en se croyant
  configurée — sur de la SÉCURITÉ, un fossile silencieux = trou réel, pas du cosmétique. → **grep les
  consommateurs CHAMP PAR CHAMP** avant d'adopter/porter ; fix J1 : validation Zod fail-closed au boot
  (config invalide → tout le trafic rejeté, plus de faux-sentiment).
- `[1× — 2026-06-05]` **déplacer un fichier HORS d'un dossier surveillé casse le watcher silencieusement** : Lot 5
  a sorti la config de `nodefony/config/*` (dossier watché par DevSupervisor) vers des **fichiers racine**
  (`nodefony.config.ts`/`env.ts`) → `#paths` (liste de dossiers + `index.ts`) ne les voyait plus → éditer la config
  ne redémarrait plus en dev. → **quand un déplacement sort un fichier d'un dossier auto-traité** (watch, glob, include
  tsconfig, scan), vérifier le mécanisme qui le ramassait. Fix = ajouter les fichiers à la watch-list (`71f9523`).
- `[1× — 2026-06-04]` **« on a retiré X pour la perf » est SCOPÉ à son contexte** : `extend` retiré du pipeline
  était une optim **hot-path/per-requête** (`02c32c2`), pas « extend est lent ». Pour un merge **boot-only**
  (config), `extend(true,{},…)` est parfait. Ne pas sur-généraliser une optim perf à du code non-chaud.
- `[1× — 2026-06-05]` **dégraisser un GROS fichier doc : `Write` court > N `Edit` chirurgicaux sur cellules géantes.**
  `MIGRATION_STATUS.md` (278 KB) était plombé par des cellules de tableau de ~3 800 car. (journal de commits inline).
  Matcher chaque cellule en `old_string` pour la raccourcir coûte PLUS de tokens que réécrire le fichier court d'un bloc
  → quand > ~50 % d'un fichier est à condenser, **réécriture `Write`** (git garde l'historique détaillé), pas du chirurgical.
  Localiser les lignes géantes : `awk '{print length"\t"NR}' f | sort -rn | head`. `Read` **échoue > 256 KB / 25000 tokens** → lire par tranches.
- `[1× — 2026-06-05]` **gros chantier supervisé = PERSISTER les constats au fil de l'eau** (fichier de travail), pas tout
  garder en contexte : l'audit P0→P16 a été écrit phase par phase dans `docs/migration/AUDIT-verite-2026-06.md` → survit aux
  interruptions (`/clear`, coupure) ET devient le matériau du livrable. Le user a interrompu 2× du Bash + jalonné « go »/« continue ».
- `[1× — 2026-06-08]` **suppression totale d'un package = cartographier AVANT de couper, en triant consommateurs-CODE vs mentions-DOC.**
  Sequelize OUT : 1 grep cross-repo + `.ai/symbols` ont séparé (a) ce qui casse le build (manifeste, peerDep, external rollup,
  alias vitest, stubs, branche `Error.ts`) de (b) le cosmétique (TSDoc, README, labels Studio). Couper (a) → gates → puis (b).
  Studio ne dépendait PAS du package (que des labels/logos) → suppression sûre.
- `[1× — 2026-06-08]` **balayage prose multi-fichiers = script Node `replace` exact-match > sed.** Pour purger un mot dans ~50
  fichiers (UTF-8, accents, multiline, backticks, art ASCII) : un `.mjs` `{file:[[from,to]]}` qui **rapporte les introuvables**
  est plus sûr que `sed -i` (multibyte `·`/`…`/`é` risqués) et plus économe que Read+Edit par fichier. Garder Read+Edit pour les
  tableaux/box ASCII (alignement à recompter à la main).
- `[1× — 2026-06-08]` **purge d'un legacy : nettoyer le VIVANT, préserver l'HISTORIQUE.** « Zéro résidu » s'applique aux docs qui
  décrivent l'état ACTUEL (CLAUDE/MEMORY/README/docs/guides/MIGRATION_STATUS) ; **PAS** aux ADR, session-retros, `migration/journal`,
  audits — réécrire un document daté falsifie l'historique (l'audit ORM cite Sequelize justement pour documenter sa suppression).

## 🔄 Cycle de session (END/RETEX) — méta

- `[1× — 2026-06-14]` **`git diff HEAD` (et la security-review qui grep dessus) IGNORE les fichiers NEUFS non trackés**
  → sur une feature majoritairement composée de fichiers neufs (JWT = 7 `.ts` neufs), le scan sécu rate le gros du
  code. → grepper les fichiers neufs EXPLICITEMENT (`git status --short | grep '^??'`) EN PLUS du diff, avant de
  conclure « 0 secret / 0 any ».

- `[1× — 2026-06-12]` **la DESCRIPTION frontmatter d'un skill = la seule partie chargée en permanence par
  le harness** → un périmé LÀ (load-test disait « suites Mocha » 7 jours après la suppression de mocha)
  désinforme CHAQUE session, même celles qui n'ouvrent pas le skill. À l'audit d'un skill : vérifier la
  description AVANT le corps. Corollaire : le frontmatter `version` peut rater son propre changelog
  (studio-dev 1.22.0 avec un changelog 1.23.0) → à chaque bump, frontmatter ET changelog ensemble.
- `[1× — 2026-06-12]` **le cache plugin (`~/.claude/plugins/cache/<plugin>/…/skills/`) peut héberger de
  VIEILLES copies de skills projet** (2 doublons `skill-creator:nodefony-create-module`/`start-nodefony-server`
  y traînaient avec des recettes périmées `@modules()`) → elles polluent la liste harness en doublon. Après
  une session skill-creator : vérifier qu'aucun skill projet n'a été copié dans le cache plugin.
- `[3× — 2026-06-12]` **une mémoire graduée n'est utile que si on l'APPLIQUE au moment d'agir** : (a) commit
  de la consolidation rejeté pour « CONSOLIDATE » majuscule — la règle exacte ([[feedback_commit_fr_apostrophes]])
  retirée du SAS comme « déjà graduée » 10 min avant ; (b) Edit refusé sur RETEX.md (5ᵉ occurrence
  [[feedback_edit_requires_read_tool]]) juste APRÈS l'avoir graduée — cause : prettier reformate au commit
  → l'état connu du fichier est périmé → re-Read obligatoire avant tout Edit post-commit ; (c) session P6 J0 :
  récidive TRIPLE — Edit package.json refusé (cat ≠ Read), commitlint header >100 refusé, PUIS Edit RETEX.md
  refusé pendant la rédaction même de cette entrée. Le savoir stocké ne remplace pas le réflexe au point
  d'action. **≥3× → candidate CONSOLIDATE** : checklist « point d'action » (avant Edit : Read-tool récent ?
  avant commit : sujet minuscule + header ≤100 ?).
- `[1× — 2026-06-04]` **capter les exigences ajoutées en cours de route DANS le kit, au fil de l'eau** : sur
  une session de planif, le user a ajouté typage impeccable, hot/boot runtime, sémantique `use` APRÈS la vision
  initiale → chaque ajout intégré immédiatement au kit (piliers/décisions), pas en fin. Évite de perdre une
  exigence entre 2 messages + garde le kit comme source unique de la spec.

## 🧩 Modules / docs / front (frictions du jour)

- `[1× — 2026-06-08]` **« pattern module » = CHECKLIST COMPLÈTE, pas juste le code qui compile** : refonte mongoose
  livrée « OK » (build vert), mais j'avais zappé (a) la **config Zod** (schema/define/interfaces/validate/augment
  `NodefonyModuleConfig`), (b) les **artefacts module** `CLAUDE.md`/`README.md`/`docs/`, (c) le flag `critical`. Le user a
  dû relancer 3× (« les config on les repense », « regarde les patterns module pour rien oublier »). → avant de dire « fait »,
  **comparer à un module frère COMPLET** (drizzle/redis) artefact par artefact (config Zod + `declare module` + CLAUDE/README/docs
  - `critical` + test config + zod en dep/external rollup). Le « fait » d'un module ≠ « ça build ».
- `[1× — 2026-06-08]` **renouveau = 0 back-compat + séparer les FAMILLES de modules** : pour la config, ne pas garder
  d'alias de types legacy (« on repense », pas « on migre en douceur ») ; et bien distinguer **infra** (redis = connexions
  génériques) de **ORM** (drizzle/mongoose) — redis n'est PAS un ORM, juste une référence du _pattern_ config. Mélanger les
  familles brouille la logique (le user : « redis est à part, il n'a pas lieu d'être un ORM »).

  > ♻️ CONSOLIDATE 2026-06-12 : les ~10 frictions front du 06-06 (bureau≠grille/paradigme, singleton
  > MobX↔HMR hard-reload, drag setPointerCapture, sticky marginTop, isolation:isolate, returnFocus Menu,
  > forage exact, registre de blocs/aperçu lazy, tags saisis/dérivés, Collapse `expanded`) sont **gravées
  > dans `nodefony-studio-dev` SKILL.md** (sections Bureau composable + Supervision en bureau + Twin) —
  > retirées d'ici. Restent les non-couvertes :

- `[1× — 2026-06-06]` **react-grid-layout est INCOMPATIBLE React 19** (il utilise `ReactDOM.findDOMNode`,
  **supprimé** en React 19) → pour une grille dashboard draggable/resizable NE PAS le proposer. Maison 0-dep :
  **CSS grid `auto-flow: dense`** (span colonnes × rangées = tuilage sans trou) + **resize au coin** par pointer
  events (delta px → unités via le `getBoundingClientRect` de la carte) + drag HTML5 `setDragImage(card)` (fantôme
  = la carte). React-19-safe, contrôlé. (gridstack = alternative vanilla mais intégration React fiddly.)
- `[1× — 2026-06-06]` **un canal realtime peut pousser des frames COALESCÉES, pas l'objet nu** : `syslog:stream`
  émet `{ logs:[...], dropped }` (coalescing serveur), PAS un Pdu → un widget qui rend `source.data` comme un Pdu
  affiche l'enveloppe (« ça ressemble à rien », vu par le user). → avant de rendre un flux, **vérifier la FORME
  exacte de la frame** (lire le producteur ou un consommateur existant) et **réutiliser les vraies briques** au
  lieu de deviner les champs : ici `toRecord`/`recordMessage`/`ansiToReact`/`SeverityBadge` de `routes/logs/`
  (convention-frère) → même rendu que la page Logs du 1er coup. Les champs Pdu devinés passaient le typecheck mais le rendu était faux.

> ♻️ CONSOLIDATE 2026-06-12 : retirés (couverts ailleurs) — Mantine v9/`expanded` → skill studio-dev
> (corrigé 1.19.0) · « pas de clickodrome » → [[feedback_studio_ergonomie_progressive]] + section skill ·
> terminologie FR → [[feedback_terminology_forage]] · binaire WS `binaryByteLength` → skill framework-dev
> changelog 1.19.0 + `wsLogContent.ts`.

- `[1× — 2026-06-01]` **routes/logs/ est gitignoré (pattern `logs`)** → NOUVEAU fichier (`wsTrace.tsx`)
  = `git add -f` ; les fichiers déjà trackés du dossier s'`add` aussi avec `-f` quand git refuse.
  Et **header de commit ≤ 100 car** (commitlint header-max-length) : un sujet riche dépasse vite.
- `[1× — 2026-06-02]` **purge de dep « morte » : le grep `from "x"` ment** — il rate (a) les imports
  **side-effect** (`import "reflect-metadata"`), (b) l'usage **hors `src/`** (`scripts/`, `rollup.config.ts`),
  (c) les usages indirects (Tools/Pdu). Vécu : reflect-metadata/lodash/terser faux-classés morts par l'audit
  auto. → AVANT de virer une dep : re-vérif ciblée `import "x"` + `scripts/` + `rollup.config` ; ne supprimer
  que les **vraiment 0-import partout**. (clui/node-emoji/rxjs/shelljs/pug/@babel/plugin-replace = OK, 57 pkgs purgés.)
- `[1× — 2026-06-02]` **header/banner CLI sort via `console.log`, PAS le sink syslog** → `Syslog.setSinkEnabled`
  ne le mute pas ; et un afficheur branché à `onStart`/hook tardif arrive **après** les logs DEBUG (`-d`) →
  « pas dans l'ordre ». Pour un ordre stable tous modes : imprimer le header **au plus tôt** (Kernel devSplash,
  juste sous l'ASCII), pas via le composant qui fire plus tard. Flag `reporterOwnsHeader` pour éviter le doublon.
- `[1× — 2026-06-02]` **itération UX TTY = ne JAMAIS killer le serveur du user** : il teste l'animation dans
  son terminal (animation invisible côté agent, non-TTY) ; `start.sh` pkill `nodefony development` → tuerait sa
  session. → build seul + « relance pour voir » ; jamais de boot agent pendant qu'il a un TTY live.
- `[1× — 2026-06-02]` **audit sync : la MIGRATION peut être juste, la MÉMOIRE en retard** — `dev_boot_spinner_ux`
  disait « PROCHAINE » alors que livré ; `pm2_deprecation` disait « Phase 16 » alors que retiré C6 (MIGRATION
  l.117 correcte). → réflexe END : MAJ la **mémoire de la feature livrée** (desc + corps), pas seulement le `_state`.

> ♻️ CONSOLIDATE 2026-06-12 : toutes les frictions **commitlint** (subject-case minuscule 8×+2×,
> PascalCase en tête, header ≤100) sont **déjà graduées** dans [[feedback_commit_fr_apostrophes]]
> (§ « 2 règles dures ») — retirées d'ici (anti-doublon).

- `[1× — 2026-05-31]` **`{{ }}` dans les `docs/*.md` d'un module sont résolus par `@nodefony/documentation`
  lui-même** (le module se scanne → effet miroir) : documenter la feature `{{ }}` mange ses propres
  exemples. → neutraliser les exemples : `{{ maVar }}` (provider inconnu = laissé littéral) ou `{{ … }}`
  (hors charset `[\w.-]` = non matché par le résolveur).
- `[1× — 2026-05-31]` **« Session front » ≠ forcément du dev** : quand le composant cible déjà les bonnes
  routes ET que les shapes back↔front sont compatibles (champs optionnels en trop/absents = dégradation
  propre), la session se réduit à un **diff de shapes + curl runtime, 0 edit**. Ne pas présumer qu'il faut
  coder ni invoquer `nodefony-studio-dev`. Reste = confirmation visuelle user (hard-reload, pas de headless).
- ✅ retiré (CONSOLIDATE 2026-06-12) : « un test ne laisse jamais de résidu » — **RÉSOLU dans le code**
  (`memory.test` nettoie ses uploads par snapshot-diff, commit `0915764` ; pattern dans `upload.test.ts`).
- `[1× — 2026-05-31]` **couleurs ANSI bakées dans le payload de log → fichier JSON pollué** : `clc.xxx("EVENT
KERNEL/CONTEXT")` colore à la SOURCE (constantes module, multi-modules) ; `cli-color/bare` colore AUSSI
  (vérifié — pas d'interrupteur global). Stripper l'ANSI **par log** dans le transport = coût hot path (refusé
  user, à juste titre). Le fix propre = **décision boot-time** (gate couleur résolu 1× selon isTTY/non-fichier),
  PAS un `.replace()` au runtime. TODO ciblé. → un défaut « cosmétique » peut cacher un vrai sujet perf.
- `[1× — 2026-05-31]` **config « source unique » pour un chemin partagé** : le dir de logs était hardcodé
  `logs/` (Kernel) côté écriture mais le viewer Studio lisait `tmpDir` → la tab Fichiers ne montrait jamais les
  vrais logs. → un chemin utilisé par N composants = **UNE** config (`config.log.dir`), lue partout. Vaut pour
  tout couple write↔read (cf le pattern write↔read cohérent du Log Backplane).
- `[2× — 2026-06-01]` **hardcode `if(name===…)` dans le Kernel rejeté par le user** (LB.4) : choisir une impl
  par son nom EN DUR dans le Kernel (`if queryDriver==="loki" …`) = anti-pattern. Bonne réponse = **registre de
  FABRIQUES** (`name → factory(ctx)→{driver,transport?}`, builtins s'auto-enregistrent, Kernel résout+branche,
  boucle `listLogDriverFactories()` en dev). Convention-frère de `backplaneRegistry`/`ormRegistry`. Le user
  traque ce pattern (réagi 2×) → l'appliquer d'EMBLÉE pour tout « choisir une impl par nom ».
- `[1× — 2026-06-01]` **Log Backplane = 2 axes orthogonaux, l'UI DOIT les séparer** (le user a buté dessus) :
  le **select** Studio change la **LECTURE** (un seul « fond de panier » qu'on RELIT/cherche) — PAS l'écriture.
  L'écriture est un **fan-out** (1 log → console+fichier+Loki+OpenSearch en même temps). → toute UI de backplane
  doit montrer **ÉCRITURE = cases à cocher (multi)** ≠ **LECTURE = select (un seul)** explicitement. Vulgariser :
  « déposer une copie dans N boîtes aux lettres » (écrire) vs « ouvrir UN classeur pour fouiller » (lire). TODO page Logs.
- `[1× — 2026-06-01]` **image Docker distroless = AUCUN healthcheck interne** (`grafana/loki:3.7.2` n'a ni
  `/bin/sh` ni `wget`/`curl`) : un `healthcheck: CMD-SHELL` échoue à vie → conteneur « unhealthy » à tort →
  un `depends_on: condition: service_healthy` (Grafana) reste **bloqué en « Created »** (jamais démarré). →
  PAS de healthcheck sur un distroless (sonder côté HÔTE `curl :port/ready`), et `depends_on: service_started`.

## 🧭 État projet / git / terminologie (frictions du jour)

- `[1× — 2026-06-06]` **une règle CLAUDE.md figée ANTÉRIEURE à une archi décidée récemment ne doit pas BLOQUER** :
  j'ai posé un `AskUserQuestion` sur le foyer de `RedisSessionStorage` parce que le CLAUDE.md redis disait « redis
  neutre, storage ailleurs » — alors que le **plan session du jour** (kit) primait. Le user a recadré (« le claude.md
  de redis est fait avant notre nouvelle archi, le plan session prime »). → décision archi récente (kit/plan en cours)
  prime sur une règle figée de module : **trancher + MAJ la règle obsolète**, ne pas se bloquer
  ([[feedback_permission_autonomy]] : AskUserQuestion réservé au non-déductible ; ici c'était déductible du plan).
- `[1× — 2026-06-04]` **« chantier CLOS » en mémoire ≠ fini pour le user** : le chantier config app était marqué
  CLOS (5 lots, `…5df006c`) ; le user : « le chantier config on a rien fait, juste la première étape ». Il le
  voyait comme l'**étape 1** d'un chantier DX bien plus large (`defineConfig`). → quand le user rouvre un sujet
  « clos », ne PAS opposer le statut mémoire : faire l'état des lieux factuel + **clarifier le PÉRIMÈTRE** qu'il a
  en tête. Variante de « vérité = réalité, pas le journal ».
- `[1× — 2026-06-04]` **user dit « c'est le foutoir » → ÉTAT DES LIEUX factuel AVANT toute proposition** : arbre du
  répertoire + rôle de chaque fichier + sources de confusion classées, PUIS la cible. A débloqué la session (vision
  validée juste après). Ne pas sauter directement à la solution.
- ✅ retiré (CONSOLIDATE 2026-06-12) : « commits non pushés = user perdu » — **résolu par le skill
  END** (§4 : push du repo projet à chaque clôture).
- `[1× — 2026-05-31]` **deux « backplanes » homonymes prêtent à confusion** : **Realtime Backplane**
  (P13.x, `IBackplane` Redis/IPC — `P13.5 RedisBackplane` ✅ FAIT) vs **Log Backplane** (P3.11, `ILogDriver` —
  `LB.5` agrégation cluster ⬜ PAS FAIT). Même « .5 », même mot « cluster » → le user a cru LB.5 fait en voyant
  P13.5. → **toujours désambiguïser explicitement** « backplane realtime » vs « backplane logs » (et le n° de
  sous-tâche) dès qu'on parle cluster/backplane. Capté dans [[project_log_backplane_vision]].
- ✅ retiré (CONSOLIDATE 2026-06-12) : « vérifier le CODE avant d'annoncer il reste X » (2×) —
  **gravé comme garde-fou §2 du mode RESUME** (skill `nodefony-session` : la vérité = les commits).
- `[1× — 2026-05-31]` **pre-push `npm run typecheck` global casse sur dist/types croisé périmé** : TS2307
  `@nodefony/user → @nodefony/orm-core` (modules NON touchés par mon diff) → push refusé. → avant un push qui
  déclenche le typecheck turbo, `npm run build` (régénère tous les `dist/types`) si on a buildé des modules à la
  main. Variante stale-dist [[feedback_root_dist_stale_modules]]/[[feedback_turbo_cache_stale_logs]].
- `[1× — 2026-06-05]` **hiérarchie de fraîcheur : Code > Mémoire IA > MD modules > `MIGRATION_STATUS.md`.** Le dashboard,
  tenu à la main en fin de session, est STRUCTURELLEMENT le plus en retard (audit : `DETTE-CFG` marquée 🚧 alors que résolue
  dans le code ; vision ORM pré-virage ; refs mortes PM2/mikroorm ; daté de 6 j). → au RESUME le dashboard ment plus que la
  mémoire ; **confronter au code** (garde-fou « vérité = commits »). Le tenir EN CONTINU (cellule courte + détail ailleurs)
  sinon refonte coûteuse imposée (278→32 KB en une passe). Variante de « vérité = réalité, pas le journal ».

- `[1× — 2026-06-08]` **merger les `refactor/*` dans `claude-ts` AU FIL des chantiers, pas en lot tardif** : `refactor/session-runtime` avait accumulé **33 commits / 5 chantiers** (session runtime + forwarded/proxy + certificats + statics/CDN + audit ORM) avant merge. Le user : « ce merge aurait dû être avant ». Ici sans douleur (FF, 0 divergence) mais le risque de conflit croît avec la divergence. → proposer le merge dès qu'un chantier est CLOS+poussé, ne pas laisser une branche de travail diverger sur plusieurs sujets. Variante de [[feedback_commit_fr_apostrophes]]/commits-non-pushés.
- `[1× — 2026-06-08]` **demande de merge + « ATTENTION aux branches !!! » → l'ÉTAT DES LIEUX git EST la réponse, pas l'exécution** : `fetch` + `merge-base` + `--is-ancestor` (FF ?) + divergence (`A..B` des deux côtés) + cible (`claude-ts` **≠** `main`) AVANT de proposer. Montrer « FF, 0 conflit, 0 divergence, main intouché » rassure l'expert anxieux mieux qu'un merge immédiat. `--no-ff` pour garder un repère d'intégration annulable d'un bloc.
- `[1× — 2026-06-08]` **gros chantier de refonte → AUDIT exhaustif AVANT (pas juste relire le kit)** : avant le virage ORM, balayer code+mémoires+docs+**Studio**+**sondes realtime**+**externe** a débusqué des pièges invisibles depuis le kit : **2 `Orm` homonymes** (legacy core ≠ `@nodefony/orm-core` à garder → risque de supprimer la mauvaise cible) + **dette C5** (montage data plane ORM déclenché par Drizzle → app Mongoose-only muette). Le user a élargi le scope 2× (« tu as regardé Studio ? les sondes realtime aussi »). → pour une refonte, cartographier la **surface COMPLÈTE** (front + observabilité incluses) dès le départ ; le doc d'audit devient la boussole d'exécution.

## 🔎 Vérification / preuve runtime (frictions du jour)

- `[1× — 2026-06-19]` **« Qui dépend de X ? » : un grep des imports `*.test.ts` ne voit PAS les bancs
  d'intégration** : conclu à tort « aucun test ne dépend du `users` du module test » en regardant les tests
  UNIT (fixtures locales). FAUX — ~10 bancs d'INTÉGRATION (`firewall-auth`, `securityGuard`…) bootent le
  serveur dev complet (`describe("… requires server")`, port 5152) et tapent `/nodefony/test/secure/*` → ils
  dépendent du `users` posé par le module test SANS l'importer. Pour l'impact d'une suppression : distinguer
  unit (import direct) vs intégration (vrai serveur + routes du module chargé), et PROUVER par un run des
  bancs « requires server », pas par un grep d'imports. (Devise « le kit/grep n'est pas le terrain ».)

- `[1× — 2026-06-17]` **un changement CSP se prouve au BANC LIVE, surtout en PROD — les unit ne voient PAS
  les directives manquantes.** Étape B nonce : security unit 317 + http intég 502 + memory 9/9 VERTS, mais le
  banc live (le user dans son navigateur) a révélé EN CASCADE 4 oublis invisibles aux tests : scripts inline
  (preamble/HMR/debugbar) sans nonce ; `'self'` absent de connect/style/img/font (n'héritent PAS de
  `default-src` → fetch/styles/images same-origin bloqués) ; `style-src 'unsafe-inline'` manquant (le nonce ne
  couvre PAS `style=""` du CSS-in-JS) ; `img-src data:` manquant. **Leçon : CSP = défaut RÉALISTE COMPLET
  d'emblée (pas directive-par-directive) + banc live dev ET prod (CSP prod strict ≠ dev permissif Vite).**
- `[1× — 2026-06-17]` **sous un banc prod, séparer « mon diff » de « config app incomplète ».** Le user a
  enchaîné des échecs prod (login 500, passkey 401) que j'ai dû prouver NON-CSP : logs `AuthFlow aucun service
users`, webauthn/options 200, un 401/500 **serveur** ≠ blocage CSP (« Refused to connect »), rpId=localhost
  refuse IP/vhost. Cause = UserService absent en prod (modules policy dev). **Diagnostiquer vite évite de
  débugger la config du user en croyant à sa propre régression.**
- `[1× — 2026-06-20]` **un test d'intégration en arrière-plan qui ne produit AUCUNE sortie (1 ligne) = HUNG,
  pas lent.** Le user a flairé « c'est trop long » avant moi. Diagnostic = log serveur + `curl --max-time` (révélé
  `SqliteError NOT NULL constraint failed` → 499/timeout 5s sur chaque route à session), PAS attendre. Réflexe :
  dès qu'un banc « requires server » traîne, `curl` une route + `grep ERROR/CRITIC` le log AVANT de re-runner.
- `[1× — 2026-06-20]` **ne pas conclure « terrain sain » sans preuve, surtout quand une mémoire de décision
  existe.** Sur `contextSession` j'ai affirmé « `destroy(oldId)` vise le bon namespace, terrain OK » en lisant
  le code — le user a dû corriger 2× (« c'est pas fini contextSession » / « on avait tranché de le supprimer »).
  La mémoire `project_session_context_strategy_gap` portait la décision. Réflexe : un concept transverse douteux
  → chercher SA mémoire de décision AVANT de trancher « sain », et la confronter au code (devise « confiance ≠ contrôle »).
- `[1× — 2026-06-17]` **défaut d'un module = parfois 2 sources (`config/config.ts` humain + `.default()` Zod)
  → config.ts PRIME (valeur présente ⇒ Zod default ignoré).** Changé le défaut CSP côté Zod seul → runtime
  inchangé. **Re-mordu 2× la même session** (sur style-src). Aligner les DEUX + commenter le lien. (Variante de
  [[feedback_convention_frere]].)
- `[1× — 2026-06-15]` **feature de CÂBLAGE multi-requêtes → banc d'intégration AVANT de dire « fait » ; les
  smoke curl manuels ne suffisent pas** (J9 WebAuthn). J'avais build/typecheck/memory/security-review verts +
  1 test unit (store) + des curl manuels → j'ai annoncé « prêt ». Le user a trouvé **3 bugs EN LIVE** que je
  n'avais pas : (1) QR au lieu de Touch ID (`authenticatorAttachment` manquant), (2) « No challenge » au login
  (session anonyme jamais démarrée → challenge nulle part), (3) « verification failed » (store mémoire vidé à
  chaque restart). Aucun n'apparaît dans un curl rapide options→verify ENCHAÎNÉ ; tous sont du **câblage
  cross-requête** (session, persistance, état navigateur). → pour TOUT flux multi-requêtes (auth, sessions,
  cérémonies), écrire le **banc d'intégration serveur réel** (login → options → verify, anonyme inclus) AVANT
  de qualifier « fait ». Le user l'a explicitement réclamé ; j'aurais dû le faire d'office (la devise CLAUDE.md).
- `[1× — 2026-06-15]` **bug front↔back sans navigateur = LOGS serveur (status/req) + curl REPRO** (J9). Les 3
  bugs ont été localisés par `grep "POST 4xx … webauthn" /tmp/nodefony-server.log` (register 200 / login.verify
  400 → câblage session) puis reproduits en curl (options anonyme → 0 cookie → verify 400). Le « 400 » du toast
  navigateur ne dit pas OÙ ; le log serveur par requête + le curl repro tranchent sans headless (règle projet).
- `[1× — 2026-06-15]` **`session.set(k,v)` ne survit PAS à la requête sans `save()` EXPLICITE** : une session
  démarrée puis mutée dans la MÊME requête (`start()` + `set(challenge)`) n'est pas relue à la requête suivante
  — le `saveSession` de fin de requête ne suffit pas (cookie posé mais blob sans le champ). Fix prouvé : `await
session.save()` juste après le `set`. Symptôme = la valeur « disparaît » entre 2 requêtes (challenge perdu).

- `[1× — 2026-06-15]` **la CAUSE RACINE d'un kit/mémoire peut être 100 % FAUSSE — la prouver au terrain, pas la
  croire** (J8 volet b). Le kit affirmait « JWT stateless → `getUser()`=anonyme → réécrire l'authenticator ».
  Le code disait l'INVERSE (`JwtAuthenticator` recharge déjà le vrai user au verify). La VRAIE cause = un
  **dual-package hazard** : le module `test` ne déclarait pas `@nodefony/realtime` (peerDep + `external` rollup)
  → rollup bundlait une 2ᵉ copie → **`RealtimeHub` dupliqué** → l'authenticator câblé par le firewall (hub
  canonique) invisible → token anonyme → garde 403. **Le code sécu était CORRECT** (banc cookie le prouvait) ;
  c'est le FIXTURE qui était mal packagé. Fix = 3 lignes (external + peerDep), 0 changement de sécu. Devise
  « la confiance n'exclut pas le contrôle » : un diagnostic non câblé au terrain envoie sur une fausse piste.
- `[1× — 2026-06-15]` **un log DIAG qui NE FIRE PAS = le code instrumenté n'est pas celui qui s'exécute**
  (heuristique de debug). `onHandshake` loggait pour Studio mais JAMAIS pour le banc m2m, alors que « client
  connected » (DANS `onHandshake`) apparaissait → preuve qu'une 2ᵉ copie (non instrumentée) du module était
  chargée. Quand l'instrumentation est muette là où elle devrait parler : suspecter un **module dupliqué/dist
  périmé**, pas sa propre logique. (Bruit utile écarté en taguant chaque DIAG par l'URL de handshake.)
- `[3× — 2026-06-14]` **bancs E2E réels = seul moyen de voir les trous d'ASSEMBLAGE** (J8 socket — réaction
  user « il manque plein de tests E2E !! »). 4 trous sécu trouvés en 1 session, **tous avec unit VERT** :
  token WS sans `getUser()`, `realtime` opt-in fail-open, 403 garde → `-32603` opaque, JWT stateless
  `getUser()=anonyme`. Un stub ne reproduit ni le token réel, ni l'ALS, ni le handshake. → **matrice E2E
  `[transport(HTTP/WS) × mode d'auth(anon/session/jwt) × décision(grant/deny)]` comme GATE rempli AU FIL DE
  L'EAU**, pas en clôture J10. ⚠️ **SEUIL 3× ATTEINT → à GRADUER en `feedback_*` au prochain CONSOLIDATE.**
  Renforce [[feedback_security_audit_surface_matrix]].
- `[1× — 2026-06-14]` **piège `tail -N` sur les logs serveur** : quand 2 bancs tapent le même serveur, `tail`
  NOIE le banc B sous le banc A → m'a fait conclure 2× à tort « le firewall n'est pas appelé ». Utiliser un
  **grep ciblé** (`grep -A1`, filtre par path/zone), jamais `tail` aveugle pour un diagnostic comparatif.
- `[2× — 2026-06-13]` **l'intégration > l'unit pour un PONT inter-briques** (point du user, répété) : sur le
  verrou WS J3b, l'unit était 100 % vert mais l'intégration + le navigateur ont révélé **3 bugs invisibles à
  l'unit** : `handshake.url` ABSOLUE (`wss://host/path` → un matcher de zone `^/nodefony/…` ne résout jamais
  l'authenticator), close WS **1011 au lieu de 1008** (le client reconnecte en boucle au lieu d'abandonner),
  **liveness `/health` gatée** (pingée pré-login → 401 → login Studio impossible). Pour un pont, écrire le
  banc d'intégration AVANT de croire l'unit. Cf [[feedback_security_audit_surface_matrix]].
- `[1× — 2026-06-13]` **CO-ÉVOLUTION : changer un contrat backend casse les consommateurs SILENCIEUSEMENT**
  (build/tests verts) — verrouiller `/nodefony/*/api` (data plane) a cassé le login Studio (ping `/health`
  pré-login + socket au boot anonyme tapaient le gaté). Quand on gate/change un contrat, **auditer les
  CONSOMMATEURS** (front Studio, CLI, debug bar) dans la même passe. Sous-leçons gravées en code : (a)
  **liveness = PUBLIC** (Zero Trust protège les DONNÉES, pas `/health`/`/info` — sondes k8s + ping pré-login) ;
  (b) **refus d'auth WS = close 1008 (Policy), jamais 1011 (Internal)** sinon boucle de reco client ; (c)
  **décorateur sans argument = SANS parenthèses** (`@BypassFirewall`, drapeau ≠ factory).
- `[1× — 2026-06-13]` **un kit/plan « béton » n'est PAS le terrain — contrôler chaque ancrage `fichier:ligne`
  AVANT d'éditer** : J3b, 3 ancrages du kit périmés, dont le pire — `bypassFirewall` était consommé en AVAL
  (`handleSecurity` le lit) MAIS le constructeur `Route` ne lisait pas l'option → `createRoute({bypassFirewall:true})`
  restait `false` → les routes de login seraient tombées dans l'aire = **deadlock**. « La prise existe, le courant
  ne passe pas » : vérifier la CHAÎNE complète options→…→consommateur, pas juste les 2 bouts. Devise gravée en
  tête du CLAUDE.md racine (« la confiance n'exclut pas le contrôle »).
- `[1× — 2026-06-13]` **suspecter SON diff avant de blâmer l'existant + prouver le bug par 1 test ciblé** : le
  401 sur `/test/secure` venait de MON `sessionContext` (cookie rangé casier « nodefony », la zone cherche
  « default »), pas d'une régression. Lancé `session-bff` → 1 test rouge ciblé → cause confirmée AVANT de corriger.
- `[1× — 2026-06-13]` **mesurer l'effet de bord AVANT de committer** : fermer le data plane HTTP a aussi fermé le
  **handshake WS** (le firewall tourne sur le handshake) → mesuré (`api-souverain-bridge` 9 fails) → décidé
  skip + Étape 3, au lieu de découvrir le rouge post-commit.
- `[1× — 2026-06-13]` **« au cas où » bien intentionné = sur-ingénierie : faire LE POINT des consommateurs avant
  d'ajouter** : `sessionContext` ajouté sur l'aire pour « isoler l'admin » → cassait le login partagé, et la
  brique qui l'aurait sauvé (traversée de contexte legacy `checkChangeContext`) a **0 consommateur** → non portée.
  Retiré. Avant d'ajouter un champ/mécanisme : grep ses consommateurs réels + valider contre l'état de l'art
  (ici OWASP/RFC 6265 : isolation admin = RBAC, jamais un casier de session).
- `[1× — 2026-06-12]` **auditer les `.describe()` Zod CONTRE l'implémentation qui les consomme** : un describe
  est une promesse de contrat — la config S1 security promettait « chaîne, tous doivent passer » quand le
  firewall faisait « premier qui supporte gagne » (ambiguïté MFA/step-up latente, détectée à l'audit P6,
  tranchée S0 par `mode: first|all`). À l'audit d'un module : confronter chaque describe au code consommateur.
- `[2× — 2026-06-12 ×2]` **vérifier le CONTRAT (et la VALEUR d'une constante) avant de coder dessus** :
  (a) `findById` vit sur `AbstractCrudService`, PAS sur `IRepository` — présumé par habitude CRUD → TS2339 ;
  (b) J1 : 3 assertions écrites avec `identifier === "anonymous"` présumé → la constante réelle est
  `anon.` (`AnonymousUser.ts`) → 3 fails du 1ᵉʳ run. 30 s de grep de la source évitent un cycle test-fix.
- `[1× — 2026-06-12]` **tester un Service hors kernel via son contrat PUBLIC (pas d'extraction de fonction
  pure)** : la sémantique de chaîne du firewall (`mode first|all`, Zero Trust, challenge) est testée en
  instanciant `new Firewall(fakeModule)` (Container+Event réels, `kernel` absent → `#build` jamais appelé)
  - `registerAuthenticator(spy)` + `handleSecurity(fakeContext)` ; l'identité se vérifie DANS un
    `RequestContext.run(...)` (teste l'ALS en prime). 13 tests sans booter un kernel ni dupliquer la logique
    en fonction exportée-pour-test. Réf : `security/tests/unit/firewallChain.test.ts`.
- `[1× — 2026-06-12]` **Gates toutes vertes ≠ pas de régression quand le diff INTERCEPTE un chemin global** :
  le pont ApiClient→socket (tous les GET Studio détournés) avait tests unit verts + tsc 0 + suite intég pont 9/9…
  et a cassé Studio À LA CONNEXION (`/auth/me`/`/stats`/`/health` GET-only → 405 du pont propagé ≠ réponse REST).
  Les tests unit mockaient la socket avec les MÊMES hypothèses fausses que le code ; la suite intég testait le pont
  nu, pas la consommation. → pour un diff qui intercepte un chemin partagé, **dérouler les call-sites RÉELS de
  l'app** (routes effectivement appelées au boot/login) contre le serveur réel AVANT « fait » — le user ne doit pas
  être le test E2E. (Leçon de fond — « erreurs du pont jamais propagées » — gravée dans `nodefony-studio-dev` 1.24.0.)
- `[1× — 2026-06-12]` **Multi-bundle Vite = N instances : curl `@fs` d'un `.tsx` React sur l'instance ANGULAR
  (autre port 517x) → faux 500 « invalid JS syntax »** alors que tsc est vert. Discriminer : tester un `.tsx`
  témoin non modifié, chercher `[angular] [vite] Internal server error` au log, `lsof` les ports. → si revu,
  reporter la garde « identifier la bonne instance » dans `nodefony-frontend-verify`.

- `[1× — 2026-06-07]` **prouver un parse côté serveur SANS toucher au banc = curl loopback (trusted) avec le header brut** :
  pour valider le parse `Forwarded` RFC 7239 en runtime, `curl -H "Forwarded: for=…;proto=https" localhost:5151` +
  lire le **log `req`** (`GET 200 <scheme>://<host>/… <ms> <IP>`) → le scheme/IP résolus sont visibles directement.
  Plus rapide et discriminant que monter tout le banc Docker (ex. `Forwarded proto=https` + `X-Forwarded-Proto http`
  → si le log montre `https`, la priorité Forwarded est prouvée).
- `[1× — 2026-06-07]` **bind-mount macOS : `docker exec <c> nginx -t` JUSTE après un Edit lit une version en cours
  d'écriture** (« unexpected end of file ») alors que le fichier disque est valide. Revalider sur le DISQUE
  (`docker run --rm -v fichier nginx -t`) puis **recréer le conteneur** (`up -d --force-recreate <svc>`) pour qu'il
  relise. Et `000` sur TOUS les ports du banc = souvent **le démon Docker tombé** (`docker ps` → « Cannot connect »),
  PAS un bug du code — vérifier le daemon avant de suspecter le diff.
  > ♻️ CONSOLIDATE 2026-06-12 : les frictions **memory.test** (serveur LANCÉ requis / ECONNREFUSED ≠
  > fuite, vu 3× — les tests TAPENT le serveur dev, ils ne le spinnent pas · flake marginal → isolation
  > = vérité · gate GC forcé via start.sh `--expose-gc`) sont **gravées dans les skills**
  > `nodefony-check-memory-health` (prérequis + séquencement filet CLI) et `nodefony-debug` (recettes
  > A + C) — retirées d'ici.
- `[1× — 2026-06-02]` **`tsx` transpile-only laisse PASSER un test qui lit un field supprimé** : après avoir
  retiré le field `type`, un test `assert.strictEqual(k.type, "CONSOLE")` lit `undefined` → devrait échouer,
  mais affichait « 0 failing » à un instant (transpile-only ignore le TS2339). → après un rename/suppression
  de field, **grep les refs au field dans les tests** et migrer manuellement (le build les flag, le runner non).
- `[1× — 2026-06-05]` **un écart « déclaré vs réel » fondé sur une métrique de SURFACE (présence de fichiers) peut être une
  FAUSSE alerte** : à l'audit migration j'ai classé « P15 = 0 % CONTREDIT par `src/modules/mediasoup` (8 src + dist) » 🔴 →
  le `package.json` disait `description: "banc test ORM"` (≠ implé télécom P15). → avant d'affirmer un écart, **sonder le
  CONTENU** (description, fichiers réels, ce que ça FAIT), pas juste l'existence. L'audit exhaustif corrige ses propres
  hypothèses de surface — d'où sa valeur (≠ audit de surface qui les fige).

- `[1× — 2026-06-01]` **`grep $'\x1b'` ne trouve RIEN dans un `.jsonl`** : `JSON.stringify` encode
  l'octet ESC (0x1b) en **texte ``** (6 chars), pas l'octet brut → chercher l'ANSI baké dans un
  log JSON = `grep 'u001b'` (ou `\\u001b`), JAMAIS le byte ESC. Vécu : conclu à tort « 0 ANSI » sur la
  preuve de la gate couleur avant de corriger le grep.
- `[1× — 2026-06-01]` **DevSupervisor casse la baseline before/after par mtime** : en dev, chaque save
  `.ts` → rebuild+restart auto → les fichiers « anciens » (par date de fichier, ex. `logs/*.jsonl`,
  `dist/`) sont en fait DÉJÀ le nouveau code. Comparer ancien↔nouveau par mtime ment. → pour une vraie
  preuve avant/après : `git stash` + rebuild (cher) OU **raisonner sur le mécanisme** (ici : `clc.x.y`
  produit de l'ANSI même en pipe → si c'était l'ancien code, le payload serait coloré ; il est brut →
  c'est le nouveau). Idem memory-test flake sous charge cumulée (720 intég PUIS memory même serveur =
  échec rotatif) → isolation + serveur frais = vérité (déjà gradué, cf skill `nodefony-debug`).
- `[1× — 2026-06-01]` **tester un agrégateur cluster = asserter `total == unique`, PAS « je vois mes N
  workers »** : mon « test ultime » du driver `cluster-file` comptait les `pid` distincts dans une relecture
  (agrégation OK) → a RATÉ un doublon de lignes (ratio 2.0, chaque log écrit 2×). Compter les pids uniques
  MASQUE mécaniquement un doublon. Pour un agrégateur/merge, vérifier l'INTÉGRITÉ (unicité), pas la couverture.
- `[1× — 2026-06-01]` **instrumenter (stderr + rebuild) tranche là où la lecture de code spécule** : la
  mémoire `project_cli_module_command_dispatch` disait kernel #1 « orphelin jamais booté » → l'instrumentation
  a PROUVÉ qu'il boote COMPLÈTEMENT en development (4 `initializeLog`/worker = 2 boots dev+prod). Une note
  mémoire écrite depuis une lecture partielle ment ; re-prouver empiriquement AVANT le fix (renforce ci-dessous).
- `[1× — 2026-06-01]` **⚠️ CORRECTION d'une note RETEX précédente = la cause supposée était FAUSSE** : la
  session passée avait noté ici « doublon JSONL = `setActiveLogDriver` ré-attache le tap sans removeListener
  (après des switchs) » → cette hypothèse a migré dans le `_state` comme prochaine tâche. **La vraie cause
  (trouvée en lisant le code + repro live `1335 l/669 uid`) : `initializeLog()` est appelé 2× au boot**
  (logger précoce dans `start()` + re-init post-config dans `loadApp()`) et re-monte un 2ᵉ `FileTransport`
  sans retirer le 1er ; `addTransport` dédup par RÉFÉRENCE → 2 instances distinctes passent. **Rien à voir
  avec un switch** — le doublon naît dès le boot, 0 switch. Fix `Kernel._mountedLogTransports` idempotent
  (`6814c05`). → **Leçon méta : une note RETEX/\_state écrite depuis une HYPOTHÈSE non vérifiée ment ; au
  RESUME, re-prouver la cause (code + empirique) AVANT de coder, ne pas copier le diagnostic du `_state`.**
- `[1× — 2026-06-01]` **un filet de boot doit prouver l'INTÉGRITÉ, pas juste « ça écoute »** : mon filet CLI
  attendait `Server Listen` → vert MÊME avec un module en fail-soft (`Cannot find package @nodefony/test`) →
  serveur up mais module absent → routes 404. **Le user l'a vu, pas moi** (« tu n'as pas regardé dans tous les
  coins »). Même famille que « agrégateur = total==unique » ci-dessus : vérifier l'INTÉGRITÉ, pas la couverture.
  → asserter que les modules CHARGENT (`MODULE ADD: X` + une route du module → 200), pas seulement le listen.
  Filet durci (`b05e381`).
- `[1× — 2026-06-02]` **tester `BootReporter`/le boot dev sans TTY = lancer le DevSupervisor, PAS `start.sh`** :
  `BootReporter` n'est instancié QUE par `DevCommand` côté enfant supervisé (`NODEFONY_DEV_CHILD=1`) → `start.sh`
  (boot direct, sans DevSupervisor) ne le déclenche pas. Pour le valider j'ai lancé `npx nodefony development`
  detached non-TTY → mode statique (`#animated=false`) : pas de spinner mais l'ORDRE est prouvé (phases →
  bannières → `✓ Frontend (Vite)` → `✓ Prêt`). Le rendu ANIMÉ (TTY) reste à valider par le user (pas testable
  hors terminal interactif).
- `[1× — 2026-06-02]` **`npm exec nodefony development` AVALE le SIGINT → orphelins Vite** : un `kill -INT` sur le
  PID du wrapper `npm exec …` ne propage PAS au DevSupervisor → enfant + instances Vite survivent (ports 5151/5152/
  5173/5177 squattés). En Ctrl+C TTY réel le group-kill marche (le DevSupervisor est leader de groupe). Pour un
  arrêt fiable d'un lancement background : `pkill -INT -f NODEFONY_DEV_CHILD` + `pkill -f nodefony-vite` +
  `lsof -ti:5151,5152,5173,5177 | xargs kill -9`. NE PAS compter sur le SIGINT au wrapper npm.

## 🧱 Core / pipeline / perf (frictions du jour)

- `[1× — 2026-06-14]` **`#privateMethod` casse le proxy de test `Object.create(prototype)`** (brand check JS →
  `TypeError: Receiver must be an instance of class X` quand une méthode publique appelle `this.#priv`). Le Resolver
  se teste via `Object.create(Resolver.prototype)` + champs injectés (ctor lourd contourné) → utiliser la convention
  du fichier : **`private _xxx` (TS, effacé au runtime = méthode normale)**, PAS `#xxx`. Vécu : `#enforceSecurity`/`#resolveSubject`
  → 7 fails, convertis en `private _`. Matcher la convention de privacy du fichier (Resolver = `private _`).

- `[1× — 2026-06-11]` **🚨 un RPS ABSOLU ne se compare JAMAIS entre deux fenêtres temporelles — toujours rebencher la baseline DANS la fenêtre courante**
  avant de crier à la régression : le user a vu « j'étais à 7000, là 3674 » (−45 %). C'était la **charge ambiante** (Brave
  renderer 45 % + GPU 36 % + claude 67 % ≈ 2 cœurs mangés), PAS le code. Preuve : `git checkout <ref pré-changement>` +
  rebuild 4 workspaces + rebench **dans la même fenêtre** → pré-V5 5385 vs branche 5368 = **0,3 % d'écart** (bruit pur). Les
  `.med` dans `/tmp/nf-bench-*.med` gardent l'historique d'hier (6673-7078) MAIS ils datent d'une autre fenêtre → inutilisables
  comme référence aujourd'hui. Seules les **paires alternées intra-fenêtre** comptent (méthode déjà gravée, à appliquer AUSSI
  pour réfuter une fausse régression, pas seulement pour prouver un gain). Cf [[reference_perf_profiling_method]].
- `[1× — 2026-06-11]` **`typeOf(Buffer)` = `"buffer"`, PAS `"object"`** (Tools.ts teste `_gBuffer.isBuffer` AVANT `isArray`/object) :
  un `return Buffer` d'une action tombait dans le `default` du `Resolver.returnController` → AUCUN envoi → requête pendue
  jusqu'au timeout 408. Tout `switch(typeOf(x))` qui veut traiter un Buffer a besoin d'un `case "buffer"` DÉDIÉ. Même piège
  latent pour Date/RegExp/Error (typeOf leur donne un tag propre).
- `[1× — 2026-06-11]` **DI Container : si un Scope ADOPTE le prototype de services du parent (perf), `Scope.set`/`remove` DOIVENT être overridés own-property-only**
  — sinon l'écriture prototype de `Container.set` (`protoService.prototype[name]=…`) touche le proto **PARTAGÉ** du parent → un
  service per-request (controller, context) devient visible de TOUTES les requêtes concurrentes = data race silencieuse. Gravé
  MEMORY.md core + 4 tests garde-fous. L'optim (1 `Object.create` au lieu de 2 + seq id au lieu d'uuid + Map scopes lazy) a
  donné +6 % RPS A/B mais ne tient QUE si l'isolation own-only est préservée.
- `[1× — 2026-06-11]` **aplatir un `new Promise(async executor)` RÉVÈLE des bugs cachés** (pas qu'un refacto cosmétique) : le
  `return super.send()` placé DANS l'executor d'`Http2Response.send` ne résolvait JAMAIS la promesse externe (hang à vie quand
  `this.stream` absent) ; un `throw e` après `reject(e)` dans un executor est silencieusement avalé. Le motif `new Promise(async)`
  avale aussi tout throw de l'executor (rejet muet/pendu selon le timing). → traquer ces sites au durcissement, pas juste cosmétique.
- `[2× — 2026-06-11]` **A/B : écarter une paire ABERRANTE et la REFAIRE (jamais conclure dessus)** : V4, paire 2
  singleton 5317 RPS vs 6495/6887 sur la MÊME URL (+30 % d'écart interne) = pollution machine ponctuelle ; la paire 3
  inversée (singleton d'abord) a redonné +5,0 %. Verdict honnête publié : « dans le bruit » — ne JAMAIS revendiquer un
  gain sur des paires incohérentes entre elles. Complète la leçon warmup ci-dessous.
- `[1× — 2026-06-10]` **A/B sans toggle env = bascule git + rebuild ciblé ; JETER la 1ʳᵉ paire si machine froide** :
  pour un refacto NON toggleable (Resolver POJO), `git checkout <ref> -- src/…/framework` + rebuild workspace (~3 s)
  entre les runs marche très bien avec `bench-ab-mono.sh`. MAIS paire 1 polluée (warmup machine : new1 6527 < old2 6619
  inter-paire, run aberrant 5131) → il a fallu 3 paires. La SEULE comparaison fiable = intra-paire alternée (3/3
  positives +4,5/+8,4/+6,1 %) ; prévoir d'office 3 paires ou sacrifier la 1ʳᵉ en warmup.
- `[1× — 2026-06-10]` **décorateurs TS = bottom-up AUSSI pour l'ordre d'insertion des metadata accumulées** : 2×
  `@Header` empilés → celui le plus PROCHE de la méthode s'exécute en premier → `headerEntries` dans l'ordre INVERSE
  de la lecture visuelle. Frappé dans une assertion de test (deep.equal sur l'ordre). Comportement runtime inchangé
  (même objet que l'ancien `Object.entries`), mais toute assertion d'ordre doit suivre le bottom-up.
- `[1× — 2026-06-10]` **toggle de bench A/B = const MODULE-LEVEL, jamais `process.env` dans le hot path** :
  un `process.env.NF_BENCH_X` lu par event (~100-200 ns, accès C++) pénalise le run « new » censé être un
  return sec → gain sous-estimé. → `const BENCH_X = process.env.NF_BENCH_X === "1"` au chargement (coût
  identique aux 2 runs), et le run « old » simulé doit reproduire la SÉVÉRITÉ exacte d'avant (DEBUG en prod,
  pas la promotion INFO) sinon le old est artificiellement plus cher. Bloc TEMP retiré avant commit (0 résidu
  `NF_BENCH` dans src/ = convention vérifiée).
- `[1× — 2026-06-10]` **code de close WS au handshake : viser le code WS DIRECTEMENT, pas un statut HTTP** :
  `error-renderer.renderWebsocket` a 2 branches selon `context.rejected` ; au handshake (`rejected===false`) il
  **clampe tout code `<1000` → 1011** → un `HttpError(403)` ne devient PAS 1008. Pour fermer en **1008** (Policy
  Violation, anti-CSWSH), lever `new HttpError(msg, 1008, ctx)` (code WS 1000-4999 laissé passer tel quel). Tracé en
  lisant `renderWebsocket` AVANT de coder → close 1008 du 1ᵉʳ coup. + Pré-check Content-Length AVANT le streaming =
  rideau cheap (rejet sans lire) ; le compteur `Parser.write` est la défense en profondeur (chunked/menteur).
- `[1× — 2026-06-08]` **config knob DÉCLARÉ ≠ CÂBLÉ (config qui ment)** : `keepaliveInterval`/
  `keepaliveGracePeriod` existent en Zod (`http/config/schema.ts`, desc « détecte les zombies ») mais
  **0 consommateur** → aucun heartbeat WS implémenté. Auditer une config = **vérifier les CONSOMMATEURS**
  d'un knob, pas sa seule déclaration. + committer une phase touchant le pipeline request (SessionStorage)
  SANS `memory.test` = miss (le gate pipeline vaut aussi pour le storage de session) — rattrapé.
- `[1× — 2026-06-08]` **`this.options` d'un module est FLAT (config `use()` deep-mergée par le Kernel)** : `Kernel.ts`
  fait `mod.options = extend(true, {}, mod.options, entry.config)` → lire la config d'un module via `this.options.<clé>`
  directement, JAMAIS sous un namespace `this.options?.<nomModule>`. **Bug réel** : `@nodefony/redis` lisait
  `this.options?.redis` (clé inexistante) → toute config app via `use("@nodefony/redis", …)` **ignorée silencieusement**
  (corrigé). → **vérifier le flux RÉEL (Kernel.ts) avant de copier un « frère »** : redis était un mauvais modèle sur ce
  point (realtime/mongoose = flat = correct). Convention-frère ≠ copier le premier frère venu — copier le frère JUSTE.
- `[1× — 2026-06-08]` **ne JAMAIS se fier à l'ordre de N listeners sur le même event kernel** : `proxy:generate`
  (son `generate()` enregistré tôt sur `onReady`) firait AVANT le listener de montage statique (server-static,
  enregistré plus tard à `onReady`) → `mounts` vide. Fix robuste = rendre le consommateur **auto-suffisant** :
  appel **idempotent explicite** (`mountModulePublics()`) au lieu d'attendre que l'autre listener ait tourné.
- `[1× — 2026-06-08]` **un kernel console CLI ne charge PAS les modules `policy:"dev"`** (test, test-frontend-\*,
  mediasoup). Une commande introspective (`proxy:generate`, `assets:publish`) ne voit que les modules PROD →
  l'absence d'un asset dev (`/test/`) est CORRECTE, pas un bug. Ne pas debugger un « manque » qui est le bon comportement.
- `[1× — 2026-06-07]` **« hot path prod » = le chemin DERRIÈRE proxy, pas le cas sans proxy** (recadrage user :
  « on passe dedans à tous les coups !! »). Un serveur de prod est TOUJOURS derrière un reverse-proxy → la
  résolution forwarded s'exécute à CHAQUE requête. Optimiser CE chemin (cas avec en-têtes), pas seulement le
  fast-exit « pas de proxy ». Leviers appliqués (forwarded.ts) : résolution LAZY (null hors proxy = 0 alloc),
  **fast-path mono-proxy 0 array** (pas de `split`/`map` quand 1 seul maillon — cas dominant 1 ingress),
  `firstToken` via `indexOf`/`slice` (pas `split`), `splitTopLevel` court-circuité sans quote, 1 SEULE passe
  stockée sur l'objet (les getters lisent, plus de re-parse par appel).
- `[1× — 2026-06-07]` **banc anti-spoof = faux positif si le proxy APPEND + le vrai client est dans la plage trusted** :
  nginx `$proxy_add_x_forwarded_for` (append) + curl hôte vu comme la gateway Docker (trusted via `uniquelocal`)
  → le from-right dépouille jusqu'à la valeur FORGÉE (6.6.6.6 ressortait). Pas un bug du code (22 tests unit + tests
  directs `Forwarded:` le prouvent). Leçon SÉCU : un **edge ÉCRASE** le XFF entrant (`proxy_set_header X-Forwarded-For
$remote_addr`, RFC 7239 §8.1), l'append est réservé aux proxies INTERNES d'une chaîne déjà fiable ; et `trustProxy`
  doit être **aussi étroit que possible** (pas toute la plage privée si le vrai client y est aussi).
- `[1× — 2026-06-06]` **`Object.create(null)` casse la sérialisation drizzle-orm** : un objet SANS
  prototype passé à un insert drizzle fait planter `is()` (drizzle-orm/entity.js) → `Object.getPrototypeOf(value).constructor`
  → `getPrototypeOf` renvoie `null` → `null.constructor` throw. Pour TOUT objet sérialisé/inséré via un ORM
  (sacs de session, payloads) utiliser `{}` (avec prototype), PAS `Object.create(null)` — la micro-optim
  null-proto (CLAUDE.md) ne vaut QUE pour des maps internes JAMAIS sérialisées. Invisible en unit (storage
  mocké) + typecheck ; révélé par la gate runtime (storage session dev = drizzle). → candidat `feedback_`.
- `[1× — 2026-06-05]` **profiler perf = banc PROPRE ou mesures FAUSSES (×3 dans la session)** : (a) `NODE_ENV=development`
  hérité dans l'env du spawn → `nodefony production` boote en **dev+Vite+throttle** (~2000 RPS au lieu de 6000) car
  `resolveRuntimeEnv` fait primer NODE_ENV ; **forcer `NODE_ENV=production`** dans le spawn. (b) Les **Vite orphelins**
  (title `nodefony-core`) survivent et **échappent à `pkill -f bin/nodefony`** → tuer par **PORT** (`lsof -ti tcp:5151,5152,5173,5177 | xargs kill -9`)
  - `pkill -f vite.js` + **vérifier `pgrep -c vite.js`=0**. (c) Toujours vérifier que `lsof -ti tcp:5151` == MON PID (sinon
    bench d'un fantôme). Méthode complète + baseline node nu + piège `node --prof` macOS (C++ faux symbole) → [[reference_perf_profiling_method]].
- `[3× — 2026-06-05]` **mesurer un gain AVANT de refondre, et l'abandonner s'il est noyé/négatif** : 3 hypothèses
  « malignes » mesurées en A/B atomique mono → (a) #3 fireAsync 0-listener = bruit ; (b) **différer le `JSON.stringify`
  de l'audit (passer l'OBJET au `Pdu` au lieu d'une string) = −5,3 % CONTRE-productif** — le ring buffer/Syslog RETIENT
  - traite un objet plus cher qu'une string compacte ; stringifier TÔT = le moindre mal (le `Pdu.payload` est `unknown`,
    les transports `JSON.stringify(pdu)` au write, mais le ring memory garde l'objet → pression GC) ; (c) saveSession-skip
    quand pas de session = +0,4 % bruit (ça n'évite qu'1 microtask : `saveSession()` sans session = `Promise.resolve(null)`).
    À l'inverse #1 router-first +28 % et **retrait `setParameters("query.*")` morts +3,2 %** = gains NETS. **Leçon clé : sur
    un pipeline déjà optimisé (post router-first), pas de gros poisson — le seul gain franc = supprimer du travail MORT**
    (les 4 `setParameters("query.*")` peuplaient le scope DI avec des clés que PERSONNE ne lit : @Query/@Param/@Body lisent
    `ctx.request.queryGet` direct). Micro-optimiser l'async/alloc du cœur = ROI faible + risque `memory.test`. **A/B atomique =
    paires ALTERNÉES** (old/new/old/new) en MONO (cluster co-localisé = co-location-bound) ; garder SSI les 2 new > les 2 old.
    Banc versionné : `nodefony-load-test/scripts/bench-ab-mono.sh` (niveau 3). Le vrai prochain levier perf = « fast path »
    (sauter par requête tout l'inutilisé) = chantier, PAS du grattage.
- `[1× — 2026-06-04]` **résilience de la phase config = à blinder SÉPARÉMENT du lifecycle** : `fireLifecycle`/
  `guardInitialize` (Phase 3 du kit boot, DÉJÀ livrée — kit périmé) couvrent les hooks modules, PAS `loadApp`
  (import app + résolution `defineConfig`). Une config invalide y throw une stack opaque. Fix = try/catch →
  `bootConfigError` : diagnostic clair (titre + cause + **champ Zod nommé** + **valeurs PAR DÉFAUT explicites**)
  - erreur marquée `presented` (les catch de boot ne re-loggent pas) + `exitCode` EX_CONFIG=78. **Piège** : le flag
    `presented` doit être respecté par TOUS les catch de la chaîne (loadApp → Kernel.start → **CliKernel.start**),
    sinon double-log stack. **Piège 2** : `nodefony development` (serveur) passe par le catch PRINCIPAL de
    `CliKernel.start()`, PAS `dispatchModuleCommand` (2 catch distincts) → fixer le bon (sinon `terminate(1)` au lieu de 78).
- `[1× — 2026-06-04]` **un descripteur (objet brandé par symbole) SURVIT au spread `{...options}` de Service** :
  un symbole computed enumerable d'object literal EST copié par `{...x}` (≠ idée reçue) → on peut passer un
  descripteur `defineConfig` via `super(name,kernel,url,descripteur)` et `isConfigDescriptor(this.options)` reste vrai.
  Prouvé par test dédié (l'hypothèse de design la plus risquée → la tester explicitement).
- `[1× — 2026-06-01]` **MESURER un gain perf AVANT de l'affirmer** : le « double-boot » prod/cluster (2
  `new Kernel`) était réputé doubler le boot → mesure avant/après (`scripts/boot-bench.mjs`, checkout du commit
  d'avant) : **2721 ms vs 2776 ms = identique** (kernel#1 s'arrêtait à `onStart`, ne bootait NI modules NI
  serveurs ; seul kernel#2 bootait). Gain réel du refacto = **mémoire** (1 container/injector/syslog → cause du
  doublon JSONL) + clarté, **PAS la vitesse**. Ne jamais survendre un refacto « perf » sans chiffre. Audit
  `docs/audits/boot-performance-2026-06-01.md` : 91 % du boot = import/instanciation de modules.
- `[1× — 2026-06-05]` **A/B RPS maison = bruité → 3 runs/côté + comparer les PLAGES, jeter le warmup.** Bench
  concurrent (50 conns, 3-4 s) sur la route réordonnée P2.9 : le 1er run = **warmup à JETER** (1622 vs médiane 1743) ;
  variance ~15-25 % **> écart** baseline↔feature → un verdict sur 1 run est FAUX (le seuil auto « à investiguer » a
  crié à tort). Conclusion correcte = **plages chevauchées = 0 régression** (baseline 1356-1813 vs feature 1622-1755).
  Protocole : baseline = `git stash` + rebuild + restart, bencher les 2 côtés MÊME machine, comparer médianes +
  chevauchement (jamais 1 vs 1). Complète « MESURER avant d'affirmer » ci-dessus.
- `[1× — 2026-06-01]` **daemon CONSOLE : `await new Promise(()=>{})` NE garde PAS Node vivant** : une Promise
  pending n'est pas un handle d'event loop → Node sort dès l'event loop vide. DevCommand/master survivent via
  LEURS handles (child process / workers+IPC+timers), pas le park. Un daemon CONSOLE pur (worker queue, consumer,
  agent) doit tenir un handle explicite (socket/timer). + **splash ASCII affiché par CHAQUE Kernel** (superviseur
  dev parent CONSOLE + enfant serveur = 2×) → gaté dev-only + `NODEFONY_DEV_CHILD` (`e27470e`).

- `[1× — 2026-06-01]` **Mutation d'un Pdu APRÈS `log()` ne corrige QUE le ring `memory`** : les drivers qui
  **sérialisent au write** (`file`/`cluster-file`/`loki`/`opensearch` = la PROD) figent le JSONL au moment
  du `log()`, AVANT toute mutation tardive. Vécu : le bilan `req`/`onFinish` (émis au teardown, hors bulle
  ALS) avait `requestId` vide sur `file` mais OK sur `memory` → trace cassée en prod. **Fix générique** :
  attacher la valeur **À LA CRÉATION** du Pdu — rouvrir une micro-bulle `RequestContext.run({requestId},
() => super.log(...))` quand l'ALS est vide (override `Context.log`). Vaut pour TOUT champ ALS sur un log
  de teardown. Toujours **vérifier sur le driver `file`/distant, pas seulement `memory`**.
- `[1× — 2026-06-01]` **Arbitrage perf↔observabilité = `AskUserQuestion` légitime, et la 3ᵉ voie** : le user
  a tranché « audit complet sévérités » puis s'est alarmé perf (« +volume prod »). La bonne réponse n'était
  NI son choix NI le contraire mais une **3ᵉ voie** : gate par env (INFO hors prod, DEBUG en prod) → 0
  surcoût prod + observabilité dev. Quand un choix produit a un coût hot-path, proposer le **gate
  conditionnel** (résolu 1×, lookup O(1)) plutôt qu'un comportement figé.

- `[1× — 2026-06-02]` **Refondre un field largement consommé : le BUILD TS est le filet ultime, pas le
  grep.** Le grep initial des consommateurs de `kernel.type` a RATÉ plusieurs formes (copies
  `this.type = cli.type` dans `setCli`/`logEnv` ; `?.type !== "CONSOLE"` dans 3 SessionStorage + Orm ;
  `kernel?.type === "SERVER"` cross-module mongoose/sequelize). `npm run build` (rollup plugin-typescript
  `TS2339: Property 'type' does not exist`) les a tous révélés **un par un**. → pour un rename de field :
  grep = 1ʳᵉ passe, **build = vérité** (itérer build→fix jusqu'à 0 TS2339). Et `?.field` défensif pour
  préserver le no-crash quand l'ancien `x === "Y"` tolérait `undefined` (cf `?? true`, `runProfile?.servers`).
- `[1× — 2026-06-02]` **Avant de refondre un flag, VÉRIFIER ce qu'il pilote vraiment.** `KernelType`
  SERVER/CONSOLE était réputé piloter le démarrage serveur → lecture des consommateurs : **quasi-inerte**
  (montage serveur = `kernelEvent` + présence `HttpKernel` ; rester-en-vie = park ; `type` = 4 gates de log
  cosmétiques). A transformé un « gros refacto risqué » en **nettoyage de modèle 0-comportement** (scope A
  validable sous filet). Lire les consommateurs AVANT de présumer l'impact/risque.
- `[1× — 2026-06-03]` **Boot : `debug`/`environment` ne sont résolus qu'à `preRegister` — APRÈS
  `initSyslog`/`loadApp`.** Pour gater quelque chose TÔT (sévérité de log, sélection de module), lire
  `process.argv` directement (comme `bin/nodefony.ts` pour l'env) plutôt que `this.debug`/`this.environment`
  (encore au défaut à `loadApp`). Vécu : `-d` ne relevait pas le silence d'une commande CLI tant que le gate
  lisait `this.debug` (faux à `loadApp`) → fix = `process.argv.includes("-d"|"--debug")`.
- `[1× — 2026-06-03]` **Sortie CLI propre = plancher de sévérité syslog (pas toucher chaque log).** Une
  commande console (`frontend:status`, help global) boote tout le manifeste → ~30 lignes de bruit (MODULE ADD,
  overrides config, ORM connected, banner env, terminate). Fix sans chirurgie : un flag `quietBoot` (posé au
  dispatch help/module) → `initSyslog` plancher la sévérité à `[0..3]`. La sortie de la commande via
  `console.log` (stdout direct, hors syslog) **survit** ; le bruit syslog est coupé ; `-d` rétablit. Le VRAI
  fix (ne pas booter/connecter tout le manifeste pour une commande console) = couches 2-3 [[project_module_loading_architecture]]
  (Phase 11). + **réutiliser `Kernel.isTTY`** (déjà résolu, NO_TTY-aware) au lieu de re-lire `process.stdout`
  (gate couleur boot — rappel user).

## 🔧 Git / commit (friction du jour)

> ♻️ CONSOLIDATE 2026-06-12 : retirés (déjà gradués) — commitlint subject-case/PascalCase/header≤100
> (8×+) → [[feedback_commit_fr_apostrophes]] § « 2 règles dures » · « build vert ≠ typecheck vert »
> (TS4114, TS18036…) → skill `nodefony-framework-dev` §8 (typecheck = gate distinct, hook pre-push).

- `[1× — 2026-06-07]` **clé privée TLS commitée découverte (sécu)** : `git ls-files | grep -iE
'certificates/.*\.(pem|key)'` a révélé `privkey.pem` (+ cert/fullchain/publickey) trackés dans
  `src/packages/@nodefony/http/nodefony/config/certificates/` depuis **sept. 2024**. Cause : le pattern
  `.gitignore` racine `nodefony/config/certificates` **contient un slash → ancré à la RACINE** (ne couvre
  PAS le même chemin dans un sous-module). Fix : `git rm` + motif **`**/nodefony/config/certificates/`**
  (le `**/` couvre tous les niveaux). → **Réflexe\*\* : à tout commit touchant des certs/secrets, `git
ls-files | grep -iE '\.(pem|key|p12|pfx)$'` ; un motif gitignore avec slash n'est jamais récursif.
- `[1× — 2026-06-01]` **`routes/logs/` est gitignoré (pattern `logs`) → nouveaux fichiers invisibles + lint-staged
  « git error »** : créer `routes/logs/profileVisuals.tsx`/`ProfilingTab.tsx` → `git add` les ignore (les fichiers
  EXISTANTS du dossier restent trackés, mais les NOUVEAUX non) → besoin `git add -f`. Et le 1er `git commit` a
  échoué « lint-staged failed due to a git error » (stash/lock transitoire) sans rien perdre → **retry après
  `pkill -f lint-staged` + `rm -f .git/index.lock`** a réussi. Combine [[feedback_git_index_lock]] : sur ce repo,
  toujours `pkill lint-staged/generate-symbols` + `rm index.lock` AVANT un retry de commit raté.
- `[2× — 2026-06-05]` **`git push` en background ne FINALISE pas (hook pre-push lourd)** : le commit se fait, mais la
  branche reste « ahead 1 » sans erreur ni process actif → relancer en **foreground** (peut être rejeté « cannot lock
  ref … is at X but expected Y » = race, le background avait fini par pousser). La vérité = `git log origin/<branche>`,
  pas le « ahead » local. Vu 2× (frontend, framework). → push avec hook lourd = **foreground d'emblée**.
- `[1× — 2026-06-08]` **nouveau chantier ≠ branche de reprise → BRANCHER d'abord** : repris sur `refactor/orm-hardening`
  (ORM) puis committé + **poussé** tout le durcissement **WebSocket** (3 commits) dessus → signalé par le user (« les
  commits WS n'ont rien à faire dans cette branche !! »). Le **START de session doit vérifier que le chantier correspond
  au NOM de la branche** ; si le sujet diffère → `git switch -c hardening/<sujet>` AVANT le 1er commit. (Non réécrit ici :
  déjà poussé + même cible de merge `claude-ts` → coût rewrite > bénéfice ; vigilance au prochain START.)

---

## 🔌 Ports / orphelins serveur (boot resilience)

- `[1× — 2026-06-03]` **orphelin serveur au titre RENOMMÉ → `pkill -f bin/nodefony` LE RATE.** Un
  enfant dev/prod survit à son parent (PPID 1) en gardant 5151/5152, mais son titre est `nodefony
server`/`nodefony worker`/`nodefony-core` (`process.title`/`exec -a`) → `pkill -f "bin/nodefony"` ne
  le voit pas. **Toujours tuer par PORT : `lsof -ti :5151,:5152 | xargs -r kill -9`** (fiable, indépendant
  du nom). Vécu : EADDRINUSE en dev (superviseur mort sans group-kill) ET entre runs du boot-bench. →
  renforce [[project_boot_resilience_plan_kit]] : sur EADDRINUSE au boot, identifier+tuer le squatteur
  par port plutôt qu'« attendre un changement ».
- `[1× — 2026-06-03]` **A/B de boot via un mode SERVEUR = flaky** (shutdown gracieux libère le socket
  ~1 s après SIGTERM → run N+1 = EADDRINUSE). Pour un gain de boot propre : mode **sans port**
  (`test:daemon`) OU **mesure d'import isolée** (`node --input-type=module -e`, process frais, **cwd =
  racine** sinon les bare specifiers `@nodefony/*` ne résolvent pas). `timeout` absent sur macOS
  (boucle `kill -0` ou `gtimeout`).

- `[1× — 2026-06-20]` **`process.title` du serveur enfant dev écrasé par `Kernel.preRegister`** : `Kernel.ts:608`
  pose `setProcessTitle(projectName)` à **onPreRegister** → un title posé à `onKernelStart` est écrasé (l'enfant
  restait `nodefony-core`). Fix : poser le nom à **`onReady`** (listener), après onPreRegister. Le superviseur
  PARENT park avant onPreRegister → son nom (`nodefony-dev-supervisor`, posé dans `start()`) tient. Noms dev
  normalisés `nodefony-dev-supervisor`/`nodefony-dev-server` (vite déjà `nodefony-vite[...]`) → `pgrep nodefony-dev`.
- `[1× — 2026-06-20]` **Empilement d'instances dev (le « il faut pas que ça arrive »)** : `stop/start` répétés +
  `kill -9` brutaux laissent un pidfile périmé + des orphelins → plusieurs serveurs coexistent, le dev est perdu.
  Le `npm exec nodefony` (wrapper npx) reste aussi en parent parasite (3 process au lieu de 2+vite). Chantier
  ouvert [[project_dev_supervisor_dx_kit]] : `nodefony status`/`stop` + single-instance robuste + topologie propre.

## 🧪 Tests / hygiène (frictions du jour)

- `[1× — 2026-06-18]` **Le reporter TEXTE de coverage v8 peut MASQUER un fichier couvert à 100 %** : `csrfToken.ts` (100/100/100) était totalement absent du tableau texte alors que `csp.ts` (même dossier) s'affichait. Le reporter **`json-summary`** le montrait correctement. → pour répondre à une question de couverture PRÉCISE d'un fichier, lire `--coverage.reporter=json-summary` (`.coverage/coverage-summary.json`), jamais se fier au tableau texte seul (faux « 0 ligne » trompeur). Rappel complémentaire (déjà gradué [[feedback_coverage_modules]]) : l'**e2e tourne en process serveur séparé → NON instrumenté** → le `%` du firewall/câblage SOUS-ESTIME (faux négatif), le câblage CSRF est prouvé par les 30 tests e2e hors `%`.
- `[1× — 2026-06-15]` **« tests en échec » signalé = souvent un BUILD cassé, pas un test** : user dit « tests
  en échec sur cli » → en fait `turbo run test` reportait `Failed @nodefony/security#test` par **cascade** d'un
  build TS cassé ailleurs (`@nodefony/test` TS2532 `this.context` possibly undefined). La suite isolée
  (`vitest run` dans security) était verte. Réflexe : un `Failed X#test` turbo peut venir d'un build amont — lancer
  la suite seule + `npm run build:force` pour voir la vraie erreur AVANT de chercher dans les tests.
- `[1× — 2026-06-15]` **suites `requires server` = serveur EXTERNE, pas de globalSetup serveur** : `test:load`/
  `test:memory`/`test:integration` (http) supposent un serveur dev UP sur 5152 (elles ne le lancent PAS). Arrêter le
  serveur → `ECONNREFUSED ::1:5152` sur toute la suite. + le module `test` est `policy:"dev"` → **absent en prod** :
  pour lancer la charge en prod-pod il faut basculer `policy:"mandatory"` temporairement (revert + rebuild root après).
- `[1× — 2026-06-15]` **`test:integration` teste des features d'OBSERVABILITÉ dev** (profiler de phases, trace WS,
  log interne du 499), désactivées en prod (perf) → **7 faux échecs** quand on lance la batterie contre un serveur
  prod. Fix : `describe.skipIf(IS_PROD_TARGET)` + le mode transite par `NODEFONY_TEST_ENV`, posé soit par le lanceur,
  soit par un globalSetup qui **sonde une route publique** (`/livez`). `describe.skipIf` est SYNCHRONE → pas de fetch
  dedans, d'où le globalSetup→env var. Leçon : séparer tests fonctionnels universels vs tests dev-only.
- `[1× — 2026-06-15]` **flake heap WS sustained = artefact du mode DEV** (HMR/profiler retiennent le heap) : franc et
  stable en PROD (3/3). Le gate heap doit tourner en prod-pod, pas en dev. Gradué → [[project_ws_sustained_heap_finding]].

## 🧭 Conception / fondation — sécu/firewall (frictions du jour)

- `[1× — 2026-06-19]` **revue sécu par grep : `git diff HEAD` IGNORE les fichiers untracked (`??`)** → les
  NOUVEAUX fichiers (le gros du diff d'une feature : service, authenticator, controller) passent **sous le radar**
  de la checklist sécu. Vécu P6.12 : 1ʳᵉ passe `git diff HEAD | grep …` n'a scanné QUE les fichiers modifiés
  → `apiKeys.ts`/`ApiKeyAuthenticator.ts` (untracked) non vus. Réflexe : croiser avec `git status --short | grep '??'`
  et **scanner les nouveaux fichiers explicitement** (any/secret-log/token-URL), pas seulement le diff. (À intégrer
  au skill `nodefony-security-review` : « inclure les untracked ».)
- `[1× — 2026-06-19]` **discriminer 2 authenticators sur le MÊME transport (Bearer) = par FORME, pas par config croisée**
  (P6.12). JWT et clé API (PAT) arrivent tous deux en `Authorization: Bearer …`. Au lieu de coupler (jwt lit le préfixe
  PAT), resserrer `jwt.supports()` à la structure JWS `a.b.c` (RFC 7515, 3ᵉ segment `*` → `alg=none` reste routé jose)
  et `apikey.supports()` au préfixe `nf_` → **mutuellement exclusifs, 0 couplage**, coexistence prouvée e2e. Patron
  réutilisable pour tout futur authenticator bearer.
- `[1× — 2026-06-16]` **un court-circuit doit être placé selon le PIPELINE RÉEL, pas selon le seam « logique »**
  (J5 CORS). Le preflight CORS (`OPTIONS` → 204) avait été câblé dans `handleFrontController` (seam balisé) → mais
  un `OPTIONS` n'a AUCUNE route → le router lève **405 au pré-match dans `handleHttp`, AVANT `handleFrontController`**
  → handleCors jamais atteint, le banc live sortait 405 au lieu de 204. **Fix : déplacer le court-circuit EN TÊTE
  de `handleHttp`, avant le routing** (bonus : le WS n'y passe plus). **Méthode qui a tranché = log temporaire**
  (`this.log("CORS DEBUG …")`) : présent sur GET, ABSENT sur OPTIONS → preuve que la fonction n'était pas appelée.
  Ne pas raisonner sur « où le seam devrait être » — prouver où le flux passe vraiment.
- `[1× — 2026-06-16]` **avant d'« unifier en source unique », vérifier POURQUOI le doublon existe** (J5 headers).
  J'allais retirer les security headers de `@nodefony/http` (« security = source unique »). Le user a freiné
  (« il y avait une raison »). Vérif terrain : http les pose à `onHttpRequest` (entrée BRUTE, avant le pipeline)
  → ils couvrent AUSSI statics + erreurs + serveur sans security (secure-by-default) ; le firewall ne tourne que
  dans le pipeline controller → seul, il LAISSERAIT les statics/erreurs nus. → **séparation transport (http,
  nosniff/frame/HSTS) / applicatif (security, CSP/Referrer/COOP…)**, 1 source PAR en-tête, pas « source unique ».
  Devise CLAUDE.md confirmée : avant de supprimer/déplacer un choix existant, comprendre son pourquoi (souvent un
  cas-limite non visible : ici les réponses HORS pipeline).
- `[1× — 2026-06-15]` **gradation par rôle ≠ `@BypassFirewall`** : `@BypassFirewall` skip TOUT le firewall → **0
  identité résolue** (impossible de graduer la réponse selon le rôle). Pour une route PUBLIQUE graduée (Spring
  Actuator `show-details: when-authorized`) : une **zone `["session","anonymous"]`** (le firewall tourne, résout
  l'admin si cookie, laisse passer l'anonyme). Les zones sont triées **par longueur de pattern décroissante**
  (`firewall.ts`) → une zone exacte `^/.../livez$` prime sur le pattern admin large. ⚠️ le broker AdminApi impose
  `ROLE_NODEFONY_ADMIN` PAR DÉFAUT → un endpoint vraiment public a besoin d'un flag explicite (`IAdminEndpoint.public`).
- `[1× — 2026-06-15]` **turbo ne build pas le package RACINE** (`private` + workspace root, jamais membre de ses
  propres `workspaces`) → d'où `&& rollup -c`. Fix « root task » `//#build:app` impossible simplement : `dependsOn:
["build"]` vise `//#build` (root inexistant), `^build` ne build rien car le root ne déclare AUCUN workspace en deps.
  Garder `&& rollup -c` (gain du cache root négligeable vs fragilité de lister 20 deps).

## 🧪 Tests / hygiène (suite)

- `[1× — 2026-06-20]` **red-team : la grande leçon « 2 passes » est GRADUÉE** → `feedback_redteam_threat_first`
  (passe 1 threat-first AVANT de lire le code = anti-biais ; passe 2 code-first = couvrir le reste des
  branches). Opérationnalisée dans le skill `nodefony-security-review` (mode RED/BLUE-TEAM + conception
  d'attaques framework + référentiels ANSSI/CWE/CAPEC/OSV/0-day). **À ÉPROUVER prochaine session (WebAuthn).**
- `[1× — 2026-06-20]` **vérifier que l'artefact EXISTE avant de le tester (ancrage > kit)** : le kit red-team
  nommait `@RequireScope` — **jamais codé** (`IToken.getScopes()` existe, pas le décorateur) ; et `scope.test.ts`
  (framework) teste le scope DI `@Scope('singleton')`, **PAS** un scope de permission (faux-ami de nommage).
  Lire `fichier:ligne`, pas le kit (DEVISE « la confiance n'exclut pas le contrôle »).
- `[1× — 2026-06-20]` **couverture ciblée = preuve de la passe 2** : `vitest run --coverage <fichiers d'un même
sujet>` (tous les tests qui touchent la source) → la branche non couverte révèle ce que la menace générique
  rate (vécu : `csrf.ts:125` catch Referer illisible → asymétrie Origin/Referer documentée). csrf/cors → 100 %.
- `[1× — 2026-06-15]` **method-name shadowing par une propriété d'instance** : une méthode de canal nommée
  `syslog` (`@RealtimeChannel("syslog:stream") syslog(){}`) est SHADOWÉE par `this.syslog` (le logger posé par
  `Service`) → `instance["syslog"]` renvoie l'objet logger, `typeof fn === "function"` faux → le canal disparaît
  SILENCIEUSEMENT du registre décoré. Diag = logger les clés de `getRealtimeChannels`. **Ne jamais nommer une
  méthode comme une propriété de la classe de base** (`log`, `syslog`, `context`, `kernel`…). 2 h perdues à
  croire à un bug du décorateur/timing ALS — c'était le NOM.
- `[1× — 2026-06-15]` **le 100 % bute sur des branches MORTES/DÉFENSIVES — ne pas les chasser via tests d'états
  impossibles** : (a) garde Zod (`x ?? []` quand le schéma garantit `[]`), (b) code **browser-only** sous Node
  (`typeof window !== undefined`, `BrowserWsTransport`) — non exécutable en vitest. Viser **100 % lignes+fonctions**
  (atteignable, propre) ; accepter ~95 % branches quand le reste = gardes contre l'impossible. Couvrir l'impossible
  = caster pour forcer un état que l'API interdit (anti-pattern).
- `[1× — 2026-06-15]` **provider de canal PARTAGÉ (hub singleton) : le 2ᵉ abonné ne reçoit PAS le tick immédiat**
  du factory (créé au 1ᵉʳ abonné global). En E2E, prouver l'autorisation du 2ᵉ via `denied` vide / `subscriberCount`,
  PAS via le tick. Ordonner les sous-cas (l'abonné qui doit voir le tick en 1ᵉʳ).
- `[1× — 2026-06-15]` **traque des lignes non couvertes au cordeau via `coverage-final.json`** (reporter `text`
  tronque la colonne `Uncovered`) : `--coverage.reporter=json` puis `node`/`jq` sur `.s`/`.b`/`.f` → lignes/branches/
  fonctions exactes à 0. Boucle mesure→cible→batch→re-mesure ; gain rapide (controller 72→99.5 % en 2 passes).
- `[1× — 2026-06-15]` **E2E « câblage réel » = 0 mock de décision** : pour prouver Firewall→hub→client, monter le
  VRAI `Firewall` sur un **container partagé** avec le vrai `RealtimeService` (hub = singleton), `onBoot()` →
  `#wireRealtime`, puis déclencher le handshake DANS `RequestContext.run({ user })` (l'ALS que pose `HttpKernel`
  en prod, lu par `SessionRealtimeAuthenticator`). Bien plus probant qu'un `setFrameAuthorizer` posé à la main.
- `[1× — 2026-06-15]` **un échec n'apparaît QUE sous `npm run test` racine (turbo) = contention de parallélisme,
  pas un vrai bug** : 4-6 bancs `mongodb-memory-server` spawnaient chacun leur `mongod` EN PARALLÈLE → saturation
  → timeouts flaky. En isolation (`npx vitest run` du module) tout passait. **Reproduire l'échec dans le bon
  contexte (full turbo) avant de conclure.** Fix de fond = **1 serveur partagé** (`globalSetup` + `inject` + 1
  base par fichier) + `fileParallelism:false`, JAMAIS N spawns. Test d'INFRA qui exige une ressource absente →
  `describe.skipIf(!uri)` (provide `null` au lieu de throw) → **skip, exit 0**, ne casse pas la suite. Prouver
  le skip (binaire forcé invalide → `N skipped`, exit 0), pas juste le happy-path.
- `[1× — 2026-06-15]` **isoler une régression suspecte par `git stash` du diff, run AVANT/APRÈS** : 2 tests
  `CliIntegration` échouaient après mon edit core — stash de `Command.ts`+`Cli.test.ts` → **identique (4 fails
  des 2 côtés)** → PRÉ-EXISTANT (timeout boot CLI), pas ma régression. Ne jamais attribuer un fail à son propre
  diff sans la mesure A/B (et signaler le pré-existant au lieu de le « réparer » dans le scope courant).
- `[1× — 2026-06-15]` **action async de commande NON retournée → unhandled rejection flottante** : le handler
  commander de `Command.ts` ne `return`ait pas `this.action(...)` → un `generate()` qui rejette fuyait en
  unhandled rejection captée par un AUTRE test (faux positif). Toute closure async passée à un framework
  (commander, EventEmitter) doit RETOURNER sa promesse pour être attendable (`parseAsync`).
- `[1× — 2026-06-14]` **modif du Resolver/pipeline → le gate = la suite INTÉGRATION, PAS `memory.test`** : J6/J7
  touchait `executeAction` (sur CHAQUE requête) ; j'avais lancé memory (9 tests, = fuites) + unit, et annoncé « fait »
  AVANT de lancer `npm run test:integration` (http **463**). Le user l'a relevé (« ça touche le Resolver »). memory ≠
  régression fonctionnelle. Règle : tout changement pipeline → http+framework `test:integration` AVANT de dire « fait ».
- `[1× — 2026-06-14]` **toucher un chokepoint (point de passage unique) → énumérer TOUS ses appelants (matrice de ponts) et tester chacun** :
  `executeAction` est traversé par HTTP, WS `api.request` ET **forward (`route=null` → `computeActionMeta`)** ; le pont
  forward a été oublié jusqu'à une passe rigueur (révélée par le user). La matrice actif×chemin ([[feedback_security_audit_surface_matrix]])
  vaut AUSSI pour un chokepoint de pipeline, pas que pour la sécu. Preuve définitive d'une garde = E2E live (route réelle + 200/403/401), pas que des unit à stubs.

- `[1× — 2026-06-13]` **Refacto INTERNE → les unit ne prouvent RIEN ; il faut un banc d'INTÉGRATION** (martelé par
  le user « les unit sont les mêmes !!! ») : après L0 (le client compose le peer), le CONTRAT de surface ne bouge
  pas → les unit qui pilotent le client via `handleMessage`/`send` STUBÉS restent verts sans prouver la plomberie ni
  le duplex. Réponse = banc loopback E2E `realtimeLoopback.e2e.test.ts` (VRAI client ↔ VRAI serveur, frames string
  sérialisées + async microtask) ; le test « duplex S→C avec `register` » **échoue avant L0, passe après** = preuve
  que la suite capte le gain. Règle : une refacto à iso-contrat se VALIDE par un test de la JONCTION, pas de la surface.
- `[1× — 2026-06-14]` **`turbo run test` MASQUE un rouge pré-existant** : la dépendance `^test` + le cache turbo
  font qu'un échec d'une dep (ex. orm-core) **skippe ses dépendants** → ils apparaissent en « command failed »
  sans détail, et un run câblé peut afficher « 22 successful » en cachant le vrai bilan. Pour l'état RÉEL de
  TOUS les workspaces : `turbo run test --continue` (exécute malgré les échecs) + extraire chaque « Tests X passed ».
- `[1× — 2026-06-14]` **Les seams TEMPORELS/PROBABILISTES exigent un test qui FORCE le déclenchement** : un sweep
  amorti (« tous les 256 ajouts ») et un flush sur timer debounce ne sont JAMAIS exécutés par les tests « normaux »
  (qui appellent `flushNow` ou font < 256 ops) → 100% lignes peut MENTIR (le chemin de prod n'est pas exercé).
  Couvrir explicitement : boucle de 256 pour armer le sweep ; laisser le `setTimeout` firer (await délai) ≠ flush manuel.
- `[1× — 2026-06-14]` **`vitest run X --coverage --coverage.include='**/fichier.ts'`** pour mesurer UN fichier précis —
sinon les voisins du même dossier (ex. `AnonymousToken`/`UserToken`dans`token/`) tirent le « All files » vers le bas
et masquent le vrai % du fichier visé.
(Vécu : 1 rouge orm-core `ormWiring(C5)` masqué ; les ~3030 verts ailleurs invisibles au 1er run filtré.)
- `[1× — 2026-06-13]` **Test isomorphe = double identité source/dist d'une classe** : le banc importe le client en
  SOURCE (teste la refacto sans rebuild) mais le serveur tire `JsonRpcPeer`/`RpcError` du DIST `nodefony` → 2 classes
  `RpcError` distinctes → `err instanceof RpcError` du peer serveur rate → -32603 au lieu de -32000. Fix : le handler
  serveur throw le `RpcError` du DIST, les assertions client gardent celui du SOURCE (commenté dans le test).
- `[1× — 2026-06-12]` **`fetch` mocké : une `Response` ne se LIT qu'une fois** — `mockResolvedValue(jsonResponse(…))`
  partage la même instance entre 2 appels → 2ᵉ `res.json()` = « Body is unusable: Body has already been read ».
  → `mockImplementation(() => Promise.resolve(new Response(…)))` (instance neuve par appel), jamais une Response
  partagée.
- `[1× — 2026-06-12]` **Serveur d'intégration VIVANT + état serveur par identifiant (throttler) = identifiants
  UNIQUES par run** : un `ghost` fixe accumule ses échecs de login d'un run à l'autre (le compteur survit aux
  suites) → au 4ᵉ run le test anti-énumération reçoit 429 au lieu de 401. → toute donnée de test qui nourrit un
  compteur côté serveur = suffixe `${Date.now()}` (vécu J2 : blindage de firewall-auth.test.ts AVANT la casse).
- `[1× — 2026-06-12]` **Un schéma Zod « posé » n'est PAS une config « câblée »** : la section `encoders` de
  defineSecurityConfig (S0) valide/gèle… que personne ne consomme — l'encoder réel se paramètre au constructeur
  chez l'app (banc). Question user légitime « où on paramètre ça ? ». → avant de dire « c'est configurable »,
  vérifier QUI LIT la section (grep consommateur) ; gap encoders→fabrique assumé, repris à J3 (UserProvider).
- `[1× — 2026-06-12]` **Compter les erreurs d'un build avec `grep -cE "error"` matche les NOMS de classes**
  (`UserNotFoundError.ts` dans la liste rollup) → faux « 1 erreur » sur build vert. → motif précis `TS[0-9]+:`
  pour TS, ou tester l'exit code.

- `[1× — 2026-06-11]` **Un test vert peut verrouiller l'OUTCOME par chance, pas le MÉCANISME** : le test
  « Allow n'expose pas la méthode d'un autre vhost » passait uniquement parce que la route ouverte était
  enregistrée EN DERNIER (405 cross-vhost émis AVANT le check hostname dans Route.match — l'ordre inversé
  fuitait). → quand un invariant de SÉCU passe, ajouter le test de l'ordre/configuration inverse pour
  vérifier qu'il est structurel ; corrigé en vérifiant hostname AVANT methods (`bc88444`).
- `[1× — 2026-06-10]` **`this.timeout()` est une API MOCHA, pas Vitest** : `describe("…", function(){ this.timeout(N) … })`
  → sous Vitest `this` n'a pas `.timeout` → le fichier **ÉCHOUE AU CHARGEMENT** (« 0 test », erreur pointée sur la ligne
  `describe`), PAS un test rouge. → timeout = **3ᵉ argument de `it(name, fn, ms)`** ; `describe` en arrow `() => {}`.
  Vu sur 2 fichiers neufs (body-limit, websocket-origin) chargeant 0 test pendant que les 419 autres passaient.
- `[1× — 2026-06-08]` **`@vitest/coverage-v8` doit vivre à la RACINE du mono-repo** (à côté de `vitest` hoisté) :
  déclaré dans un seul workspace, il n'est PAS hoisté → `vitest` (racine) fait `ERR_MODULE_NOT_FOUND` au `--coverage`.
  Source unique racine (anti-dérive de version aussi). `npm install` simple ne le hoiste pas s'il est déjà résolu local.
- `[1× — 2026-06-08]` **les seuils `thresholds` se valident sur la CONFIG réelle, pas une mesure `--coverage.all` ad hoc** :
  la config (qui inclut le barrel `index.ts`) donne des % **plus bas** qu'un `--coverage.include='nodefony/src/**'` lancé à
  la main (vu : drizzle 80,9 ad hoc → 78,7 config ; mongoose 78,8 → 75,4). → toujours `npm run coverage` RÉEL + lire l'exit
  code avant de figer un seuil ; plancher = mesure config **−3 pts** (marge anti-flottement, cliquet à relever ensuite).
- `[1× — 2026-06-08]` **frontière de test framework-qui-wrappe-une-lib** : ne PAS retester drizzle-orm/mongoose/mongod
  (testés en amont) → tester NOTRE traduction critère→natif, le contrat portable identique cross-ORM, et NOS invariants
  (updateOne atomique, critère strict, savepoint anti-injection, garde-fou many-to-many). Le banc d'intégration sur le vrai
  moteur (SQLite `:memory:`, `mongodb-memory-server`) = la bonne cible, pas un mock de la lib.
- `[1× — 2026-06-08]` **vérifier la convention de test DU MODULE avant d'écrire** : http/framework/frontend =
  `import { expect } from "chai"` + `describe`/`it` globals (PAS `import { describe, it, expect } from "vitest"`
  jest-style). J'ai écrit `.to.deep.equal` avec import vitest (faux) → corrigé en chai + import `.js`. Copier
  l'en-tête d'un test voisin du module (convention-frère) au lieu de présumer le style.
- `[1× — 2026-06-08]` **prouver une config runtime PUIS révoquer proprement** : override `publicMount:{publicPath}`
  posé temporairement → curl `/medias/*` 200 + `/test/*` 404 (preuve), puis restore depuis backup + `git diff` = 0.
  Bon réflexe « tests-first / suspecter son diff » sur une feature config-driven sans test d'intégration dédié.
- `[1× — 2026-06-06]` **border TOUT run de test long avec un plafond** (sinon hang qui s'éternise) : un bug
  session a fait HANG la gate mémoire **19 min** (chaque requête 500 après ~6 s × N). Garde à 2 niveaux :
  (a) plafond DUR au lancement (param `timeout` de l'outil Bash, ou `gtimeout` — `timeout` absent macOS) ;
  (b) `--testTimeout=Nms` vitest par run (échec PROPRE) — SANS toucher le `testTimeout:600_000` du fichier
  (les bancs de charge en ont besoin). Le 600 s global du fichier ≠ plafond d'un run.
- `[1× — 2026-06-06]` **le storage de session en DEV = drizzle, PAS File** : un bug de sérialisation ORM (cf
  `Object.create(null)`↔drizzle, thème Core) est INVISIBLE en unit (storage mocké) + au typecheck ; SEULE la
  gate intégration/mémoire (drizzle réel) l'attrape. Ne jamais croire un refactor session « bon » sans la gate runtime.
- `[1× — 2026-06-04]` **un test qui POST un upload DOIT nettoyer son résidu** : le serveur écrit l'upload dans
  `uploadDir` (= `kernel.tmpDir` = `./tmp`) et ne nettoie QU'en **abort** (pas un upload réussi → l'app est censée
  `move()`/`unlink()`). `memory.test` (200 uploads/run) avait laissé **1403 `<uuid>.txt`** dans `./tmp` (pollution
  repo, signalée user). Fix = pattern **snapshot-diff** (before : `readdir` ; after : supprime UNIQUEMENT les
  nouveaux) — déjà présent dans `upload.test.ts` (le copier). Vérifier `tmp/` après run = 0 résidu.
- `[2× — 2026-06-04]` **`new Kernel()` dans un .test.ts au tri PRÉCOCE pollue le singleton `Nodefony.getKernel()`** :
  mocha trie les fichiers **insensible à la casse** → `configBoot`/`configUse` (c) tournent AVANT `index`/`Injector`
  (i) qui attendent un singleton propre → **faux échecs**. Le code était sain (prouvé par **baseline stash** : retirer
  le fichier → 0 fail). Fix = `before`/`after` capturant/restaurant `Nodefony.getKernel()` autour du bloc. (Pattern
  documenté CLAUDE.md kernel « Pollution singleton » — confirmé 2× ce jour.)
- `[1× — 2026-06-04]` **`process.env.X = saved` quand `saved === undefined` écrit la string `"undefined"`** → pollue
  les tests env suivants (faux `NODE_ENV`). Helper : `delete process.env.X` si la valeur sauvegardée est `undefined`
  (jamais `= undefined`). Cf `withEnv` dans configBoot.test.
- `[1× — 2026-06-05]` **migration mocha→vitest = compat par CONFIG, pas réécriture** : `globals:true` + shim
  `import "mocha"` + chai conservé tel quel + setup (reflect + alias `before`/`after`→`beforeAll`/`afterAll` + port
  perf-skip). Seuls les VRAIS mocha-ismes se réécrivent : `done`→`new Promise((done)=>…)` (codemod brace-matching,
  sync ET async, 0 faux-pass), `this.timeout/skip`→`describe.skipIf`+`vi.setConfig`+`ctx.skip()`. Recette + 2 pièges
  dans [[feedback_test_framework_vitest]]. Rodée 4× (core/mediasoup/frontend/framework).
- `[1× — 2026-06-05]` **vitest PLUS STRICT que mocha → débusque de vrais bugs** : (a) ESM strict → `arguments.callee`
  lève (mocha+tsx tolérait sloppy) ; (b) vitest pose `NODE_ENV='test'` (mocha l'absentait) → `resolveRuntimeEnv`
  12-factor collapse en `production`. NE PAS « aligner sur mocha » pour faire taire — c'est mocha qui était laxiste.
  Fix = corriger le bug (typeOf strict-safe) + tests env explicites (delete NODE_ENV scopé, cf `withEnv`).
- `[1× — 2026-06-05]` **`@types/mocha` retiré → `tsconfig.tests.json` `types:[…,"mocha",…]` casse tsc** (`Cannot find
type 'mocha'`). Au retrait mocha d'un workspace : remplacer par `vitest/globals` dans CHAQUE `tsconfig*.json` qui le
  liste (sinon pre-push rouge). Pas attrapé par le run vitest (esbuild ignore tsc).

- `[2× — 2026-06-05, 2026-06-14]` **ajouter un champ à un objet metadata PARTAGÉ casse les `deep.equal` existants** : étendre
  `ParamMeta` avec `stream` posé TOUJOURS (même `false`) a cassé 2 tests `@Body` (forme `{source,key,index}` attendue
  à l'identique). Fix = ne poser le champ optionnel **QUE s'il est truthy** (préserve la forme historique → rétro-compat).
  Les 2 fails étaient MON diff (pas pré-existant) — suspecter son diff d'abord (la suite framework complète l'a prouvé).
  **Re-vécu J7** : ajout de `security: null` à `RouteActionMeta` → a cassé le `deep.equal` du snapshot « bare »
  d'`actionMeta.test` (qui listait les champs en dur). Ici impossible de « poser que si truthy » (le champ est
  structurel) → fix = MAJ le test consommateur. Réflexe : `grep deep.equal` des consommateurs AVANT d'étendre un meta partagé. (→ proche de 3× : candidat graduation `feedback_refactor_grep_consumers`.)
- `[1× — 2026-06-07]` **tester les MÉTHODES finales, pas que les fonctions pures** (demande explicite user). J'avais
  couvert `parseForwarded`/`forwardedNodeIp`/`resolveForwarded` (helpers purs) mais pas `getFullUrl`/`getRemoteAddress`
  (HTTP/HTTP2/WS) qui les CONSOMMENT — c'est là que vit le câblage réel. Recette pour isoler une méthode d'instance
  sans le ctor lourd : `Object.assign(Object.create(Cls.prototype), props)` + cast `as unknown as Cls` (cf
  `forwardedWiring.test.ts`). Couvre aussi le cœur partagé direct (`resolveFromRight`), pas juste via ses wrappers.
- `[1× — 2026-06-08]` **fabriquer une frame WS brute dans un test** : `ws.Sender.frame(buf,{fin,opcode,mask:true,
readOnly:false,rsv1:false})` MAIS `Sender` n'est PAS sur le default export ESM ni dans `@types/ws` → `import * as ws
from "ws"` + cast `(ws as unknown as {Sender:{frame}}).Sender`. Écrire les buffers retournés sur
  `(client as {_socket}).​_socket`. ⚠️ la route `/ws/echo` envoie d'abord `{handshake:true}` PUIS JSON-encode la
  réponse → **consommer le handshake** (`once("message")`) AVANT, et fragmenter un **objet JSON** (assert
  `JSON.parse(recv).x`), pas une string brute (revient quotée `"x"`).
- `[1× — 2026-06-08]` **`vitest run` silence `console.log`** (intercept du setup) → impossible de récupérer une mesure
  (p50/p99 d'un banc) par grep. Soit asserter une **borne** (`p99 < N`, CI-stable) en gardant les chiffres internes,
  soit écrire la mesure dans un fichier depuis le test. Ne pas s'acharner à capturer le log.
- `[1× — 2026-06-08]` **démo runtime « robustesse WS » = client réel + condition extrême** : half-open =
  `client._autoPong=false` (sinon `ws` pong tout seul → jamais zombie) + attendre `interval+grace` ; backpressure =
  `client._socket.pause()` (stoppe la lecture → `bufferedAmount` serveur gonfle) + flood. Observabilité sans sonde
  dédiée = **WARNING 1×/conn** loggé côté serveur, grep le log. ⚠️ un flood (17 MiB) gonfle `/tmp/nodefony-server.log`
  (→ 5 MiB) + peut saturer la capture stdout (ENOSPC transitoire) → `truncate -s 0` après.

## Derniers retex bruts (historique complet dans `docs/session-retros/archive/` depuis CONSOLIDATE 2026-06-12)

- `2026-06-06-d97fad67` — **chantier session ÉTAPE 3** : cœur `session.ts` réécrit (TS strict, ID CSPRNG
  opaque `randomBytes(32)`, objet léger 3 sacs vs `Container` DI, dirty-tracking `save()` no-op, cookie-only,
  contrat unifié alias supprimés, `get`/meta/flash → null cohérent). Bug `Object.create(null)`↔drizzle fixé.
  Gates vertes (mémoire 9/9, intég 405/0). Direction décorateur étape 5 (`@UseSession` lazy + benchmark) figée. `248f235`.
- `2026-06-05-b8c2a82b` — **P14.11 core isomorphe CLOS** (shim `node:events` complété `rawListeners`/`prepend*` — bug
  runtime browser masqué par tsc + test régression, `f41bb23`) **+ SUPPRESSION TOTALE mocha 5/6** : core (1558 tests,
  2 bugs réels typeOf strict / NODE_ENV, `4106303`), mediasoup (22, `82cc83a`), frontend (42, `1a9b912`), framework (235,
  `899924a`) + docs/skills/mémoire (`01e3a93`/`d3901b4`). Reste **http** (gate mémoire/charge → session dédiée) + maj deps outdated.
- `2026-06-05-6c01bf49` — **audit vérité migration P0→P16 + assainissement `MIGRATION_STATUS.md`** : confronté au code
  (déclaré ≈ réel partout, global 50 % — fond honnête). Dashboard **278→32 KB** (cellules-journal de 3 800 car. tuées, 117
  tâches préservées) + audit complet `docs/migration/AUDIT-verite-2026-06.md`. Corrections : DETTE-CFG 🚧→✅, virage ORM
  répercuté, refs mortes PM2/mikroorm, P15 clarifié (banc ORM ≠ télécom), prochaine étape → durcissement ORM. `9936683` poussé.
- `2026-06-04-932ec78f` — **Lots 3+4 defineConfig + résilience config + hygiène tmp** : `use()` + registre typé
  (niveau ③, pilier #1 = 4/4) `6dc306b` ; câblage Kernel boot (descripteur résolu via ctx, merge défauts tous chemins,
  fallback legacy) `60a7929` ; **résilience config** (bootConfigError : diagnostic clair + défauts explicites + EX_CONFIG,
  prouvé en réel `port="abc"`) `08ad3e5` ; **memory.test nettoie ses uploads** (1403 résidus purgés) `0915764`. ➡️ Lot 5.
- `2026-06-04-b32ebcd5` — **planification CHANTIER CONFIGURATION (`defineConfig`)** : état des lieux `nodefony/config/` + vision (1 fichier racine minuscule auto-doc, `defineConfig`/`defineEnv`/`use`) + plan 8 lots + Lot 0 bouclé (env 12-factor vérifié, defaults framework à CRÉER). Décisions D1 (zod core peerDep), `use` (pas withModule), typage 4 niveaux + hot/boot. 0 code (planif). `431f1e1` + kit boussole.
- `2026-06-03-695bc070` — **Phase B (park centralisé via `lifetime`) + isTTY**, puis ménage piloté par audit : **retrait service rollup runtime** (−378 ms/−23 MB boot, A/B mesuré) + `nodefony build --force` (wrapper turbo) + **`@inquirer` lazy**. Audit poids d'import boot (imports ~1130 ms/94 MB, drizzle domine 423 ms/43 MB). 4 commits `b55c753`/`6a1dcd4`/`a71d004`/`68dd86e`.
- `2026-06-01-8b47ba7d` — **chantier CLI** : filet intégration + commander 15 + **1 seul Kernel** (double-boot tué) + hooks lifecycle tous modes + audit boot (91 % = imports) + banc 3 modes server/batch/daemon + guide Docker + **splash dev-only** + durcissement filet (intégrité modules). 8 commits `…b05e381`.
- `2026-06-01-690029d6` — fix doublon JSONL (double `initializeLog` re-monte FileTransport, `6814c05`) + fusion Profiler → Suivi de requête (onglets Timing/ORM + onglet Profiling Logs, page autonome supprimée, `1d4ed01`).
- `2026-06-01-961eb178` — gate couleur ANSI boot-time (helper `logColor` gaté `isTTY`, core/http/security) → JSONL/pipe propres hors TTY ; allocation-neutre (1 commit `7e68b05`).

> ✅ **CONSOLIDATE 2026-06-12** (`CONSOLIDATION-2026-06-12.md`) : 48 bruts de juin balayés + **maintenance
> du SAS** (866 → ~700 lignes). **Gradués** : `Edit` exige `Read` (4×) → [[feedback_edit_requires_read_tool]]
> (NOUVELLE) ; cwd persiste/`cd X && …` (5×+) → [[feedback_cd_startsh_relative_path]] enrichie (3 formes).
> **Retirés ~25 doublons** : couverts par les skills MAJ le jour même (load-test A/B, debug ENOSPC+memory-flake,
> check-memory-health serveur/GC, studio-dev front 06-06, framework-dev typecheck) ou déjà gradués
> (commitlint → feedback_commit_fr_apostrophes) ou résolus dans le code (résidus tests `0915764`,
> dist/types pre-push, END allégé). **105 bruts archivés** → `archive/`. Le SAS garde les frictions
> 1-2× réelles (capital, ne pas amincir). Prochain CONSOLIDATE : si friction à 3× ou taille.
>
> _(Note 2026-05-31 conservée : la graduation se fait EN CONTINU ; ne pas re-déclencher CONSOLIDATE
> sur le seul nombre de bruts.)_
