<!-- @if core,npm -->
<div align="center">

<img src="docs/assets/nodefony-logo.png" alt="Nodefony" height="96">

# Nodefony

**Le framework Node.js fullstack : temps réel natif, développement agentic-ready, sur un socle TypeScript isomorphe.**

_Une action de contrôleur. Deux transports. La même session, la même sécurité, le même code._

[![Licence Apache 2.0](https://img.shields.io/badge/licence-Apache--2.0-blue.svg?style=flat-square)](LICENSE.txt)
[![Node ≥ 24.14](https://img.shields.io/badge/Node.js-%E2%89%A5%2024.14-green?style=flat-square)](package.json)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square)](tsconfig.json)
[![ESM](https://img.shields.io/badge/ESM-only-orange?style=flat-square)](package.json)

**[📖 Documentation](https://nodefony.github.io/nodefony-core/docs/)** · [Par où commencer](https://nodefony.github.io/nodefony-core/docs/demarrer/) · [Application de démonstration](https://github.com/nodefony/nodefony)

</div>

---

> **A note on language.** Nodefony is written by a French-speaking author. The **code** —
> identifiers, public API, types — is in English, because it travels: npm, editor autocompletion,
> search. The **prose** — documentation, agent skills, messages — is in French, the language in
> which the author explains the _why_ most precisely. Coding agents read it without difficulty;
> human readers may not, and translating the framework's texts is planned
> ([#378](https://github.com/nodefony/nodefony-core/issues/378)).
<!-- @end -->

<!-- @if core -->
> **Et NestJS ?** Nodefony en partage le modèle — injection, décorateurs, modules — et s'en inspire
> volontiers. Ses priorités portent ailleurs : une même route sert HTTP et WebSocket, avec la même
> session et le même pare-feu ; et l'application est pensée pour être lue par un agent de code —
> générateurs pilotables, catalogue, `AGENTS.md` dérivé du projet. Deux frameworks, deux accents :
> le bon choix dépend de ce que ton projet met en avant.

**État** — version `10.0.0` · **préversion `10.0.0-beta.6` en ligne**, sous le canal `beta`
uniquement : `npm install nodefony` sert toujours la `7.0.2` (JavaScript), et le fera jusqu'à la
sortie stable · branche par défaut `main` (dernière publication), développement sur `dev` · ~7 700 tests quand toute
l'infrastructure répond (`npm run test:all`).

> ⚠️ **Ce dépôt est l'atelier du framework, pas ce qu'une application installe** — agent : [`AGENTS.md`](AGENTS.md).
> Pour juger le produit, lire une application générée ([`github.com/nodefony/nodefony`](https://github.com/nodefony/nodefony),
> sortie brute de `create app`) ou en générer une : `npm create nodefony@beta <app>`.
<!-- @end -->

<!-- @if npm -->
> **Ce paquet est le CŒUR du framework** — noyau, injection de dépendances, modules, journalisation,
> interface en ligne de commande, client temps réel et codec CBOR. Il s'installe rarement seul : une
> application le reçoit par `npm create nodefony@beta`, et les autres paquets (`@nodefony/http`,
> `@nodefony/framework`, `@nodefony/security`…) le déclarent en dépendance de pair.

```bash
npm install nodefony@beta
```

> Le dist-tag est OBLIGATOIRE tant que la série 10 est en préversion : `latest` sert encore la
> `7.0.2`, écrite en JavaScript, dont l'API n'a aucun rapport avec ce qui suit.
<!-- @end -->

<!-- @if core,npm -->
---
<!-- @end -->

<!-- @if app -->
<div align="center">

<a href="https://github.com/nodefony/nodefony-core"><img src="https://raw.githubusercontent.com/nodefony/nodefony-core/main/docs/assets/nodefony-logo.png" alt="Nodefony" height="72"></a>

# <%= it.appName %><% /* GÉNÉRÉ par scripts/generate/readmes.mjs (dépôt nodefony-core) — la source est scripts/generate/readme/ */ %>

<% if (it.complete) { %>**HTTP et WebSocket dans le même contrôleur, une base qui persiste, un pare-feu
applicatif et une console d'administration** — engendrée par
[`nodefony create app`](https://github.com/nodefony/nodefony-core), câblée et prête à tourner.
<% } else { %>Le socle serveur et le routeur<% if (it.front) { %>, avec un frontend <%= it.frontend %> servi par Vite<% } %> — engendrée par
[`nodefony create app`](https://github.com/nodefony/nodefony-core), minimale et saine, à faire grandir.
<% } %>
[![Nodefony](https://img.shields.io/badge/Nodefony-<%= it.nodefonyVersion.replace(/-/g, "--") %>-1f6feb?style=flat-square)](https://github.com/nodefony/nodefony-core)
[![Node ≥ 24.14](https://img.shields.io/badge/Node.js-%E2%89%A5%2024.14-green?style=flat-square)](package.json)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square)](tsconfig.json)

**[📖 Documentation](https://nodefony.github.io/nodefony-core/docs/)** · [Par où commencer](https://nodefony.github.io/nodefony-core/docs/demarrer/) · [Le framework](https://github.com/nodefony/nodefony-core)

</div>
<!-- @end -->
