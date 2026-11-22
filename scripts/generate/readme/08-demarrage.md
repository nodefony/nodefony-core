<!-- @if core,npm -->
## Démarrage

La version `10.0.0` est en ligne. Les ruptures n'arrivent qu'aux versions majeures, annoncées en
tête du [CHANGELOG](CHANGELOG.md). Une application se crée en une commande :

```bash
npm create nodefony mon-app
cd mon-app
npm run dev
```

L'application répond sur `http://127.0.0.1:5151` — ou le premier port libre, annoncé au
démarrage — et la console d'administration sur `/nodefony`.

**À quoi ressemble ce que la commande produit :**
[`github.com/nodefony/nodefony`](https://github.com/nodefony/nodefony). Ce dépôt n'est pas une
démonstration écrite à la main pour la vitrine — c'est la sortie littérale de
`nodefony create app --preset complete --frontend react`, poussée telle quelle et **régénérée à
chaque publication**. Base de données et migration initiale, sécurité et comptes, temps réel,
console d'administration, front React, infra docker de développement, chaîne d'intégration
continue : tout ce que tu y lis a été engendré, rien n'y a été retouché. C'est le moyen le plus
court de juger le code qu'on aura à maintenir, avant d'installer quoi que ce soit.

Générer du code — une application, un module, un contrôleur, une entité et toute sa chaîne :

```bash
npx nodefony create module blog --frontend react
npx nodefony create entity Article title:string body:text views:int
npx nodefony create controller admin --kind rest --role ROLE_ADMIN
```

Chaque générateur montre **le plan et le diff avant d'écrire quoi que ce soit**. Un refus ne laisse
rien derrière lui. Il publie aussi son catalogue en JSON et accepte ses réponses par fichier : la
même porte sert la personne au terminal, la console d'administration et un agent.
<!-- @end -->

<!-- @if app -->
## Démarrage

**Sur ton poste : Node 24.16+ ou 26+, et c'est tout** — npm vient avec lui (bun, pnpm et yarn
marchent aussi).<% if (it.db) { %> **Docker** en plus, parce que cette application parle à
<%= it.db.label %> : `npm run infra:up` le démarre dans un conteneur.<% } %> Le reste est
facultatif : **mkcert** donne un HTTPS de développement que le navigateur approuve (sans lui, un
certificat auto-signé), **git** versionne le projet, et **Docker** construit l'image de production
depuis le `Dockerfile`.

```bash
npm install
npm run build<% if (it.db) { %>
npm run infra:up     # docker : Redis + <%= it.db.label %> — AVANT l'app<% } %>
npm run dev
```

<% if (it.front) { %>- `http://127.0.0.1:5151/` — ton application <%= it.frontend %>, rechargée à chaud pendant que tu écris.<% } else { %>- `http://127.0.0.1:5151/` — ta page d'accueil dans un navigateur ; un programme (`curl`) y reçoit `{ "app": "<%= it.appName %>" }`, le nom et rien d'autre.<% } %><% if (it.complete) { %>
- `http://127.0.0.1:5151/nodefony` — **Studio**, la console d'administration.<% } %>

<% if (it.complete) { %>> **Le compte d'administration existe déjà** : `admin` / `<%= it.devAdminPassword %>`. Il
> est semé au PREMIER démarrage, et le journal te le redit alors en clair. Pour
> en changer : `npx nodefony security:user:password admin`. `NF_ADMIN_PASSWORD`
> ne sert qu'à la création du compte — posée après, elle est ignorée, et le
> démarrage le dit.
>
> 🔴 **Ce mot de passe par défaut n'existe qu'en développement.** En production,
> `NF_ADMIN_PASSWORD` est OBLIGATOIRE : sans elle, aucun compte n'est créé —
> rien n'est semé en silence avec un secret que le monde entier connaît. Le
> démarrage le dit et nomme le geste :
> `npx nodefony security:user:add admin --admin`.

> L'app **persiste déjà** : <% if (it.db) { %>`.env` déclare `NF_DATABASE_URL` sur le <%= it.db.label %> du
> `compose.yaml`<% } else { %>sans aucune base déclarée, l'ORM Drizzle crée une sqlite locale
> (`var/databases/`)<% } %> — comptes, sessions et jetons survivent aux redémarrages.
<% } %>
<!-- @end -->
