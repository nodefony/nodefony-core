---
name: nodefony-protect-route
description: >
  Réserve une route d'une application Nodefony aux personnes habilitées, par les briques du
  framework plutôt que par un contrôle écrit à la main dans l'action. Porte les deux étages
  (zone du pare-feu et garde par route), la hiérarchie de rôles qui évite d'attribuer un rôle de
  plus, la façon d'ouvrir une route à un partenaire sans démonter la défense anti-falsification,
  et les gestes qui affaiblissent l'application en silence. À charger AVANT de poser une garde,
  d'ouvrir une route à un tiers, ou de toucher à la configuration de sécurité.
  Déclencheurs : "protège cette route", "réserver aux administrateurs", "@IsGranted", "firewall",
  "zone protégée", "403", "401", "un rôle qui en implique un autre", "roleHierarchy",
  "un partenaire doit pouvoir poster", "erreur CSRF", "origine refusée", "@CsrfExempt",
  "@CsrfProtect", "mon POST passe sans jeton", "faut-il protéger une écriture",
  "API pour un programme", "clé d'API", "désactiver la sécurité pour tester".
---

# protect-route — la garde vient du framework, jamais de l'action

> 🧭 **Tu es arrivé ici directement ? Charge aussi `nodefony-dev`** — il porte la conduite
> commune (par où commencer, comment prouver que c'est fait) et les pièges qui coûtent une heure,
> serveur comme front. Cette page-ci ne couvre QUE son geste.
>
> Et si une réponse te manque, elle est probablement INSTALLÉE : `rg` ne descend pas dans
> `node_modules`, donc 70 pages de documentation y paraissent absentes. Une commande les lit, avec
> la ligne exacte :
> `node node_modules/@nodefony/devkit/skills/nodefony-dev/scripts/docs.mjs <termes>`.

> ⚖️ **La confiance n'exclut pas le contrôle.** Une route qui « répond 403 quand je teste » n'est
> pas une route protégée. Le seul juge est un appel avec **trois identités**.

## Deux étages, et ils ne font pas la même chose

| Étage                | Où                                     | Ce qu'il protège                          |
| -------------------- | -------------------------------------- | ----------------------------------------- |
| **zone du pare-feu** | `nodefony/config/security.ts`, `areas` | un **espace** : `pattern: "^/api/secure"` |
| **garde par route**  | `@IsGranted("ROLE_X")` sur l'action    | **une** route précise                     |

Les deux se combinent : la zone décide **qui entre**, la garde décide **qui fait**.

```ts
@Get("/api/reports")
@IsGranted("ROLE_REPORTS")
async list() { … }
```

### Une zone peut exiger un rôle PAR DÉFAUT

Une zone qui ne liste que des authentificateurs exige une **identité**, rien de plus : toute route
qu'elle couvre est ouverte à **n'importe quel compte connecté**. Pour un espace d'administration,
c'est un défaut ouvert — l'oubli d'une garde s'y solde par une fuite.

```ts
areas: {
  backoffice: {
    pattern: "^/back-office",
    authenticators: ["session"],
    roles: ["ROLE_ADMIN"],   // ← exigé par défaut dans toute la zone
  },
}
```

Les rôles sont en **OU** — un seul suffit — et la hiérarchie s'applique. Un refus est un **403**
(connecté, mais pas autorisé), jamais un 401. Omettre la clé ne change rien au comportement
existant.

C'est un **défaut**, pas une exclusivité : une route qui porte sa propre garde (`@IsGranted`)
décide seule, ce qui laisse exister une page réservée à un autre rôle dans une zone par ailleurs
fermée. Écris donc le rôle **une fois sur la zone**, et ne le répète sur une route que pour en
exiger un autre.

🔴 **`@RequireScope` seul ne remplace PAS un rôle.** Un scope dit ce qu'une **clé déléguée** peut
faire en ton nom ; sur une session humaine il n'a aucune prise. Une route gardée par un scope seul
n'a donc rien décidé de ton identité — et le rôle de sa zone continue de s'appliquer, ce qui est
voulu. Les deux axes se cumulent, ils ne se substituent pas.

🔴 **Le `pattern` d'une zone est un PRÉFIXE, jamais la liste des routes du jour.**

```ts
pattern: "^/api/account"; // ✅ l'espace
pattern: "^/api/account/(profile|invoices)"; // ❌ les routes d'aujourd'hui
```

Énumérer marche à l'essai et passe la revue. Puis quelqu'un ajoute
`/api/account/payment-methods` — et elle **naît publique**. Rien ne le signale : la zone existe,
elle a l'air de couvrir l'espace, et l'introspection montre bien une route protégée à côté. Quand
des routes partagent un préfixe, ne les protège pas une par une.

## 🔴 La PROVENANCE n'est pas une PREUVE D'INTENTION — une mutation exige `@CsrfProtect`

Le raisonnement qui vient, et qui est faux : « le pare-feu vérifie déjà `Sec-Fetch-Site`, donc une
écriture est protégée ». Ces en-têtes sont posés par un NAVIGATEUR ; un programme qui parle en HTTP
n'en envoie aucun, et la défense de provenance le laisse alors passer — c'est son rôle, elle
distingue les sites, pas les intentions. Résultat mesuré : un `POST /api/cart/items` sans jeton rend
`201`, et l'application croit avoir une défense.

Toute action qui ÉCRIT porte donc `@CsrfProtect` explicitement. Le jeton ne se demande à AUCUN
endpoint : une requête sûre (`GET`) vers la route protégée sème le cookie lisible `csrf-token`, et
la mutation le rejoue dans l'en-tête `x-csrf-token` — c'est le double-submit, sinon `403`. La
provenance et le jeton se **cumulent** ; l'une ne remplace jamais l'autre.

## 🔴 Ce qu'il ne faut jamais écrire

```ts
// ❌ contrôle artisanal — invisible au pare-feu, à l'audit et à l'introspection
if (!this.context?.user?.roles.includes("ROLE_ADMIN")) {
  return this.renderJson({ error: "forbidden" }, 403);
}
```

Le framework refuse **avant** d'entrer dans l'action. Un test écrit dans l'action s'oublie sur la
route suivante, ne se voit pas dans `inspect routes`, et ne protège rien qu'on n'ait pensé à
protéger.

## Un rôle qui en implique un autre

Un administrateur doit pouvoir consulter la facturation **sans** qu'on lui attribue un rôle de
plus. Ça se déclare une fois, dans le manifeste :

```ts
roleHierarchy: {
  ROLE_ADMIN: ["ROLE_BILLING", "ROLE_REPORTS"],
}
```

**Deux gestes rendent la même réponse sur la route que tu mesures, et aucun des deux ne
généralise** : recopier le rôle sur le compte administrateur au moment du semis — ça marche pour
ce compte-là et pour aucun autre — et énumérer les rôles sur l'action,
`@IsGranted(["ROLE_BILLING", "ROLE_ADMIN"])`, où un attribut accordé suffit. Dans les deux cas la
relation entre les rôles n'existe nulle part : la route suivante devra répéter la liste, et
l'oubli ne se voit sur aucune route — c'est une ABSENCE, elle ne se relit pas dans un diff.

## Ouvrir à un partenaire sans démonter la défense

Une origine tierce qui poste reçoit un refus : c'est la défense anti-falsification qui fait son
travail. **Le geste juste est de DÉCLARER l'origine**, jamais de retirer la défense :

```ts
csrf: {
  secret: ctx.env.NF_CSRF_SECRET, // la clé que la config pose DÉJÀ — ne la perds pas
  trustedOrigins: ["https://partenaire.example"],
}
```

⚠️ Ce bloc est fait pour être recopié dans `nodefony/config/security.ts`. Recopié **sans** son
`secret`, il coupe le jeton anti-falsification — en silence, tests verts.

🔴 `@CsrfExempt`, `csrf.enabled: false`, ou couper le contrôle de provenance **résolvent le
symptôme et ouvrent l'application** : n'importe quel site peut alors faire poster le navigateur
d'une personne connectée, à son insu et avec ses droits.

Deux précisions qui décident du résultat :

- la comparaison porte sur l'origine **ENTIÈRE** (`scheme://host[:port]`) — ni joker, ni
  sous-domaine implicite : **une origine par entrée**, et `https://x.example` ne couvre pas
  `https://api.x.example` ;
- `cors.origins` n'est **pas** la même clé et ne remplace pas celle-ci : elle autorise EN PLUS
  le JS du tiers à **lire** tes réponses. Un partenaire qui POSTE n'en a pas besoin — et les deux
  se traversent sans se suppléer.

Détail : `node_modules/@nodefony/security/docs/csrf.md`.

## Créer un compte

```bash
npx nodefony security:user:add <identifiant>
```

**N'insère jamais un utilisateur directement en base** : le mot de passe doit passer par
l'encodeur du framework. Une ligne posée à la main produit un compte qui ne pourra pas se
connecter — ou pire, un mot de passe stocké en clair.

## Lire l'utilisateur courant

Le paramètre décoré `@CurrentUser()` (typé `IUser` de `@nodefony/user`). L'identité est
**ré-résolue à chaque requête** : les rôles sont frais, et une révocation prend effet tout de
suite. N'écris pas ton propre lecteur de session — le tien lira un instantané.

## Un droit métier qui ne se réduit pas à un rôle

« L'auteur peut éditer SON document » ne s'exprime pas avec un rôle : la réponse dépend de
l'objet. Ça s'écrit en **voter**, enregistré par `registerVoterFactory`, et appelé par la garde
habituelle :

```ts
@IsGranted("doc.edit", { subject: "id" })
```

C'est le point d'extension prévu — il n'y a **pas** de table de permissions à inventer, ni de test
d'appartenance à écrire dans l'action.

## Une API pour un PROGRAMME, pas pour un navigateur

Un service partenaire, un script, un agent ne stockent aucun cookie. **La zone est déjà posée**
dans le `nodefony/config/security.ts` généré :

```ts
machine: {
  pattern: "^/api/machine",
  authenticators: ["apikey"], // PAS "session" — ce client n'a pas de cookie
  stateless: true,            // false ⇒ un registre de sessions que ce client ne relit pas
}
```

Fais donc **tomber ta route sous `/api/machine`** plutôt que d'ajouter une zone : celle-ci est
déjà réglée, et une seconde zone au pattern plus court la coifferait sans prévenir — le pare-feu
trie par longueur de pattern.

⚠️ `stateless: false` (le défaut) **ne fait pas échouer l'essai**, et c'est tout le piège : depuis
un navigateur ou un `curl -c`, le cookie posé revient aux requêtes suivantes et tout semble
marcher. Ce que ça coûte n'est pas un refus mais un **registre** — chaque appel portant un cookie
inconnu fait reprendre puis réécrire une session serveur, et renvoyer un `Set-Cookie`, pour un
appelant qui ne la relira jamais. `stateless: true` ferme cela : la zone n'ouvre ni ne reprend de
session, et le cookie entrant est ignoré. Lister `"session"` dans une zone stateless est une
contradiction, et l'application **refuse de démarrer** en nommant la zone. Règle : **un appelant
qui ne stocke pas de cookie ne doit rien recevoir qu'il faille stocker.**

Les clés s'émettent par `POST /nodefony/security/api/keys`.

## Les gestes qui affaiblissent en silence

Bloqué par une garde en résolvant autre chose, le réflexe est de la retirer. La fonctionnalité
marche, les tests passent, et le diff ne contient aucune faute visible — il contient un manque.

| À ne pas faire                                      | Ce que ça ouvre                                |
| --------------------------------------------------- | ---------------------------------------------- |
| `'unsafe-inline'` dans `script-src`                 | l'exécution de n'importe quel script injecté   |
| `@BypassFirewall`, `@Anonymous`                     | la route sort de sa zone                       |
| `anonymous` ajouté aux authentificateurs d'une zone | toute la zone devient publique                 |
| `rateLimit: { enabled: false }`                     | le bourrage de mots de passe redevient gratuit |
| `areaRoleExempt: true` sur une route                | elle perd le rôle par défaut de sa zone        |

Relever un **seuil** est un réglage légitime. L'**éteindre** ne l'est pas.

Le dernier de la liste est le plus trompeur : son nom dit bien ce qu'il fait — il **retire** le rôle
exigé par la zone —, mais il n'installe rien à la place. Posé sur une route qui ne décide pas
elle-même de son autorisation, il la rend accessible à tout compte connecté, sans erreur ni trace.
Il est **réservé aux mécanismes internes du framework** ; ce que tu veux, quand une route de ta zone
doit être plus ouverte, c'est déclarer le rôle qu'elle exige vraiment.

## Prouver — trois identités, pas une

Le refus d'un anonyme est gratuit : n'importe quelle zone le donne. Ce qui prouve, c'est le
**deuxième** appel :

```bash
npx nodefony security:user:add            # un témoin SANS le rôle
# 1. anonyme            → refusé (401 ou 403 : les deux sont justes)
# 2. connecté SANS rôle → refusé      ← celui-ci porte l'information
# 3. administrateur     → servi
npx nodefony inspect routes --json        # la garde est-elle sur la route qu'on croit ?
```

## Utilisateurs et droits : tout existe, n'improvise RIEN

Chaque geste ci-dessus a sa référence INSTALLÉE — une recherche ordinaire ne la voit pas, `rg`
ne descendant pas dans `node_modules` :

- **Zones, authentificateurs, CSRF, CORS, clés d'API** — `node_modules/@nodefony/security/docs/firewall.md`
- **`@IsGranted`, voters, hiérarchie de rôles** — `node_modules/@nodefony/security/docs/authorization.md`
- **Contrat `IUser`, `UserService`, mot de passe** — `node_modules/@nodefony/user/docs/index.md`
- **Politique de contenu, nonce, HSTS** — `node_modules/@nodefony/security/docs/headers.md`

N'écris pas ton propre lecteur de session, ne teste pas l'appartenance à un rôle à la main, et
n'insère jamais un utilisateur directement en base — le mot de passe passe par l'encodeur du
framework.

## Voisins

| Besoin                         | Skill                           |
| ------------------------------ | ------------------------------- |
| Une ressource complète stockée | `nodefony-add-crud`             |
| Un service métier injectable   | `nodefony-add-service`          |
| Un flux temps réel réservé     | `nodefony-add-realtime-channel` |
