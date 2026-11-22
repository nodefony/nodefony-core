<!-- @if core,npm -->
<div align="center">

<img src="docs/assets/nodefony-logo.png" alt="Nodefony" height="96">

# Nodefony

**Le framework Node.js fullstack : temps réel natif, développement agentic-ready, sur un socle TypeScript isomorphe.**

_Une action de contrôleur. Deux transports. La même session, la même sécurité, le même code._

[![Licence Apache 2.0](https://img.shields.io/badge/licence-Apache--2.0-blue.svg?style=flat-square)](LICENSE.txt)
[![Node 24.16+ ou 26+](https://img.shields.io/badge/Node.js-24.16%2B%20%7C%2026%2B-green?style=flat-square)](package.json)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square)](tsconfig.json)
[![ESM](https://img.shields.io/badge/ESM-only-orange?style=flat-square)](package.json)

**[📖 Documentation](https://nodefony.net/docs/)** · [Par où commencer](https://nodefony.net/docs/demarrer/) · [Application de démonstration](https://github.com/nodefony/nodefony)

</div>

---
<!-- @end -->

<!-- @if npm -->
> **This package, `nodefony`, is the core of Nodefony:** modules, dependency injection, validated
> configuration, structured logging, the command line and the realtime client with its CBOR codec.
>
<!-- @end -->
<!-- @if core,npm -->
> **Nodefony** is a fullstack Node.js framework written in strict TypeScript (ESM, Node 24.16+ or
> 26+). One controller action serves HTTP and WebSocket with the same session and the same
> security. Realtime runs JSON-RPC 2.0 over WebSocket, in JSON or in binary
> [CBOR](https://nodefony.net/docs/modules/core/cbor/) (RFC 8949), negotiated per connection.
> [gRPC](https://nodefony.net/docs/modules/framework/grpc/), gRPC-Web and Connect services are
> served by the same HTTP/2 pipeline (experimental in 10.0). Each module can expose tools to AI
> agents through a [Model Context Protocol (MCP)](https://nodefony.net/docs/modules/ai/mcp/) gate,
> over HTTP streaming (SSE) or stdio.
>
> ```bash
> npm create nodefony my-app
> ```
>
> [Website](https://nodefony.net/) · [Get started](https://nodefony.net/docs/demarrer/) ·
> [CBOR](https://nodefony.net/docs/modules/core/cbor/) ·
> [gRPC](https://nodefony.net/docs/modules/framework/grpc/) ·
> [MCP](https://nodefony.net/docs/modules/ai/mcp/)

---
<!-- @end -->

<!-- @if core -->
> [!IMPORTANT]
> **Nodefony 10 est sorti** — réécrit en TypeScript, publié sous le canal `latest` :
>
> ```bash
> npm create nodefony mon-app
> ```
>
> Développement sur `dev`, dernière publication sur `main` — plus de 19 000 tests quand toute
> l'infrastructure répond (`npm run test:all`).
<!-- @end -->

<!-- @if core,npm -->
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

> ⚠️ **Ce dépôt est l'atelier du framework, pas ce qu'une application installe** — agent : [`AGENTS.md`](AGENTS.md).
> Pour juger le produit, lire une application générée ([`github.com/nodefony/nodefony`](https://github.com/nodefony/nodefony),
> sortie brute de `create app`) ou en générer une : `npm create nodefony <app>`.
<!-- @end -->

<!-- @if npm -->
> **Ce paquet est le CŒUR du framework** — noyau, injection de dépendances, modules, journalisation,
> interface en ligne de commande, client temps réel et codec CBOR. Il s'installe rarement seul : une
> application le reçoit par `npm create nodefony`, et les autres paquets (`@nodefony/http`,
> `@nodefony/framework`, `@nodefony/security`…) le déclarent en dépendance de pair.

```bash
npm install nodefony
```

> La série 7, écrite en JavaScript, n'a aucun rapport d'API avec ce qui suit.
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
[![Node 24.16+ ou 26+](https://img.shields.io/badge/Node.js-24.16%2B%20%7C%2026%2B-green?style=flat-square)](package.json)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square)](tsconfig.json)

**[📖 Documentation](https://nodefony.net/docs/)** · [Par où commencer](https://nodefony.net/docs/demarrer/) · [Le framework](https://github.com/nodefony/nodefony-core)

</div>
<!-- @end -->
