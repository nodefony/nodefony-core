## Ce que cette app n'a PAS — et le geste exact pour l'ajouter

Tout ce qui précède décrit les briques **installées ici**. Celles-ci manquent : le
framework les porte, cette application ne les a pas. N'en conclus pas qu'elles
n'existent pas, et n'en réécris **aucune** à la main.

<% if (!it.hasOrm) { %>- **Base de données — cette app n'a PAS d'ORM.** Aucune entité, aucun dépôt,
  aucune migration : `npx nodefony create entity` n'aurait nulle part où écrire.
  Pose-le, puis seulement génère :

  ```bash
  npm i @nodefony/orm-core @nodefony/drizzle drizzle-orm better-sqlite3
  # puis, dans nodefony.config.ts, ajoute "@nodefony/drizzle" au tableau `modules`
  npx nodefony create entity Produit nom:string prix:float
  npx nodefony orm:generate && npx nodefony orm:migrate
  ```

  Sans `NF_DATABASE_URL`, c'est un fichier **sqlite local** — aucun service à
  lancer. Cette variable, renseignée (`postgres://…`, `mysql://…`), suffit à
  viser une vraie base ; remplace alors `better-sqlite3` par `pg` ou `mysql2`.

<% } %><% if (!it.hasSecurity) { %>- **Sécurité — cette app n'a PAS de firewall, ni de comptes, ni de sessions.**
  Toute route est ouverte, `@IsGranted` n'a personne à qui refuser l'accès, et il
  n'existe aucune identité à présenter :

  ```bash
  npm i @nodefony/security @nodefony/user @node-rs/argon2
  # puis, dans nodefony.config.ts : use("@nodefony/security", { … })
  npx nodefony security:secrets -w      # clés de chiffrement, écrites dans l'env local
  npx nodefony security:user:add        # le premier compte
  ```

  ⚠️ **Elle ne s'ajoute pas seule** : comptes, sessions et jetons se PERSISTENT.
  `@nodefony/user` déclare `@nodefony/orm-core` en pair, et `@nodefony/drizzle`
  déclare `security` et `user` — ces briques forment une grappe, pose-les ensemble.

<% } %><% if (!it.hasRealtime) { %>- **Temps réel — cette app n'a PAS de socket.** Pas de canal, pas de diffusion
  du serveur vers le navigateur : un client qui ouvre un WebSocket n'obtient rien.

  ```bash
  npm i @nodefony/realtime
  # puis : use("@nodefony/realtime", { backplane: { driver: "cluster" } })
  ```

  `cluster` reste intra-pod et n'ajoute **aucune** dépendance externe ; `redis`
  ne sert qu'à diffuser entre plusieurs pods.

<% } %><% if (!it.front) { %>- **Front applicatif — cette app n'a PAS d'interface à elle.** Elle répond en
  JSON : aucun build Vite applicatif, aucun rechargement à chaud, rien à regarder
  dans un navigateur.<% if (it.hasStudio) { %> La console d'administration sert bien
  des écrans, mais ce sont les SIENS — ils ne deviennent pas ton interface.<% } %>
  `npx nodefony create front <nom>` pose un front (React, Vue ou Angular) et câble
  `@nodefony/frontend` — ne compose pas ce câblage à la main.

<% } %>Chaque brique ajoutée apporte AUSSI ses commandes, ses docs et parfois ses skills
d'agent : après l'avoir posée, redemande `npx nodefony --help` et lance
`npx nodefony ai:sync` (il pose les skills des paquets présents dans
`.agents/skills/`). ⚠️ **Ce fichier, lui, ne se régénère pas tout seul** : il est
réécrit au prochain `npx nodefony create module`, et la zone « Notes de cette app »
y survit. Tant qu'il ne l'est pas, il continue de décrire l'inventaire d'avant.
