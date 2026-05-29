---
title: "RETEX — POC MCP vs Skill : qui Claude appelle-t-il spontanément ?"
type: retex / décision
audience: [ai, human]
status: closed (pari invalidé, branche supprimée)
date: 2026-05-27
tags: [ia, mcp, skill, claude-code, poc, decision]
---

# RETEX — POC MCP vs Skill : le « pari fondamental » du docs-server

> **Verdict en une ligne : ÉCHEC.** Claude Code **n'appelle pas spontanément** un tool MCP
> à description neutre quand un _skill_ auto-déclenché couvre le même besoin. Le skill gagne
> systématiquement. La branche `poc/mcp-spontaneous-test` (jetable) a été supprimée après ce
> retex — sa mémoire est ici.

## 1. L'hypothèse testée (le pari)

Une **seule** question, isolée sur une branche jetable : Claude Code **invoque-t-il de
lui-même** un tool MCP quand on lui pose une question pertinente, **sans qu'aucun `CLAUDE.md`
ni skill ne l'y pousse** ?

C'est le pari qui validait ou tuait le projet d'un `@nodefony/mcp` **docs-server** (servir la
documentation du framework à Claude Code en _lazy pull_ via MCP plutôt que via des skills).

- Si **oui** → MCP tient sa promesse de canal de doc à la demande → on engageait le kit complet.
- Si **non** → MCP serait, dans ce contexte, un « skill déguisé » → on reste sur skills minces.

## 2. Le dispositif (conçu pour ne pas tricher)

- **Un seul tool** exposé : `get_doc(module, topic) → markdown`, via un serveur MCP stdio
  (`@modelcontextprotocol/sdk`), déclaré dans `.mcp.json` à la racine.
- **Description volontairement neutre** (« _Retrieve Nodefony framework documentation… use
  this to look up signatures, recipes, conventions before implementing…_ ») — **pas** de
  formule directive type « TOUJOURS appeler en premier ». Décrire l'utilité, rien de plus :
  c'était le critère du test.
- **Aucune mention** de `get_doc` dans `CLAUDE.md` (racine/modules) ni dans les skills.
  Sinon Claude aurait appelé le tool parce qu'on le lui a dit — pas parce qu'il l'a découvert.
- Questions cibles : « _Comment je crée un controller dans Nodefony ?_ », « _les décorateurs
  DI ?_ ».

## 3. Le résultat — ÉCHEC

- Sur les 2 questions, Claude **n'a jamais** appelé `mcp__nodefony-poc__get_doc`.
- Le skill `nodefony-framework-dev` (auto-déclenché par mots-clés « controller », « décorateur »…)
  a **systématiquement** pris la main.
- Cause technique aggravante : le tool MCP était en mode **`deferred`** dans le harness Claude
  Code → **seul son nom était visible**, pas sa description. Un tool dont la description n'est
  pas chargée ne peut pas « se vendre » au modèle ; il faut une recherche explicite pour le
  matérialiser.

## 4. La décision

**Pari invalidé** pour cet usage : MCP **ne fonctionne pas** comme un canal de documentation
en _lazy pull spontané_ dans Claude Code, **en concurrence avec un skill auto-déclenché**.

- **Alternative retenue** : _skills minces_ + `Read docs/recipes/*.md`. Le skill
  `nodefony-framework-dev` (~1500 lignes) prouve qu'un skill auto-trigger sert très bien la
  doc — sans MCP. Coût zéro tant qu'il ne se déclenche pas.
- **Ne pas relancer** ce POC docs-server en l'état.

## 5. Portée exacte de l'échec (ne PAS sur-généraliser)

Cet échec tue **un seul usage** : _« MCP comme distributeur de doc interne pour Claude Code,
face à un skill »_. Il **ne tue pas** MCP comme **standard d'interopérabilité agentique** :

- Exposer les services d'une **application Nodefony** comme **serveur MCP** (pour que des
  clients externes — Claude Desktop, autres agents — s'y connectent) reste pertinent.
- Consommer des serveurs MCP **externes** depuis un agent Nodefony reste pertinent.

Ces deux usages relèvent du module framework `@nodefony/mcp` (cf. livre blanc §6.1 _standards
agentiques_ et §6.6 _auto-développement_) — un **autre besoin** que le docs-server testé ici.
La leçon : **le déclenchement** d'un tool MCP par un LLM dépend de la visibilité de sa
description et de la concurrence avec d'autres surfaces (skills) — à concevoir explicitement,
ne jamais présumer la découverte spontanée.

## Annexe — archi figée du docs-server (si MCP est relancé un jour)

Conservée comme référence d'architecture (utile dans un **autre** contexte : serveur
multi-clients, vrai _vector search_). **Pas un plan d'action** — le POC est clos.

- **Entrypoint** : `src/packages/@nodefony/mcp/bin/mcp` (compilé Rollup, pattern de
  `src/nodefony/bin/nodefony`) ; `package.json` → `"bin": { "nodefony-mcp": "bin/mcp" }` ;
  `.mcp.json` racine → `node ./src/packages/@nodefony/mcp/bin/mcp`.
- **Règle absolue stdio** : `stdout` = JSON-RPC **uniquement**. Tout log → `stderr` ou ring
  buffer Syslog. `Cli("nodefony-mcp", { autoLogger:false, asciify:false, clear:false,
resize:false, signals:true, autostart:false })`. Un seul `console.log` corrompt le protocole.
- **5 tools** (descriptions = critère n°1 de déclenchement) : `list_modules`, `list_topics`,
  `get_doc`, `search_docs` (keyword phase 1, sémantique phase 2 via `ILLMProvider.embed` +
  `IVectorStore`), `add_note` (enrichissement auto : gotchas/bugs/décisions).
- **Docs colocalisées (ADR-0001)** : `src/.../<module>/docs/mcp/`, scannées par un
  `docs-loader` (glob). Versioning par `NODEFONY_DOCS_VERSION` + sous-dossiers `v1/`.
- **Deux responsabilités distinctes dans le même package** : `docs-server/` = outil de dev
  (servir la doc à Claude Code — l'usage **invalidé** ici) ; `MCPServer.ts` / `MCPClient.ts`
  = module framework P12.3 (exposer/consommer MCP pour les apps Nodefony — **toujours valide**).

## Liens

- Patterns agentiques de référence : [`agents-anthropic-building-effective-agents.md`](agents-anthropic-building-effective-agents.md).
- Vision IA (MCP, standards, auto-développement) : [`livre-blanc-couche-ia.md`](livre-blanc-couche-ia.md).
