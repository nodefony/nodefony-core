---
name: nodefony-authentication
metadata:
  version: 1.0.0
description: >
  Établit QUI est l'utilisateur d'une application Nodefony par ce que le framework sert déjà —
  page /login et son habillage, client NodefonyLogin, route me, second facteur, connexion
  récente, retour sûr après connexion, fournisseurs (Keycloak, GitHub), jeton d'un programme —
  au lieu de le réécrire. À charger AVANT d'écrire un formulaire de connexion, une redirection
  après login, une lecture de session ou un appel d'API depuis un script. Ce qu'un utilisateur connecté a le DROIT de faire → nodefony-protect-route.
  Déclencheurs : "ajoute une page de connexion", "formulaire de login", "se connecter", "second
  facteur", "TOTP", "MFA", "exiger une connexion récente", "ramener l'utilisateur après la
  connexion", "?from=", "qui est connecté", "déconnexion", "Keycloak", "se connecter avec
  GitHub", "mon script doit appeler l'API sans formulaire", "jeton d'accès", "202 au login".
---

# authentication — la connexion est servie, elle ne s'écrit pas

> 🧭 **Tu es arrivé ici directement ? Charge aussi `nodefony-dev`** — il porte la conduite
> commune (par où commencer, comment prouver que c'est fait). Cette page-ci ne couvre QUE la
> connexion.
>
> Une réponse te manque ? Elle est probablement INSTALLÉE — `rg` ne descend pas dans
> `node_modules`. `node node_modules/@nodefony/devkit/skills/nodefony-dev/scripts/docs.mjs <termes>`
> la trouve, avec la ligne exacte.

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.

## 1. Quand m'utiliser / quand passer la main

| Besoin                                                                | Skill                           |
| --------------------------------------------------------------------- | ------------------------------- |
| Se connecter, se déconnecter, savoir qui est connecté, second facteur | ici                             |
| Réserver une route à un rôle, renvoyer l'anonyme vers `/login` (zone) | `nodefony-protect-route`        |
| La ZONE qui reçoit un programme (`machine`, `partner`), un partenaire | `nodefony-protect-route`        |
| Une page qui affiche l'état de connexion en temps réel                | `nodefony-add-realtime-channel` |
| Vérifier à l'écran que la connexion aboutit                           | `nodefony-browser`              |

## 2. 🔴 Ce qui est DÉJÀ servi — n'écris ni page, ni controller de compte

Une application qui charge `@nodefony/security` sert tout ceci :

| Ce qui existe                                                 | Ce que ça fait                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET /login`                                                  | la page : identifiant, mot de passe, second facteur, passkey, boutons des fournisseurs           |
| `POST /nodefony/security/api/auth/login`                      | `{username, password}` → `200` + cookie ; **`202` = second facteur requis, PAS encore connecté** |
| `POST /nodefony/security/api/auth/login/totp`                 | `{code}` — le code à 6 chiffres (ou un code de récupération) qui achève une connexion en `202`   |
| `GET /nodefony/security/api/auth/me`                          | **TOUJOURS `200`** : `{ user: null }` sans session, sinon `{ user: { id, identifier, roles } }`  |
| `POST /nodefony/security/api/auth/logout`                     | idempotent ; rend l'adresse de déconnexion du fournisseur quand la session venait de lui         |
| `/nodefony/security/api/totp/{enroll,confirm,disable,status}` | le titulaire connecté active ou retire SON second facteur                                        |

- 🔴 **Qui est connecté, côté serveur — deux lignes à retenir, rien d'autre :**

  ```ts
  this.user; // dans un controller
  RequestContext.getAuthenticatedUser(); // partout ailleurs (service, hook)
  ```

  Les deux rendent l'utilisateur connecté, ou `null`. C'est la règle UNIQUE du framework : elle
  part du jeton que pose le pare-feu, et ses variantes en dérivent — `RequestContext.getUserId()`
  pour l'`id` seul, `authenticatedUser()` de `@nodefony/user` pour le compte typé `IUser`. Ne lis
  jamais la session à la main, et pas `RequestContext.getUser()`, qui rend aussi l'anonyme.

- `me` ne teste jamais une session par son code HTTP : il n'y a pas de `401` à attendre. Le
  champ est `identifier`, pas `username`. Le rechargement d'une page (F5) se restaure avec `me`,
  jamais avec un état gardé côté navigateur.
- Ces routes sont montées par `@nodefony/framework`, sous un chemin qui porte le nom de
  `security` : c'est le piège qui fait conclure qu'elles n'existent pas.
- Aucune commande CLI n'active le second facteur d'un compte : c'est le titulaire, connecté, qui
  l'enrôle (`enroll` rend `{secretBase32, otpauthUri}`, `confirm` le valide par un premier code).

## 3. Habiller la page `/login` — sans la réécrire

Quatre niveaux, du plus léger au plus lourd ; prends le premier qui suffit. La section
`security.loginPage` est **stricte** : une clé mal orthographiée arrête le démarrage.

| Niveau | Geste                                                                                    |
| ------ | ---------------------------------------------------------------------------------------- |
| 1      | `skin` (neuf habillages) et `layout`                                                     |
| 2      | `title`, `heading`, `subtitle`, `logo`, `hero`, `footer`                                 |
| 3      | `stylesheet` : TA feuille, qui redéfinit les variables `--nf-login-*`                    |
| 4      | `template` : un gabarit `.eta` à toi — dernier recours, il ne suit plus les mises à jour |

`path` (défaut `/login`) déplace la page ; **toute** redirection du framework la suit, y compris
l'échec d'un fournisseur quand `oauth2.failureRedirect` est omis. N'écris donc jamais `"/login"`
en dur dans ton code : `loginPagePath(from)` le compose. Détail :
`node_modules/@nodefony/security/docs/login-page.md`.

❌ Recopier la feuille de style de la page, ou un nouveau `.eta` pour changer trois couleurs :
la page cesse de suivre le framework, et le niveau 1 ou 3 suffisait.

## 4. Une connexion dans TON front — `NodefonyLogin`, jamais `fetch`

Le plus souvent, un **bouton** suffit : un lien vers `loginPagePath(from)` (`nodefony/client`),
qui compose `/login?from=<page>`. La page servie fait le reste.

Un formulaire à toi se bâtit sur `NodefonyLogin` (`nodefony/client`), qui conduit mot de passe,
second facteur, passkey, fournisseurs et blocage — par la liaison de TON moteur :

| Moteur  | Liaison               | Import             |
| ------- | --------------------- | ------------------ |
| React   | `useNodefonyLogin`    | `nodefony/react`   |
| Vue     | `useNodefonyLogin`    | `nodefony/vue`     |
| Svelte  | `nodefonyLogin`       | `nodefony/svelte`  |
| Angular | `injectNodefonyLogin` | `nodefony/angular` |

Elle expose l'état (`getState`, `subscribe`) et les gestes : `login`, `submitMfaCode`,
`loginWithPasskey`, `loadProviders`, `startProvider`, `me`, `logout`. **Suis l'adresse que rend
`logout()`** : sinon la session du fournisseur (Keycloak) reste ouverte. Détail :
`node_modules/nodefony/docs/client.md` (§ NodefonyLogin).

🔴 **Jamais de `fetch` ni d'`axios` vers `/nodefony/security/api/auth/*`** : le `202`, le
blocage après échecs, le jeton anti-falsification et la passkey sont autant de cas qu'un
`fetch` écrit à la main oublie — et chacun est une faille ou une panne.

## 5. Le `202` est un DÉFI, pas un succès

```json
{ "mfaRequired": true, "methods": ["totp"] }
```

La session ne porte alors qu'un défi en attente : **l'utilisateur n'est pas connecté**. La liste
`methods` est **ouverte** — d'autres méthodes viendront ; teste l'appartenance
(`methods.includes(MFA_METHOD_TOTP)`), jamais l'égalité du tableau. Le code s'envoie à
`login/totp` (ou `submitMfaCode` avec la liaison).

## 6. Ramener l'utilisateur après la connexion — `safeRedirectPath`

Le renvoi de l'anonyme vers la page se déclare sur la ZONE (`entryPoint`, skill
`nodefony-protect-route`) ; il arrive avec `?from=<page>`. Au retour :

```ts
import { safeRedirectPath } from "nodefony"; // aussi dans nodefony/client
const destination = safeRedirectPath(from); // "/" par défaut
```

🔴 **Un `from` ne se suit JAMAIS sans `safeRedirectPath`.** C'est la seule garde contre la
redirection ouverte : `?from=https://site-piege.example` ou `?from=//site-piege.example`
enverrait ton utilisateur ailleurs, connecté. N'écris pas ta propre garde
(`startsWith("/")`, expression régulière d'URL) : `//hôte` commence par `/`, et c'est
exactement le contournement qu'elle laisse passer.

## 7. Exiger une connexion RÉCENTE, ou deux facteurs, avant une action sensible

La session retient quand et comment elle a été ouverte (méthodes RFC 8176) :

```ts
import { readSessionAuthentication } from "nodefony";

const auth = readSessionAuthentication(this.session); // { at, amr } ou null
const recent = auth !== null && Date.now() - auth.at < 5 * 60_000;
const twoFactors = auth?.amr.includes("otp") ?? false;
if (!recent || !twoFactors)
  return this.renderJson({ error: "reauth_required" }, 403);
```

| Connexion par       | `amr`            |
| ------------------- | ---------------- |
| mot de passe        | `["pwd"]`        |
| mot de passe + TOTP | `["pwd", "otp"]` |
| passkey             | `["pop"]`        |
| fournisseur         | `[]`             |

- `null` = session sans ces métadonnées (ouverte avant, ou altérée) : **refuse**, ne devine pas.
- ❌ `session.getMetaBag("amr")` : tu relis à la main un contrat que `readSessionAuthentication`
  valide (types, valeurs finies).
- `this.session` n'est peuplée que si la route reprend une session (cookie présent dans une zone
  `session`, ou `@UseSession`) — hors zone, elle vaut `null`, donc le refus ci-dessus s'applique.

## 8. Les routes de connexion restent sous le contrôle anti-falsification

`bypassFirewall` sort une route de l'authentification, **pas** du contrôle CSRF : une route de
connexion à toi reste soumise au jeton. Seul `@CsrfExempt` l'en dispense — et il ouvrirait la
connexion à n'importe quel site (connexion forcée). Garde le jeton ; `NodefonyLogin` le porte.

## 9. 🔴 En production, un mot de passe en HTTP clair est refusé (`403`)

Avant toute vérification, et la page affiche « doit passer par HTTPS ». Derrière un proxy qui
termine TLS, déclare-le dans `trustProxy` (config de `@nodefony/http`) — sinon **toutes** les
connexions échouent. `security.allowInsecureCredentials` n'est pas la correction : elle accepte
le clair.

## 10. Se connecter par un fournisseur (Keycloak, GitHub…)

Le fournisseur se déclare dans `security.oauth2.providers` ; ses identifiants viennent de
l'environnement (`NF_KEYCLOAK_*`, `GITHUB_CLIENT_ID`…). Deux commandes, faute de quoi on
diagnostique un `401` à l'aveugle :

```bash
npx nodefony security:oauth:doctor [-p keycloak]                 # découverte, URL de retour, secret
npx nodefony security:keycloak:realm [--write|--check|--apply]   # realm dérivé de TA config
```

`--write` écrit le realm (rôles, audiences) dans `docker/keycloak/import/`, `--check` sort en 1
s'il ne suit plus la configuration, `--apply` pose le thème de connexion sur le Keycloak de
développement. Un `401` avec un jeton Keycloak valide sur une API, c'est presque toujours
l'audience absente : `--write`, puis réimport. Détail :
`node_modules/@nodefony/security/docs/keycloak.md`.

## 11. Un PROGRAMME ne remplit jamais le formulaire

Un script, une tâche planifiée, un agent n'ont ni navigateur ni cookie : ils présentent une
preuve à chaque appel, `Authorization: Bearer …`.

| Preuve                          | L'obtenir                                                       |
| ------------------------------- | --------------------------------------------------------------- |
| clé d'API opaque (`nf_…`)       | `POST /nodefony/security/api/keys` (session d'administration)   |
| jeton signé par l'application   | `npx nodefony security:token [compte] --scope … --ttl … --json` |
| jeton Keycloak (client machine) | `requestClientCredentialsToken` de `@nodefony/security`         |

❌ Un `POST` vers la route de login depuis un script, ou un cookie de session recopié dans sa
configuration : le premier fait stocker un mot de passe au programme, le second expire et casse
en silence. La zone qui reçoit ces preuves (`machine`, `partner`, `stateless: true`) et la
commande qui l'éprouve (`app:partner:call`) → skill `nodefony-protect-route`. Détail :
`node_modules/@nodefony/security/docs/api-keys.md`, `obtenir-un-jeton.md`.

## 12. Prouver que c'est fait

```bash
# la page est servie, avec ton habillage (lis son <title>)
curl -s localhost:5151/login
# me répond 200 sans session — teste user, pas le code
curl -s localhost:5151/nodefony/security/api/auth/me
# le retour refuse une destination étrangère : les deux doivent rendre "/"
node -e 'import("nodefony").then(({safeRedirectPath:s})=>console.log(s("//evil.example"),s("https://evil.example")))'
```

Une action « connexion récente » se prouve par trois sessions : mot de passe seul → refusée ;
mot de passe + TOTP → servie ; la même, ouverte depuis plus longtemps que le délai → refusée.
