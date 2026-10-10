---
adr: 15
title: Page de connexion — servie par le framework, un balisage, un moteur partagé
lang: fr
navTitle: Page de connexion
date: 2026-10-10
status: proposed
deciders: [Christophe CAMENSULI]
tags: [security, login, session, oauth, design, frontend]
---

# ADR-0015 — Page de connexion : servie par le framework, un balisage, un moteur partagé

📍 [Documentation](../index.md) › [Décisions d'architecture](README.md) › **ADR-0015**

## Statut

Proposé (2026-10-10), issu d'une revue d'architecture de tout le système de connexion menée
avant [#547](https://github.com/nodefony/nodefony-core/issues/547). Encadre #547 (page
`/login`), #548 (anonyme conduit à la page puis ramené), #549 (Studio sur le déroulé partagé).
S'appuie sur le déroulé navigateur `NodefonyLogin` livré par #546.

## Contexte

Une application qui charge `@nodefony/security` n'avait aucune page de connexion, alors que
le framework y renvoie par défaut (redirection d'échec OAuth vers `/login`). Aujourd'hui,
deux moteurs de connexion coexistent (celui de Studio et `NodefonyLogin`) et six habillages
(Studio, quatre gabarits d'application, thème Keycloak), chacun avec ses couleurs recopiées.

Ce qui part dans la 10.0 sera garanti toute la série majeure : noms d'exports, clés de
configuration, chemins de routes, contrat HTTP du second facteur. La revue a donc cherché ce
qui, décidé maintenant, évite une refonte plus tard — y compris pour des cas de connexion qui
n'existent pas encore.

## Décision

1. **La page est servie par le framework, sans front.** Rendu serveur (Eta) plus un script
   autonome sur `NodefonyLogin` (`nodefony/login.js`), servi depuis la même origine. Elle
   marche avec React, Vue, Svelte, Angular ou aucun front ; les fronts n'ajoutent qu'un bouton
   « Se connecter » vers `/login?from=…`. Une application qui veut sa propre page pose
   `loginPage.enabled: false` et utilise `useNodefonyLogin` (ou équivalent).
2. **Le contrôleur vit dans framework, la configuration dans security**, reliés par une
   méthode optionnelle du service `authFlow` (`describeLoginPage()`) : framework n'importe
   jamais security, et une version de security qui ne l'expose pas encore rend un 404.
3. **Un seul chemin.** `LOGIN_PAGE_PATH` (`/login`) est écrit au cœur ; la redirection
   d'échec d'un fournisseur et la redirection après déconnexion fédérée **suivent**
   `loginPage.path` au lieu de garder leur propre littéral.
4. **Un balisage, des variables.** La page ne change jamais de structure ; l'habillage passe
   par des variables `--nf-login-*` et un mode de mise en page (`card`, `split`, `bare`), un
   gabarit `.eta` de l'application en dernier recours. C'est ce qui permettra de proposer des
   thèmes au choix (Studio) sans qu'une mise à jour écrase l'application. Les couleurs de
   marque ont **une** source au cœur, contrôlée par un test contre Studio, le thème Keycloak
   et les gabarits.
5. **Retour sur la page d'origine par `?from=`**, sous une garde UNIQUE
   (`safeRedirectPath`, au cœur, isomorphe) : seul un chemin local est suivi. Le même
   paramètre traverse la connexion par fournisseur (gardé en session, purgé au retour).
6. **Les routes de connexion restent soumises au contrôle de provenance.** Être exemptée de
   l'authentification (`bypassFirewall`) ne dispense plus de la défense CSRF d'origine ; seul
   `@CsrfExempt` en dispense (`6d29d0ce8`).
7. **La session retient quand et comment elle a été ouverte** (heure de l'authentification,
   facteurs utilisés). C'est la seule décision NON additive de la revue : sans elle, la
   ré-authentification avant une action sensible, le second facteur imposé par politique et
   l'enrôlement forcé exigeraient plus tard d'invalider les sessions existantes.
8. **Le second facteur est un ensemble ouvert.** La réponse « défi » (`202`) porte une liste
   de méthodes non fermée ; un client qui ne connaît pas une méthode la classe en erreur
   serveur au lieu de casser. Passkey en second facteur, code par courriel ou SMS s'ajoutent
   sans rupture.
9. **Redirection directe vers un fournisseur** seulement quand il est le seul, qu'il est
   opérationnel, qu'aucun mot de passe local n'est proposé et que la page n'affiche pas déjà
   un échec (anti-boucle).
10. **La page n'est jamais mise en cache** et ne s'affiche pas dans le cadre d'un autre site.
11. **Les règles de connexion de Studio passent dans le moteur partagé, son affichage reste
    à Studio.** La console garde sa page (`/nodefony/login`, rendu Mantine, indicateur de
    progression, icônes de marques). Trois comportements qu'elle portait seule deviennent des
    règles de `NodefonyLogin`, donc communes à la page `/login` et aux fronts générés :
    le **« rebonjour »** (dernier compte et dernière méthode retenus ; un compte venu d'un
    fournisseur ne se voit jamais proposer de mot de passe), la **lecture du motif de retour**
    d'un fournisseur (une annulation n'est pas une panne), et la **reconnexion de la socket**
    une fois connecté, pour que le temps réel reparte avec la bonne identité. Ajouts sans
    rupture du moteur ; sans eux, chaque écran les recoderait et les règles divergeraient.

## Conséquences

- Une seule connexion à maintenir à terme : #549 fait passer Studio sur `NodefonyLogin`.
- Les habillages deviennent des données (variables + mode), donc des thèmes possibles.
- Le chemin `/login` change d'un seul endroit ; les redirections ne peuvent plus diverger.
- Les cas futurs restent additifs : liaison de comptes, lien par courriel, inscription,
  mot de passe oublié, appareil mémorisé, autorisation d'appareil, agents et délégation.
- Coût : une entrée de bundle au cœur (`login.js`) et une feuille (`login.css`) publiées dans
  `exports`, donc garanties toute la série.

## Alternatives écartées

- **Réutiliser la page de Studio** : elle tire Mantine, MobX et le routeur React ; la page la
  plus sensible chargerait le plus gros bundle, et imposerait React aux applications Vue ou
  Angular.
- **Une page générée par front** : quatre implémentations du même écran, qui divergent.
- **Détecter une route `/login` déjà déclarée par l'application** : inutile, la route de
  l'application passe toujours avant celle du framework ; `enabled: false` dit la même chose
  explicitement.
- **Un script en ligne signé par nonce** : non cacheable, et lié à la politique de contenu de
  chaque application ; un fichier de même origine satisfait la politique stricte sans nonce.

## Design

Maquettes et choix dans [`docs/design/login/`](../design/login/README.md). Retenu pour la
beta 3 : **F03 « Frontispice »**.
