---
title: "Keycloak — brancher un annuaire, du realm au premier login"
navTitle: Keycloak
lang: fr
module: "@nodefony/security"
topic: keycloak
coverageModule: security
coverageFiles: "oauth2.ts,oauthProviderRegistry,oidc.ts,providerRoles"
section: "Sécurité"
audience: [developer, devops]
tags:
  [
    security,
    keycloak,
    oidc,
    oauth2,
    realm,
    sso,
    pkce,
    bff,
    resource-server,
    roles,
    roleMapping,
  ]
version: "doc"
status: stable
updated: 2026-10-12
source: "src/packages/@nodefony/security/docs/keycloak.md"
---

# Keycloak — brancher un annuaire, du realm au premier login

> Ton entreprise tient ses comptes dans un **Keycloak** et tu veux que tes utilisateurs se connectent
> à ton application avec ces comptes, sans que l'application voie jamais un mot de passe. Côté
> Nodefony, il n'y a **aucun code à écrire** : le fournisseur `keycloak` est fourni, et l'adresse
> du realm suffit à le décrire. Le travail se passe surtout dans Keycloak : créer le realm, déclarer
> un client **confidentiel**, enregistrer l'URL de retour au caractère près. Cette page fait le
> chemin entier, puis montre comment le jeton Keycloak de la même personne ouvre aussi ton API, sur
> le **même compte**. Ancré sur le fournisseur `createDiscoveredOidcProvider()` (`oidc.ts#createDiscoveredOidcProvider`) et
> sur `OAuth2Service` (`oauth2.ts#OAuth2Service`).

📍 [Documentation](../../../../../docs/index.md) › [Sécurité](index.md) › **Keycloak**

## 🧠 Schéma général

```mermaid
sequenceDiagram
    autonumber
    actor U as Navigateur
    participant A as Application Nodefony
    participant K as Keycloak (realm)
    Note over A,K: Au démarrage : A lit les métadonnées du realm (.well-known)
    U->>A: GET …/oauth2/keycloak/authorize
    A-->>U: 302 vers K (state + code_challenge PKCE)
    U->>K: page de connexion du realm
    K-->>U: 302 vers …/oauth2/keycloak/callback?code=…&iss=…
    U->>A: GET …/callback (code)
    A->>K: échange code + code_verifier + secret du client (serveur à serveur)
    K-->>A: ID token + jeton d'accès
    A-->>U: 302 + cookie de session (aucun jeton dans le navigateur)
```

Le navigateur ne voit passer qu'un `code` à usage unique. Le secret du client et les jetons restent
entre l'application et Keycloak, sur un canal TLS.

## 📖 Lexique

| Terme               | Développé et rôle                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Keycloak            | Serveur d'identité libre, auto-hébergé : il tient les comptes, affiche la page de connexion et délivre les jetons.      |
| Realm               | Espace de comptes isolé dans Keycloak : ses utilisateurs, ses clients, ses clés. Son URL est l'**émetteur**.            |
| Client              | L'application telle que Keycloak la connaît : un identifiant, un secret, des URL de retour autorisées.                  |
| Client confidentiel | Client capable de garder un secret, parce qu'il tourne sur un serveur. Keycloak l'appelle « Client authentication ON ». |
| OIDC                | _OpenID Connect_ : la couche d'identité au-dessus d'OAuth 2.0, qui ajoute l'ID token (qui est l'utilisateur).           |
| Émetteur (`iss`)    | L'identifiant du serveur qui signe les jetons. Pour Keycloak : `https://<hôte>/realms/<realm>`.                         |
| `sub`               | _Subject_ : l'identifiant stable de l'utilisateur **dans son realm**. Unique chez son émetteur, nulle part ailleurs.    |
| PKCE                | _Proof Key for Code Exchange_ (RFC 7636) : rend inutilisable un `code` volé en route.                                   |
| BFF                 | _Backend For Frontend_ : le serveur garde les jetons et ne donne au navigateur qu'un cookie de session.                 |
| Shadow User         | Le compte local que l'application crée au premier login, lié à `(keycloak, sub)`.                                       |
| Audience (`aud`)    | La ressource à laquelle un jeton d'accès est destiné ; ton API refuse un jeton qui ne la nomme pas.                     |

## Qu'est-ce que c'est ?

Keycloak est le **guichet d'accueil d'un immeuble**. Chaque société de l'immeuble (chaque
application) fait confiance au badge qu'il délivre, sans tenir son propre registre de visiteurs. Le
visiteur montre ses papiers une fois, au guichet ; les sociétés ne voient que le badge.

Pour ton application, cela bloque trois risques concrets :

- **Le mot de passe ne transite jamais par l'application** : une faille chez toi ne fait pas fuir
  les identifiants de l'annuaire.
- **Un `code` intercepté ne sert à rien** : sans le `code_verifier` (PKCE) et sans le secret du
  client, Keycloak refuse l'échange.
- **Un départ se gère à un seul endroit** : désactiver le compte dans le realm ferme la porte de
  toutes les applications qui s'y fient, à leur prochaine connexion.

## La vision Nodefony

**Aucun code propre à Keycloak.** Un serveur OpenID Connect publie lui-même ses points d'entrée ;
le fournisseur `keycloak` les **découvre** à partir de l'émetteur, et c'est tout ce qu'il sait faire
(`createDiscoveredOidcProvider()`, `oidc.ts#createDiscoveredOidcProvider`). Changer de realm, c'est changer une URL.

**Une configuration fausse arrête le démarrage.** Le fournisseur `keycloak` est enregistré avec
`requiresIssuer: true` (`oauthProviderRegistry.ts#withKeycloakThemeHint`). Au boot, un émetteur absent, ou qui n'est
pas une URL `https` sans requête ni fragment, lève une erreur qui nomme la clé
(`checkProviderIssuer()`, `oauth2.ts#checkProviderIssuer`). Un Keycloak **éteint**, lui, ne bloque rien : le bouton
disparaît de l'écran de connexion et revient tout seul quand le realm répond à nouveau
(`#isReachable()`, `oauth2.ts#OAuth2Service.#isReachable`).

**L'identité est la paire `(keycloak, sub)`, jamais l'email.** Au premier login, l'application crée
un compte local lié à cette paire (`UserService.provisionOAuthUser()`, `UserService.ts#UserService.provisionOAuthUser`). Un
compte local qui porte déjà le même identifiant sans ce lien n'est **jamais** rattaché en silence :
la connexion est refusée (`UserService.ts#UserService.changePassword`).

**Keycloak authentifie, l'application autorise.** Les rôles du realm ne sont pas lus : le compte
reçoit `defaultRoles` à sa création, puis la base locale fait foi. Une élévation se fait dans
l'application, pas dans Keycloak.

## 🚀 Démarrage rapide

### Essayer en deux minutes : le Keycloak du dépôt

Le dépôt fournit un Keycloak 26.8 **déjà configuré** : un realm `nodefony`, un client confidentiel
`nodefony-dev`, ses deux rôles client `admin` et `admin-nodefony`, et trois utilisateurs. Tout est
écrit dans `docker/keycloak/import/realm-nodefony.json`, importé au premier démarrage du conteneur.

| Utilisateur | Mot de passe | Rôles Keycloak (client `nodefony-dev`) | Rôles obtenus dans l'application     |
| ----------- | ------------ | -------------------------------------- | ------------------------------------ |
| `alice`     | `alice-dev`  | aucun                                  | `ROLE_USER`                          |
| `bob`       | `bob-dev`    | `admin`                                | `ROLE_USER`, `ROLE_ADMIN`            |
| `cci`       | `cci-dev`    | `admin`, `admin-nodefony`              | + `ROLE_NODEFONY_ADMIN` (plateforme) |

`cci` doit configurer un **code à usage unique** (TOTP) à sa première connexion
(`"requiredActions": ["CONFIGURE_TOTP"]`) : le compte porte le rôle de plateforme, il exige un second
facteur, et aucune graine n'est écrite dans le fichier.

1. **Démarrer le conteneur** (en `https` sur le port 8444, avec le certificat de l'application) :

   ```bash
   docker compose -f docker/docker-compose.yml --profile keycloak up -d keycloak
   ```

2. **Brancher l'application** : poser dans `.env` (ignoré par git) les trois lignes
   ci-dessous — valeurs publiques, écrites dans le realm importé.

   ```bash
   NF_KEYCLOAK_ISSUER=https://localhost:8444/realms/nodefony
   NF_KEYCLOAK_CLIENT_ID=nodefony-dev
   NF_KEYCLOAK_CLIENT_SECRET=nodefony-dev-keycloak-secret
   ```

   Ces valeurs sont **publiques** : elles n'existent que dans ce décor de développement.

3. **Démarrer l'application**, ouvrir `https://localhost:5152/nodefony/login` : le bouton
   **Keycloak** est là. Se connecter avec `alice` / `alice-dev`.

La console d'administration du realm est sur `https://localhost:8444/admin` (`admin` /
`nodefony-dev`). Les retouches qu'on y fait survivent aux redémarrages ;
`docker compose … down -v` repart du fichier.

### Essayer dans une application générée

Une application créée par `nodefony create app` avec le préréglage `complete` porte déjà le
même décor, **à son nom** : un profil `keycloak` dans son `compose.yaml`, les variables
`NF_KEYCLOAK_*` déclarées dans `env.ts` et le fournisseur conditionnel dans
`nodefony/config/security.ts`. Tant qu'on ne l'allume pas, l'application démarre sans bouton ni
avertissement.

Le realm `docker/keycloak/import/realm.json` (realm et client nommés comme l'application,
utilisateur `alice`) et le thème `docker/keycloak/themes/nodefony/` ne viennent PAS du
générateur : ils sont **livrés par ce paquet** (`nodefony/keycloak/scaffold.ts`, appelé par le point
de contribution `nodefony/scaffold/contribute.ts` déclaré dans
`package.json` sous `nodefony.contribute`), et posés après l'installation. Ce sont de vrais
fichiers, versionnés avec l'application : le thème se retouche à ses couleurs. Les fichiers du thème
sont des **copies suivies** (empreintes dans `scaffold.lock.json`) ; le realm est une **semence**,
qui appartient à l'application dès qu'il existe (`security:keycloak:realm --write` le fait évoluer).

```bash
npx nodefony scaffold:sync            # pose ce qui manque (création en --no-install)
npx nodefony scaffold:sync --update   # après un npm update : rafraîchit le thème resté intact
```

Un fichier du thème retouché par l'application n'est jamais remplacé : il est signalé, et pour
reprendre la version du paquet on le supprime avant de relancer.

Rien ne prévient au démarrage qu'un `npm update` a laissé le thème en arrière : la page de
connexion de Keycloak garde simplement l'ancienne apparence. C'est `nodefony doctor --live` qui
le dit, famille « Fichiers livrés par les paquets » — une copie intacte en retard, ou un fichier
livré absent (un habillage ajouté par la nouvelle version), avec le geste
`nodefony scaffold:sync --update`. Une copie retouchée n'y est jamais signalée. Le diagnostic lit
le même plan que la console d'administration (`GET /nodefony/kernel/api/scaffold`), donc en
développement seulement ; ailleurs la famille est rendue « non contrôlée », avec sa raison.

Le thème couvre les **cinq types** de Keycloak, chacun hérité du thème de Keycloak qu'il habille
(seuls le logo, les couleurs et quelques textes sont posés — les pages restent celles de
Keycloak, donc justes à chaque mise à jour) :

| Type      | Ce qu'il habille                                   | Hérite de     | Choisi par                                           |
| --------- | -------------------------------------------------- | ------------- | ---------------------------------------------------- |
| `login`   | connexion, mot de passe oublié, erreurs            | `keycloak.v2` | le realm (`loginTheme`)                              |
| `account` | console du compte de l'utilisateur                 | `keycloak.v3` | le realm (`accountTheme`)                            |
| `admin`   | console d'administration                           | `keycloak.v2` | le realm (`adminTheme`)                              |
| `email`   | enveloppe HTML de tous les courriels               | `keycloak`    | le realm (`emailTheme`)                              |
| `welcome` | page d'accueil du serveur (avant le premier admin) | `keycloak`    | le SERVEUR : `KC_SPI_THEME__WELCOME_THEME: nodefony` |

**L'habillage de la page `/login` suit jusqu'à Keycloak.** Chaque habillage de
`loginPage.skin` a son thème de connexion Keycloak : `nodefony` pour `frontispiece` (le défaut),
`nodefony-<habillage>` pour les huit autres (`nodefony-blueprint`, `nodefony-horizon`…). Ce sont
des thèmes ENFANTS de `nodefony` : même gabarit, mêmes textes, plus la feuille de l'habillage (copie
conforme de celle du framework) et sa mise en page. Toutes les pages du parcours en héritent —
connexion, code à usage unique, configuration du second facteur, mot de passe oublié. Le compose
monte le dossier `docker/keycloak/themes/` ENTIER, pour que Keycloak les voie tous ; la console les
propose aussi dans _Realm settings › Themes_. Limite : seule l'enveloppe de la page est à Nodefony,
les formulaires restent ceux de Keycloak — `ledger` (colonnes et étapes numérotées) et `horizon`
(bandeau photo dans la carte) n'y portent que leurs couleurs et leur mise en page.

Le compose pose aussi `KC_SPI_THEME__DEFAULT: nodefony` : le realm `master`, que l'import ne touche
pas, prend le même thème — sa connexion et sa console d'administration comprises. Clair et sombre
suivent le réglage du système (`prefers-color-scheme`) ; le réglage _Dark mode_ du realm le coupe.
Le realm `master` n'est **pas importé** (Keycloak le crée au premier démarrage, l'import ne le touche
pas) : il naît sans internationalisation, donc en anglais et sans sélecteur de langue. Le régler une
fois dans sa console — _Realm settings › Localization_ : internationalisation activée, `fr` et `en`,
`fr` par défaut. Le réglage vit dans le volume `keycloak-data` : il survit aux redémarrages, pas à
un `down -v`. Sur sa page de connexion, le bouton « Retour à … » n'apparaît pas : il annule la
connexion, et les consoles de Keycloak lui-même ne savent pas traiter cette annulation.

Les comptes du realm généré reçoivent le rôle `default-roles-<realm>` : un compte importé n'a QUE
les rôles qu'on lui liste, et sans celui-là la console du compte lui refuse son propre profil
(`401`).

Le realm généré ne déclare **aucun serveur d'envoi** de courriels : « mot de passe oublié » reste
coupé tant que l'application n'en branche pas un (console : _Realm settings › Email_). Le dépôt,
lui, en a un de test — Mailpit (`--profile keycloak`, interface `http://localhost:8025`).

1. **Fabriquer le certificat de développement** (une fois — Keycloak le sert en `https`) :

   ```bash
   npx nodefony http:certificates
   ```

2. **Démarrer le conteneur** :

   ```bash
   docker compose --profile keycloak up -d keycloak
   ```

   Sous Linux natif, poser d'abord `export KEYCLOAK_UID=$(id -u)` : sinon la clé privée montée
   est illisible par le conteneur.

3. **Brancher l'application** : rien à faire. Le `.env` généré porte déjà les lignes
   `NF_KEYCLOAK_*`, actives et alignées sur le realm généré. Keycloak éteint, l'application démarre
   quand même : un avertissement, pas de bouton, et le bouton revient tout seul dès que Keycloak
   répond. Pour t'en passer, commente ces lignes.

4. **Démarrer l'application**, puis ouvrir `https://localhost:5152/nodefony/login` et se
   connecter avec `alice` / `alice-dev` :

   ```bash
   npm run dev
   ```

   Rien d'autre à poser, sous Windows comme ailleurs. Le Keycloak du décor sert le certificat de
   développement de l'application, et l'application **reconnaît d'office l'autorité qui l'a
   signé** : en développement, le service de certificats l'ajoute aux autorités de confiance du
   processus dès le démarrage, commandes en ligne comprises (`addDefaultCaCertificate()`,
   `certificates.ts#addDefaultCaCertificate`). La variable `NODE_EXTRA_CA_CERTS` n'est plus nécessaire.

Le realm généré porte aussi, comme celui du dépôt, un client **machine** `<app>-machine` (compte de
service, `client_credentials`). Ses jetons portent l'audience de la zone `partner` que le gabarit
`complete` ouvre (`https://localhost:5152/api/partner`) : `npx nodefony app:partner:call --issuer
keycloak` obtient un jeton et appelle `GET /api/partner/whoami` dès le premier démarrage. Quand tu
ouvres une autre zone (section « Le jeton Keycloak sur ton API », plus bas),
`npx nodefony security:keycloak:realm --write` ajoute le mapper qui inscrit sa `resource` dans les
jetons.

Le port de Keycloak (8444) se change par `KEYCLOAK_PORT` au `up` — l'émetteur suit, donc
`NF_KEYCLOAK_ISSUER` aussi. En production, le décor ne sert plus : les trois variables pointent
ton Keycloak, et `NF_OAUTH_REDIRECT_BASE` porte l'URL publique de l'application, base de l'URL de
retour.

### Le realm écrit depuis ta configuration

Les sections 1 et 2 ci-dessous déroulent les réglages à la main. Une fois le fournisseur branché
(section 4), Nodefony sait les écrire lui-même : **`nodefony security:keycloak:realm`** dérive le
realm de la configuration EFFECTIVE de l'application — client, URL de retour, déconnexion par canal
arrière, audience de chaque zone, rôles de `roleMapping`.

```bash
npx nodefony security:keycloak:realm             # affiche le realm
npx nodefony security:keycloak:realm --write     # l'écrit dans docker/keycloak/import/
npx nodefony security:keycloak:realm --check     # sort en 1 s'il ne suit plus la config (CI)
npx nodefony security:keycloak:realm --apply     # pose le thème de connexion sur le realm VIVANT (dev)
```

- **Il fusionne, il n'écrase pas.** Ce que la configuration dit est réécrit ; ce qu'un humain a
  ajouté survit : comptes, titres, secret du client machine, rôles déjà déclarés, mappers qui ne sont
  pas d'audience, autres clients (`mergeKeycloakRealm`, `nodefony/keycloak/keycloakRealm.ts`).
- **Hors développement, aucun secret n'est écrit** et seules les adresses de `redirectUri` sont
  déclarées : Keycloak génère le secret, tu le copies dans ton gestionnaire.
- **Le thème de connexion suit `loginPage.skin`** (`loginTheme`, `keycloakLoginTheme`,
  `nodefony/keycloak/keycloakRealmInput.ts`) — mais seulement sur un realm déjà habillé par
  Nodefony : un thème propre à l'application n'est jamais remplacé, et l'habillage non appliqué
  s'annonce en avertissement.
- **Keycloak n'importe un realm qu'à sa création.** Le thème d'un realm déjà là se pose par
  `--apply` (ci-dessous), ou à la main dans **Realm settings** › **Themes** › _Login theme_. Le
  reste d'un realm déjà là se met à jour par
  **Realm settings** › **Action** › **Partial import**, clients en « Overwrite » : comptes et seconds
  facteurs restent.

### Le thème suit l'habillage de `/login` — `--apply`, et le service `keycloak`

Changer `loginPage.skin` ne change pas la page de Keycloak : le thème vit dans SA base (réglage
`loginTheme` du realm). `--apply` le pose par l'**API d'administration** de Keycloak, qui exige le
compte administrateur du SERVEUR (realm `master`) — celui du compose de développement :

```typescript ignore
// nodefony/config/security.ts — le compte ne passe qu'en développement
keycloak: {
  issuer: ctx.env.NF_KEYCLOAK_ISSUER,
  // …
  ...(ctx.isDev
    ? { admin: { username: ctx.env.NF_KEYCLOAK_ADMIN_USERNAME, password: ctx.env.NF_KEYCLOAK_ADMIN_PASSWORD } }
    : {}),
},
```

- **Développement seulement** : refusé dans tout autre environnement, même compte posé ; le mot de
  passe ne part qu'en https et n'est jamais journalisé.
- **Un thème de l'application n'est jamais remplacé** : seul un realm déjà sur `nodefony` ou
  `nodefony-*` change d'habillage.
- **Toutes les actions Keycloak passent par le service `keycloak`** (`KeycloakService`) : realm
  dérivé (`realmPlan`, `writeRealm`), client d'administration (`admin()`, jeton gardé jusqu'à son
  expiration), thème (`applyLoginTheme`). La commande n'en garde que l'affichage ; une route de
  développement l'appelle aussi — c'est ce que fait l'application de ce dépôt pour que le sélecteur
  d'aperçu de `/login` (`loginPage.previewHook`) entraîne Keycloak.
- **L'écart se voit sans rien appliquer** : `nodefony doctor --live` et `security:oauth:doctor`
  lisent le thème sur la page publique de Keycloak (aucun identifiant) et signalent
  `login-theme-mismatch` quand il ne suit pas `loginPage.skin`.

Le client machine suivi est celui qu'on nomme (`--machine <clientId>`), sinon le compte de service
que le fichier déclare déjà. Le canal arrière vise `http://host.docker.internal:<port>` en
développement (Keycloak vit dans un conteneur) ; `--backchannel-origin` le déplace.

### 1. Créer le realm

Dans la console d'administration de **ton** Keycloak :

1. **Create realm** (à côté de _Current realm_), donner un nom — par exemple `mon-entreprise`.
2. Le realm créé devient le realm courant. Ses utilisateurs s'y créent sous **Users**, ou s'y
   importent depuis un annuaire LDAP (**User federation**).

Ne pas travailler dans le realm `master` : il administre Keycloak lui-même.

### 2. Déclarer le client confidentiel

**Clients** › **Create client**, type **OpenID Connect**. Les réglages qui comptent :

| Réglage Keycloak                        | Valeur                                                                             | Pourquoi                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Client ID**                           | `mon-app`                                                                          | Devient `NF_KEYCLOAK_CLIENT_ID`.                                                                           |
| **Client authentication**               | **ON**                                                                             | Client **confidentiel** : l'application tourne sur un serveur, elle garde un secret. Nodefony en exige un. |
| **Standard flow**                       | coché                                                                              | C'est le flux _Authorization Code_, le seul que Nodefony emploie.                                          |
| **Direct access grants**                | décoché                                                                            | Ce flux fait transiter le mot de passe par l'application — exactement ce qu'on évite.                      |
| **Implicit flow**                       | décoché                                                                            | Retiré par OAuth 2.1 : il livre le jeton dans l'URL.                                                       |
| **PKCE method**                         | `S256`                                                                             | Keycloak **exige** alors PKCE pour ce client ; Nodefony l'envoie toujours.                                 |
| **Valid redirect URIs**                 | `https://app.example.com/nodefony/security/api/oauth2/keycloak/callback`           | Comparée **au caractère près** (RFC 9700). Pas de joker en production.                                     |
| **Valid post logout redirect URIs**     | `https://app.example.com/*`                                                        | Retour du navigateur après la déconnexion initiée par l'application.                                       |
| **Front channel logout**                | **OFF**                                                                            | Il exige une page que l'application n'a pas ; activé, Keycloak n'appelle PAS le canal arrière.             |
| **Backchannel logout URL**              | `https://app.example.com/nodefony/security/api/oauth2/keycloak/backchannel-logout` | Keycloak y prévient l'application quand la session SSO se ferme ailleurs. Joignable **par Keycloak**.      |
| **Backchannel logout session required** | **ON**                                                                             | Le jeton porte le `sid` : seule LA session concernée est fermée, pas toutes celles du compte.              |

Puis l'onglet **Credentials** : copier le **Client secret**. C'est `NF_KEYCLOAK_CLIENT_SECRET`.

> [!WARNING]
> L'URL de retour enregistrée chez Keycloak et celle que l'application envoie doivent être
> **identiques** : schéma, hôte, port, chemin. `localhost` et `127.0.0.1` sont deux hôtes
> différents. Une différence d'un caractère donne `Invalid parameter: redirect_uri` sur la page
> Keycloak, avant même le formulaire de connexion.

### 3. Lire l'émetteur

**Realm settings** › onglet **General** › lien **OpenID Endpoint Configuration**. Le document qui
s'ouvre commence par la valeur à recopier :

```json
{ "issuer": "https://sso.example.com/realms/mon-entreprise", "…": "…" }
```

C'est `NF_KEYCLOAK_ISSUER`, sans barre finale ni `/.well-known/…`. Elle doit être en `https`.

Keycloak calcule cette valeur à partir de son nom d'hôte. Derrière un proxy, ou quand le navigateur
et l'application ne joignent pas Keycloak par la même adresse, fixer `KC_HOSTNAME` à l'URL publique
complète : sinon l'émetteur change selon qui demande, et l'application refuse les jetons.

### 4. Brancher l'application

Les trois valeurs entrent par `env.ts`, seul lecteur des variables d'environnement. Le fournisseur
n'est déclaré que si les trois sont présentes : pas de bouton mort quand une variable manque.

```ts ignore
// nodefony/config/security.ts — le fragment du module, importé par le manifeste
import type { ConfigContext } from "nodefony";
import type { ISecurityConfigInput } from "@nodefony/security";
import type { env } from "../../env";

export const securityConfig = (ctx: ConfigContext<typeof env>) =>
  ({
    oauth2: {
      // Rôles posés à la CRÉATION du compte local ; ceux du realm ne sont pas lus.
      defaultRoles: ["ROLE_USER"],
      providers: {
        ...(ctx.env.NF_KEYCLOAK_ISSUER &&
        ctx.env.NF_KEYCLOAK_CLIENT_ID &&
        ctx.env.NF_KEYCLOAK_CLIENT_SECRET
          ? {
              keycloak: {
                issuer: ctx.env.NF_KEYCLOAK_ISSUER,
                clientId: ctx.env.NF_KEYCLOAK_CLIENT_ID,
                clientSecret: ctx.env.NF_KEYCLOAK_CLIENT_SECRET,
                redirectUri: `${ctx.env.NF_OAUTH_REDIRECT_BASE}/nodefony/security/api/oauth2/keycloak/callback`,
                // Libellé du bouton ; omis, il vaut « Keycloak ».
                label: "Compte entreprise",
              },
            }
          : {}),
      },
    },
  }) satisfies ISecurityConfigInput;
```

```typescript ignore
// env.ts — SEUL lecteur de process.env (catalogue typé, validé au boot).
// nodefony.config.ts — `ctx.env` EST ce catalogue (typé par le paramètre générique).
import { defineConfig, defineEnv, envString, use } from "nodefony";
import { securityConfig } from "./nodefony/config/security";

export const env = defineEnv({
  // Émetteur = URL du realm, en https (la découverte et le contrôle de `iss` en partent).
  NF_KEYCLOAK_ISSUER: envString({ optional: true }),
  NF_KEYCLOAK_CLIENT_ID: envString({ optional: true }),
  NF_KEYCLOAK_CLIENT_SECRET: envString({ optional: true }),
  // Base des URL de retour : celle que Keycloak a enregistrée, au caractère près.
  NF_OAUTH_REDIRECT_BASE: envString({ default: "https://localhost:5152" }),
});

export default defineConfig<typeof env>((ctx) => ({
  modules: [
    "@nodefony/http",
    "@nodefony/framework",
    use("@nodefony/security", securityConfig(ctx)),
  ],
}));
```

L'application doit faire **confiance au certificat** de Keycloak, puisqu'elle l'appelle en `https`.
C'est comme un badge présenté à l'accueil : l'application ne laisse entrer que les badges signés
par une autorité qu'elle connaît. Trois cas :

| Le certificat de Keycloak est signé par…                           | Ce qu'il faut faire                                                                                |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| une autorité publique (Let's Encrypt…)                             | rien                                                                                               |
| l'autorité de **développement** de Nodefony (le Keycloak du décor) | rien : reconnue d'office en développement                                                          |
| la même, mais l'application tourne en **production** sur le poste  | la déclarer : `NF_TLS_CA_FILE=nodefony/config/certificates/ca/nodefony-root-ca.crt.pem`            |
| l'autorité de **ton entreprise** (Keycloak interne)                | la déclarer : `NF_TLS_CA_FILE=certs/autorite-entreprise.pem` dans `.env`, ou dans le Secret du pod |

`NF_TLS_CA_FILE` alimente la clé `certificates.extraCaFiles` du module `@nodefony/http` : un ou
plusieurs fichiers PEM, absolus ou relatifs à la racine de l'application, une chaîne entière
(racine + intermédiaires) pouvant tenir dans un seul fichier. Ils sont ajoutés aux autorités du
processus au démarrage, avant tout service (`trustCaFile()`, `certificates.ts#trustCaFile`), et servent à
**tous** ses appels sortants : découverte, point de jeton, jeu de clés. Un fichier introuvable, ou
sans certificat, **interrompt le démarrage** en nommant le chemin (code 78) — plutôt qu'un
`fetch failed` au premier clic d'un utilisateur. Seule exception : l'autorité de développement pas
encore engendrée est ignorée en mode `development` (le journal le dit) ; en production, elle doit
exister — `npx nodefony http:certificates` l'engendre. C'est l'équivalent, porté par la configuration, de
`NODE_EXTRA_CA_CERTS` : même effet, sans syntaxe de shell à traduire sous Windows.

Pourquoi la deuxième ligne du tableau : l'autorité de développement n'est reconnue d'office qu'en
mode `development` (`Certificate.trustDevelopmentAuthority()`, `certificates.ts#Certificate.trustDevelopmentAuthority`). Lancée
en production — pour essayer le build sur le poste, par exemple —, l'application ne lui fait plus
confiance sans qu'on le lui dise, et c'est voulu : une application de production qui adopterait en
silence une autorité de développement ouvrirait une porte qu'aucune configuration ne montre. Le
refus nomme la variable à poser (`certificat refusé (SELF_SIGNED_CERT_IN_CHAIN)` →
`NF_TLS_CA_FILE=…`), et le `.env` généré porte déjà la ligne exacte, en commentaire.

### 5. Le premier login — ce qu'on observe

```bash
# Le bouton est offert à l'écran de connexion :
curl -s https://localhost:5152/nodefony/security/api/oauth2/providers
# {"providers":[{"name":"keycloak","label":"Compte entreprise"}]}
```

Au clic, l'utilisateur passe par la page de connexion du realm, puis revient connecté. Côté
application :

- un **compte local** est créé, identifiant = l'email du realm (ou `keycloak:<sub>` sans email),
  rôles = `defaultRoles`, sans mot de passe local ;
- ce compte porte le lien `(keycloak, sub)` : les connexions suivantes le retrouvent par ce lien,
  même si l'email change dans le realm ;
- la session est une **session BFF** ordinaire, la même qu'après un mot de passe.

Les écrans **Utilisateurs** et **Sessions** de Studio montrent le compte et sa session.

## ⚙️ Configuration

Les clés de `security.oauth2.providers.keycloak` — le schéma complet vit sur la page
[OAuth2](oauth2.md).

| Clé                  | Requise | Effet                                                                                                                                                                                                      |
| -------------------- | :-----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issuer`             |   ✅    | URL `https` du realm. Absente ou mal formée : le démarrage est refusé.                                                                                                                                     |
| `clientId`           |   ✅    | **Client ID** du client Keycloak.                                                                                                                                                                          |
| `clientSecret`       |   ✅    | **Client secret** de l'onglet _Credentials_. Jamais journalisé.                                                                                                                                            |
| `redirectUri`        |   ✅    | URL de retour, identique à l'une des **Valid redirect URIs** du client.                                                                                                                                    |
| `discoveryUrl`       |         | Adresse COMPLÈTE où lire le document de découverte, quand l'application ne joint pas l'émetteur (service interne d'un cluster). Voir [En cluster](#-en-cluster--joindre-keycloak-par-son-adresse-interne). |
| `clientAuthMethod`   |         | `client_secret_basic` par défaut ; `client_secret_post` si le client Keycloak l'exige.                                                                                                                     |
| `scopes`             |         | Vide = `openid`, `profile`, `email`.                                                                                                                                                                       |
| `defaultRoles`       |         | Rôles du compte à sa création, pour CE fournisseur (sinon la valeur globale `oauth2.defaultRoles`).                                                                                                        |
| `roleMapping`        |         | Rôles Keycloak → rôles de l'application, recalculés à chaque connexion et à chaque jeton. Voir [Rôles](#-rôles--gérer-les-droits-dans-keycloak).                                                           |
| `rolesSource`        |         | Où lire les rôles : `client` (défaut), `realm`, `groups`. Sans `roleMapping`, sans effet.                                                                                                                  |
| `allowPlatformRoles` |         | `true` autorise `roleMapping` à donner un `ROLE_NODEFONY_*`. Omis : démarrage refusé.                                                                                                                      |
| `audiences`          |         | Ressources pour lesquelles ce realm émet des jetons à l'application. Lue par `security:keycloak:realm` seulement. Omis : toutes les zones `external-jwt`.                                                  |
| `label`              |         | Libellé du bouton. Omis : « Keycloak ».                                                                                                                                                                    |
| `hidden`             |         | Retire le bouton sans fermer le flux (lien direct, sous-domaine dédié).                                                                                                                                    |

## 🎭 Rôles — gérer les droits dans Keycloak

**L'idée.** Sans réglage, Keycloak dit seulement à l'application **qui** se connecte. Les droits
(`ROLE_ADMIN`…) sont posés à la création du compte, puis gérés dans l'application, à la main.
Une entreprise qui a Keycloak veut souvent l'inverse : promouvoir quelqu'un **une fois**, dans
Keycloak, et que l'application suive. C'est le rôle de la table `roleMapping` — un **dictionnaire
de traduction** : « quand Keycloak dit `admin`, chez moi ça s'appelle `ROLE_ADMIN` ».

**Côté Keycloak**, deux gestes dans la console du realm :

1. **Clients** › ton client › **Roles** › _Create role_ : `admin`. Le rôle appartient au client,
   c'est-à-dire à TON application — pas à tout le realm.
2. **Users** › l'utilisateur › **Role mapping** › _Assign role_ › filtre _client roles_ › `admin`.

Dans un realm importé, c'est le bloc `roles.client` et la clé `clientRoles` de l'utilisateur :

```json
"roles": { "client": { "mon-app": [{ "name": "admin" }] } },
"users": [{ "username": "bob", "clientRoles": { "mon-app": ["admin"] } }]
```

**Côté Nodefony**, la table sur le fournisseur :

```typescript ignore
keycloak: {
  issuer: ctx.env.NF_KEYCLOAK_ISSUER,
  clientId: ctx.env.NF_KEYCLOAK_CLIENT_ID,
  clientSecret: ctx.env.NF_KEYCLOAK_CLIENT_SECRET,
  redirectUri: "https://app.example.com/nodefony/security/api/oauth2/keycloak/callback",
  roleMapping: { admin: "ROLE_ADMIN" },
},
```

**Ce qui se passe à la connexion de bob** :

1. Keycloak rend un jeton d'accès qui porte `"resource_access": { "mon-app": { "roles": ["admin"] } }`
   — c'est là, et seulement là par défaut, que Keycloak met les rôles (ni dans l'ID token, ni
   dans _userinfo_).
2. `mapProviderRoles()` (`providerRoles.ts#mapProviderRoles`) traduit `admin` → `ROLE_ADMIN` par la table.
3. Le compte de bob reçoit `ROLE_ADMIN` (`reconcileProviderRoles()`, `user/nodefony/src/providerRoles.ts#reconcileProviderRoles` côté
   `@nodefony/user`).

**Les règles, à connaître avant de l'activer :**

- **Recalcul à chaque connexion ET à chaque jeton d'API.** Un rôle retiré dans Keycloak disparaît
  au login suivant, et dès le jeton suivant sur l'API (`syncOAuthRoles()`, `UserService.ts#UserService.syncOAuthRoles`).
  Une session déjà ouverte garde ses droits jusqu'à la reconnexion.
- **Un rôle Keycloak absent de la table est ignoré**, jamais recopié tel quel : l'annuaire ne
  fabrique pas de droit que l'application n'a pas déclaré.
- **Les rôles donnés à la main survivent.** L'application retient, dans les métadonnées du compte
  (`metadata.providerRoles.keycloak`), ce que Keycloak a accordé : elle ne retire que cela. Seule
  ambiguïté : un rôle à la fois donné à la main ET accordé par Keycloak devient « géré » — le
  retirer dans Keycloak le retire aussi.
- **Aucune écriture en base si rien ne change** : le recalcul tombe sur chaque requête porteuse
  de jeton, il ne coûte une écriture que lorsqu'un rôle bouge.
- **Rôles du realm ou groupes** : `rolesSource: ["realm"]` lit `realm_access.roles`,
  `["groups"]` le claim `groups` (à poser chez Keycloak par un mapper _Group Membership_).
  Plusieurs sources se cumulent.
- **Rôles de plateforme (`ROLE_NODEFONY_*`) refusés par défaut.** Ils ouvrent la console
  d'administration, la génération de code, les secrets : les faire venir de Keycloak fait de
  l'administrateur du realm un administrateur de l'instance. La table qui en contient un refuse
  le démarrage (`config.ts#oauthProviderSchema`) — sauf `allowPlatformRoles: true` ÉCRIT sur le fournisseur, que
  chaque démarrage rappelle par un avertissement. Sinon, ce rôle se donne à la main
  (`security:user:add --admin`, console d'administration).

## 🧩 Le jeton Keycloak sur ton API — le même compte

Une fois les humains connectés par le navigateur, un script ou un service veut souvent appeler l'API
avec un **jeton d'accès** du même realm. La page [Jetons d'un émetteur tiers](external-jwt.md)
décrit cette brique en entier ; voici ce que Keycloak y ajoute.

**Côté Keycloak**, le jeton doit nommer ton API dans son audience (`aud`) — par défaut il porte
`account`, que toute zone refuse. `nodefony security:keycloak:realm --write` écrit le mapper pour
chaque ressource listée dans `audiences` du fournisseur, sinon pour la `resource` de chaque zone
`external-jwt`. À la main : dans le client, **Client scopes** › le scope dédié › **Add mapper** ›
_Audience_, avec **Included Custom Audience** = la `resource` de la zone et **Add to access token**
coché.

> [!TIP]
> Écris `audiences` dès qu'une zone `external-jwt` ne doit PAS recevoir les jetons de ce realm (une
> API d'un autre domaine de confiance, une zone de test) : sans la liste, la commande déduit
> l'audience de toutes les zones, et Keycloak imprimerait aussi l'adresse de celle-là.

**Côté Nodefony**, déclarer le realm comme émetteur de confiance et ouvrir une zone qui accepte ses
jetons :

```typescript ignore
// nodefony/config/security.ts
import type { ISecurityConfigInput } from "@nodefony/security";

export const securityConfig = () =>
  ({
    resourceServer: {
      issuers: [
        // Les clés publiques du realm sont découvertes par l'émetteur.
        {
          issuer: "https://sso.example.com/realms/mon-entreprise",
          algorithms: ["RS256"],
        },
      ],
    },
    areas: {
      api: {
        pattern: "^/api",
        authenticators: ["external-jwt"],
        stateless: true,
        // L'audience exigée : celle que le mapper inscrit dans le jeton.
        resource: "https://api.example.com",
      },
    },
  }) satisfies ISecurityConfigInput;
```

**Le même compte, pas un second.** Quand l'émetteur d'un jeton est celui d'un fournisseur de
connexion déclaré (`oauth2.providers.keycloak.issuer`), l'authenticator cherche d'abord le compte lié
à `(keycloak, sub)` — celui que le login par navigateur a créé (`ExternalSubjectResolver.ts#IExternalIssuerBinding.issuer`).
Sans ce lien, le jeton désignerait un compte distinct, sous l'identifiant `<émetteur>#<sub>`.

## ☸️ En cluster — joindre Keycloak par son adresse interne

Dans un cluster Kubernetes, ton application et Keycloak tournent côte à côte. Pour se parler, ils
passent par le **service interne** (`http://keycloak.sso:8080`), sans ressortir sur Internet. Les
navigateurs, eux, ne connaissent que l'adresse **publique** (`https://sso.example.com`).

C'est comme le standard téléphonique d'une entreprise : entre collègues on compose le poste
interne, de l'extérieur le numéro public — mais la personne qui décroche se présente toujours
**sous le même nom**. Ce nom, c'est l'**émetteur** (`issuer`) : l'adresse publique du realm, celle
qu'on retrouve dans chaque jeton.

Sans réglage, l'application lit la « carte d'identité » de Keycloak (le document de découverte)
**à l'adresse de l'émetteur**, donc l'adresse publique — que bien des pods ne joignent pas, ou
seulement en ressortant par l'ingress. Et si on écrit l'adresse interne à la place de l'émetteur,
Keycloak répond « je m'appelle `https://sso.example.com/…` » : l'application refuse, et elle a
raison — c'est la garde qui empêche un serveur de parler au nom d'un autre (RFC 8414 §3.3).

`discoveryUrl` dit les deux à la fois : **lis la carte ici, mais exige que la personne se présente
sous ce nom-là.**

**Côté Keycloak**, deux réglages (guide Keycloak _Configuring the hostname_) :

```bash
# Le nom public, en URL COMPLÈTE : c'est lui que porteront `iss` et les pages de connexion.
KC_HOSTNAME=https://sso.example.com
# Les points appelés de serveur à serveur suivent l'adresse par laquelle on interroge Keycloak.
KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true
```

**Côté application**, une variable de plus dans le Secret du pod, à côté des trois `NF_KEYCLOAK_*` :

```bash
NF_KEYCLOAK_DISCOVERY_URL=http://keycloak.sso:8080/realms/mon-entreprise/.well-known/openid-configuration
```

Le gabarit `complete` la porte déjà vers les deux usages du realm — la connexion (le bouton) et
les jetons sur ton API :

```typescript ignore
use("@nodefony/security", {
  oauth2: {
    providers: {
      keycloak: {
        issuer: ctx.env.NF_KEYCLOAK_ISSUER, // https://sso.example.com/realms/mon-entreprise
        discoveryUrl: ctx.env.NF_KEYCLOAK_DISCOVERY_URL, // le service interne
        clientId: ctx.env.NF_KEYCLOAK_CLIENT_ID,
        clientSecret: ctx.env.NF_KEYCLOAK_CLIENT_SECRET,
        redirectUri: `${ctx.env.NF_OAUTH_REDIRECT_BASE}/nodefony/security/api/oauth2/keycloak/callback`,
      },
    },
  },
  resourceServer: {
    issuers: [
      {
        issuer: ctx.env.NF_KEYCLOAK_ISSUER,
        discoveryUrl: ctx.env.NF_KEYCLOAK_DISCOVERY_URL,
        algorithms: ["RS256"],
      },
    ],
  },
});
```

**Ce qu'on observe** — le document qu'un Keycloak 26.8 réglé ainsi rend quand on l'interroge par
son adresse interne (constaté, pas déduit) :

| Point d'entrée           | Qui l'appelle                        | Adresse publiée              |
| ------------------------ | ------------------------------------ | ---------------------------- |
| `issuer`                 | —                                    | `https://sso.example.com/…`  |
| `authorization_endpoint` | le **navigateur**                    | `https://sso.example.com/…`  |
| `end_session_endpoint`   | le **navigateur**                    | `https://sso.example.com/…`  |
| `token_endpoint`         | l'application (de serveur à serveur) | `http://keycloak.sso:8080/…` |
| `jwks_uri`               | l'application (de serveur à serveur) | `http://keycloak.sso:8080/…` |

**Ce qui reste vérifié**, et ne se relâche jamais :

- **L'émetteur est comparé à l'identique.** Seul le lieu de lecture change
  (`metadataCandidateUrls()`, `authorizationServer.ts#metadataCandidateUrls`) : un document lu à l'adresse interne
  qui se déclare d'un autre émetteur est refusé.
- **Le `http` n'est admis que sur l'origine EXACTE de `discoveryUrl`** — même schéma, même hôte,
  même port —, et seulement pour le point de jeton et le jeu de clés
  (`isBackChannelTransportAllowed()`, `authorizationServer.ts#isBackChannelTransportAllowed`). L'opérateur a déjà choisi
  cette adresse en l'écrivant ; un `http` vers une autre adresse est une adresse que personne n'a
  écrite, refusée.
- **Les points du navigateur restent en `https`** (autorisation, déconnexion) : un navigateur
  renvoyé vers une adresse interne n'aboutirait nulle part.
- **L'adresse est vérifiée au démarrage** : ni `http(s)`, ou porteuse d'identifiants ou d'un
  fragment → démarrage refusé (`parseDiscoveryUrl()`, `authorizationServer.ts#parseDiscoveryUrl`).

> [!WARNING]
> Une adresse interne en `http` fait passer le **secret du client** et les jetons **en clair** sur
> le réseau du cluster. C'est le choix courant derrière un maillage de services (mTLS) ou dans un
> réseau isolé ; sinon, servir Keycloak en `https` sur l'adresse interne aussi, et déclarer son
> autorité par `NF_TLS_CA_FILE`.

## 🔐 Sécurité

- **`https` partout, même en développement.** L'ID token est lu sans vérifier sa signature, ce
  qu'OIDC Core §3.1.3.7 n'admet que parce qu'il arrive du point de jeton par TLS. Un émetteur en
  `http` est refusé au démarrage (`canonicalIssuer()`, `authorizationServer.ts#canonicalIssuer`).
- **Client confidentiel obligatoire** : le schéma exige un secret non vide. Un client public ne
  conviendrait qu'à une application sans serveur, ce que n'est pas une application Nodefony.
- **Anti-mix-up** : le paramètre `iss` du retour et le claim `iss` de l'ID token doivent égaler
  l'émetteur découvert (RFC 9207). Un retour venu d'un autre realm est rejeté.
- **Rôles de plateforme hors de portée de l'annuaire**, sauf ouverture écrite
  (`allowPlatformRoles`) : un realm compromis ne donne pas, par défaut, la console
  d'administration. Un rôle Keycloak absent de `roleMapping` ne donne rien.
- **Aucune liaison par email** : un email, même vérifié par le realm, ne donne jamais accès à un
  compte local existant. Le rattachement d'un compte local à un `sub` Keycloak se fait
  explicitement.
- **Déconnexion, dans les deux sens.** Se déconnecter de l'application ferme aussi la session du
  realm : la réponse porte `logoutUrl`, où le navigateur est envoyé avec l'ID token en
  `id_token_hint` — sans page de confirmation, et le clic suivant redemande le mot de passe. À
  l'inverse, une session fermée **chez Keycloak** (console d'administration, autre application du
  SSO) ferme la session de l'application par le **canal arrière** : Keycloak appelle
  `…/oauth2/keycloak/backchannel-logout` avec un jeton signé, que l'application vérifie sur les clés
  du realm avant de détruire quoi que ce soit (détail : [OAuth2 § canal arrière](oauth2.md#déconnexion-demandée-par-le-fournisseur--le-canal-arrière)).

## ⚠️ Pièges

Avant de lire le tableau, **demander le diagnostic** : il éprouve le branchement sans qu'un humain
se connecte, et nomme la cause là où le journal ne montre qu'un `401`.

```bash
npx nodefony security:oauth:doctor               # tous les fournisseurs configurés
npx nodefony security:oauth:doctor -p keycloak   # un seul ; --json pour un script
```

Trois sondes, chacune avec son verdict : **découverte** (émetteur annoncé ≠ émetteur configuré,
RFC 8414 §3.3), **URL de retour** (la requête du bouton, non suivie : Keycloak refuse en 400 une
URL qu'il ne connaît pas), **secret** (un code inventé présenté avec le vrai secret :
`invalid_grant` = secret accepté). Sortie en 1 si une sonde échoue. `nodefony doctor --live` rend
les mêmes échecs (famille « Fournisseurs OAuth »), l'administration les sert sur
`/nodefony/security/api/oauth/diagnosis`. Côté Keycloak, la sonde ouvre une session de connexion
vide, qui expire seule.

| Symptôme                                                                                                                           | Cause                                                                                                                                          | Correction                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Démarrage refusé : `security.oauth2.providers.keycloak.issuer est requis`                                                          | Les trois variables ne sont pas posées ensemble, ou `issuer` manque à la main                                                                  | Poser `NF_KEYCLOAK_ISSUER` (`checkProviderIssuer()`, `oauth2.ts#checkProviderIssuer`)                                             |
| Démarrage refusé : `émetteur invalide … https`                                                                                     | Émetteur en `http`, ou avec `?…`/`#…`                                                                                                          | Recopier l'`issuer` du document _OpenID Endpoint Configuration_                                                                   |
| Pas de bouton + WARNING `oauth2 provider "keycloak" indisponible`                                                                  | Keycloak injoignable, ou certificat non reconnu (`fetch failed (SELF_SIGNED_CERT_IN_CHAIN …)`)                                                 | Démarrer Keycloak ; déclarer l'autorité d'entreprise par `NF_TLS_CA_FILE`. Retour sous 30 s                                       |
| Démarrage refusé (78) : `http.certificates.extraCaFiles : « … » est illisible`                                                     | Le fichier de `NF_TLS_CA_FILE` n'existe pas à ce chemin (relatif = à la racine de l'application)                                               | Corriger le chemin, ou monter le fichier dans le pod                                                                              |
| Avec `discoveryUrl` : `le document déclare « http://keycloak.sso:8080/… » alors qu'il a été demandé à « https://sso… »`            | `KC_HOSTNAME` absent : Keycloak prend le nom de l'adresse par laquelle on l'interroge                                                          | `KC_HOSTNAME` = l'URL publique COMPLÈTE                                                                                           |
| Avec `discoveryUrl` : le bouton est là, mais le retour de connexion échoue en `fetch failed` vers l'adresse publique               | `KC_HOSTNAME_BACKCHANNEL_DYNAMIC` absent : Keycloak publie son point de jeton sur l'adresse publique                                           | `KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true`                                                                                            |
| Avec `discoveryUrl` : `« token_endpoint » doit être en https (ou en http sur l'origine de discoveryUrl …)`                         | Keycloak publie une AUTRE origine que celle de `discoveryUrl` (hôte ou port réécrit par un intermédiaire)                                      | Écrire dans `discoveryUrl` exactement l'origine que Keycloak publie                                                               |
| `Invalid parameter: redirect_uri` sur la page Keycloak                                                                             | `redirectUri` ≠ les **Valid redirect URIs** du client                                                                                          | Aligner schéma, hôte (`localhost` ≠ `127.0.0.1`), port et chemin                                                                  |
| Retour sur `failureRedirect` + WARNING `unauthorized_client` (secret faux) ou `invalid_client` (client inconnu)                    | Mauvais secret, client absent du realm, ou client public (_Client authentication OFF_)                                                         | Recopier le secret de l'onglet _Credentials_ ; passer le client en ON                                                             |
| Retour sur `failureRedirect` + WARNING `OAuth issuer mismatch`                                                                     | Keycloak joint par deux adresses différentes : l'émetteur varie                                                                                | Fixer `KC_HOSTNAME` à l'URL publique complète                                                                                     |
| Retour sur `failureRedirect` + WARNING `local account exists without a keycloak link`                                              | Un compte local porte déjà cet identifiant (`UserService.ts#UserService.changePassword`) — typiquement un `sub` changé après réimport du realm | Rattacher le compte explicitement, ou fixer l'`id` des utilisateurs dans l'export du realm                                        |
| API : `401` avec un jeton Keycloak valide                                                                                          | Audience absente du jeton : pas de mapper _Audience_                                                                                           | `security:keycloak:realm --write` puis import partiel ; `aud` doit contenir la `resource` de la zone                              |
| Session de l'application vivante après une déconnexion chez Keycloak ; Keycloak journalise `Some clients have not been logged out` | _Front channel logout_ ON, ou **Backchannel logout URL** absente ou injoignable depuis Keycloak                                                | _Front channel logout_ OFF ; une URL que Keycloak joint (en développement Linux : serveur à l'écoute au-delà de la boucle locale) |

| Démarrage refusé : `… est un rôle de PLATEFORME` | `roleMapping` traduit vers un `ROLE_NODEFONY_*` | Donner ce rôle à la main, ou écrire `allowPlatformRoles: true` en connaissance de cause |
| Le rôle Keycloak n'apparaît pas dans l'application | Rôle du REALM alors que la source est `client`, ou rôle d'un autre client, ou session ouverte avant le changement | Créer le rôle sur le client de l'application, ou `rolesSource: ["realm"]` ; se reconnecter |

La cause d'un retour sur `failureRedirect` n'est jamais montrée au navigateur ; elle est dans le
journal du serveur, préfixée `oauth2 callback "keycloak"` (`OAuth2Controller.ts#OAuth2Controller.authorize`).

## 🧪 Tests & couverture

| Type        | Fichier                                                   | Ce qu'il prouve                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unitaire    | `security/tests/unit/oauth2Service.test.ts`               | Démarrage refusé sur émetteur absent ou mal formé ; bouton retiré puis rendu quand l'émetteur tombe.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Unitaire    | `security/tests/unit/oauthProviders.test.ts`              | Découverte, refus d'un serveur sans PKCE S256, contrôle des claims de l'ID token.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Unitaire    | `security/tests/unit/providerRoles.test.ts`               | Lecture des claims (client, realm, groupes), rôle inconnu ignoré, refus des rôles de plateforme sauf `allowPlatformRoles`, recalcul à la connexion et au jeton, aucune écriture sans changement.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Unitaire    | `security/tests/unit/keycloakRealmInput.test.ts`          | La configuration de l'application de dev, dérivée puis fusionnée, rend `realm-nodefony.json` octet pour octet ; audiences déduites ou écrites, production sans secret, rôles rangés selon `rolesSource`.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Unitaire    | `security/tests/unit/providerDiagnosis.test.ts`           | Diagnostic : trois verdicts distincts (émetteur, URL de retour, secret) ; un `401` n'accuse le secret que si le client est prouvé connu ; non concluant ≠ échec ; sondes passées par le client du login.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Unitaire    | `security/tests/unit/keycloakRealm.test.ts`               | Fusion : ce que la config dit est réécrit, ce qu'un humain a écrit survit ; mapper d'audience remplacé, jamais doublé.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Unitaire    | `user/tests/unit/providerRoles.test.ts`                   | Rôles gérés contre rôles locaux : retrait, ajout, rôle à la main conservé, profil préservé.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Unitaire    | `security/tests/unit/oauthMetadata.test.ts`               | `discoveryUrl` : lu à cette adresse seule ; émetteur différent refusé ; point de jeton en `http` admis sur l'origine déclarée seulement ; point d'autorisation toujours en `https`.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Unitaire    | `nodefony/src/tests/authorizationServer.test.ts`          | La règle elle-même, au cœur : adresse validée, `jwks_uri` en `http` admis sur l'origine exacte (port compris), refusé ailleurs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Unitaire    | `http/nodefony/tests/unit/certificates.test.ts`           | `NF_TLS_CA_FILE` : une chaîne en un fichier devient N autorités ; fichier absent, vide, ou Node trop ancien → démarrage refusé ; un **vrai** serveur https signé par l'autorité déclarée devient joignable.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Intégration | `http/nodefony/tests/integration/oauth2-keycloak.test.ts` | Contre un **vrai** Keycloak : flux complet, même compte entre session et jeton d'API, `invalid_grant` rendu par Keycloak, déconnexion dans les deux sens, jeton de déconnexion forgé refusé ; `bob` obtient puis perd `ROLE_ADMIN` (session et jeton) quand le rôle bouge dans le realm, un rôle local survit ; `cci` obtient `ROLE_NODEFONY_ADMIN` par `allowPlatformRoles` ; le diagnostic rend ses trois verdicts sur des branchements faussés (secret, URL de retour, émetteur `127.0.0.1` au lieu de `localhost`) ; le realm lu par `127.0.0.1` avec `discoveryUrl` rend un jeton machine, et refuse un émetteur réellement différent. |

Le banc d'intégration exige le conteneur et les trois variables (décor `KEYCLOAK_GATE` de
`scripts/test/vitest/gates.ts`) ; sans eux il est sauté, et la passe le dit en fin de run. Le cas du canal
arrière constate en plus que le conteneur JOINT l'application (`host.docker.internal`) : un serveur
de développement sous Linux n'écoute que la boucle locale, le cas est alors sauté et le dit.

**Ce qui manque** : aucun banc versionné ne joue un Keycloak en `KC_HOSTNAME_BACKCHANNEL_DYNAMIC`
(points internes en `http`) — le tableau « Ce qu'on observe » a été constaté à la main sur un
Keycloak 26.8 jetable, et le banc versionné ne couvre que le cas `https`. Aucun ne joue non plus un
Keycloak derrière un proxy (émetteur variable), ni une rotation des clés du realm pendant une
session.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Sécurité — vue d'ensemble](index.md) · [Toute la documentation](../../../../../docs/index.md)
- [OAuth2](oauth2.md) — le flux, le contrat des fournisseurs, les autres fournisseurs (Google, GitHub, tout OIDC).
- [Jetons d'un émetteur tiers](external-jwt.md) — accepter les jetons d'accès du realm sur une API.
- [Authenticators](authenticators.md) — la session BFF qui suit la connexion.
- [`@nodefony/user`](../../user/docs/index.md) — le compte local et ses liens externes.
