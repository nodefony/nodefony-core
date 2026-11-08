# AGENTS.md — <%= it.pkgName %>

> Instructions agent de CE module. Standard AGENTS.md : **le fichier le plus
> proche gagne** — quand tu travailles dans ce dossier, il prime sur celui de
> l'app. Vérité COURANTE, jamais un journal : un fait périmé se CORRIGE.

## Rôle

La démo de Nodefony : ce que le framework sait faire, dans du code qui tourne,
servi sous `/demo` (pages ET API). Chaque fichier est écrit comme un MODÈLE à
recopier, pas comme un test : son TSDoc nomme le type à utiliser, la page de
doc, la commande qui génère l'équivalent et le skill à charger.

## Trouver la bonne démo — avant d'ouvrir un fichier

**`demos.ts` est l'index, et la source unique** : pour chaque démo, son niveau,
ce qu'elle apprend, les fichiers à lire DANS L'ORDRE, les types publics, la doc
(sous `node_modules`), la commande et le skill. L'accueil `/demo` en tire son
catalogue ; il n'existe aucun JSON parallèle.

Le test du module vérifie chaque renvoi de l'index (fichier présent, page de
doc installée, type exporté par son paquet, commande existante, skill livré) :
un renvoi mort le fait échouer.

## Composants

- `index.ts` — `DemoModule` : enregistre contrôleurs, services, commande et
  l'entrée front `demo`.
- `nodefony/controllers/` — une démo = un contrôleur sous `/demo/…` :
  `ChatController` (HTTP + socket, `ContractRealtimeController`),
  `PartnerController` (`/demo/api/partner`, zone `demo-partner` du firewall), les pages et l'accueil.
- `nodefony/service/` — l'état qui survit à une connexion (`ChatService`),
  le pouls de l'accueil (`DemoPulseService`, canal `demo:pulse`).
- `nodefony/config/security.ts` — les zones qu'apporte la démo :
  `demo` (session, puis anonyme) et `demo-partner` (jeton, `^/demo/api/partner`).
- `nodefony/command/PartnerCallCommand.ts` — `npx nodefony demo:partner:call`.
- `frontend/src/` — React, un seul front. Les types de messages sont PARTAGÉS
  avec le serveur (`chat/chatContract.ts`, `chat/chatSchemas.ts`).

## Les extraits de code des pages

Une page d'apprentissage ne recopie jamais de code : elle CITE des régions
`// #region <nom>` … `// #endregion` des vrais fichiers
(`frontend/src/chat/lessonSteps.ts`), lus par Vite au build. Renommer ou vider
une région citée fait échouer le test du module — mettre à jour la liste dans
le même geste.

## Ajouter une démo

1. Une entrée dans `DEMOS` (`demos.ts`), `status: "soon"` tant qu'elle n'a pas
   de page — la carte s'affiche grisée « Démo à venir ».
2. Son contrôleur sous `/demo/<id>` : `npx nodefony create controller <nom>
   --module <%= it.pkgName %>` (ajouter `--kind realtime` pour une socket).
3. Sa page, ses régions citées, puis `status: "ready"`, `path`, `files`,
   `types`, `doc`, `command`, `skill` — le test vérifie aussitôt chaque renvoi.

## Décisions figées

- **Préfixe `/demo`** pour tout : aucune zone de l'application n'est touchée,
  et retirer la démo = supprimer ce dossier + sa ligne du manifeste.
- **La démo ne part pas en production** (`policy: "dev"` au manifeste).
- **Lire est libre, écrire exige une session** ; l'auteur d'un message vient
  de `this.user`, jamais d'un champ envoyé par le client.
- **Aucun secret dans la page** : ni mot de passe de développement, ni lien
  vers la console d'administration, ni version du serveur.

## Interdits sans accord

- Modifier `rolldown.config.ts` / `tsconfig.json`.
- Ajouter une dépendance npm runtime sans en peser le coût.
- Allouer par requête ce qui ne sert qu'à une minorité de requêtes, ou
  attacher un écouteur sans prévoir son retrait.
