# AGENTS.md — les phrases qui font foi

> Citations relevées sur <https://agents.md> et le dépôt `agentsmd/agents.md`, au commit
> `d001185d792eb6402a58e4cbef1c228b309ec25d`. Le texte du site vit dans des composants React
> (`components/*Section.tsx`) : le figer reviendrait à embarquer du code tiers sous nos propres
> contrôles de style, pour du balisage sans valeur normative. Ce sont donc les PHRASES qui sont
> figées ici, et `check-amont.mjs` dit quand les fichiers suivis ont bougé.

## Gouvernance

> « AGENTS.md is now stewarded by the Agentic AI Foundation (AAIF) under the Linux Foundation. »

Don du **2025-12-09** par OpenAI et Anthropic, à la création de l'AAIF, avec **MCP** et **goose**.
Membres platine : AWS, Anthropic, Block, Bloomberg, Cloudflare, Google, Microsoft, OpenAI.

> « AGENTS.md emerged from collaborative efforts across the AI software development ecosystem,
> including OpenAI Codex, Amp, Jules from Google, Cursor, and Factory. »

## Ce que la convention DIT

> « The closest AGENTS.md to the edited file wins; explicit user chat prompts override everything. »

> « Agents automatically read the nearest file in the directory tree. »

> « AGENTS.md is just standard Markdown. »

## Ce que la convention NE DIT PAS — et c'est ce qui décide d'une conception

- **Aucun mécanisme d'inclusion ni d'import.** Un fichier d'annexe n'est chargé par personne ;
  seul un agent qui décide de l'ouvrir le lit. Contrôle : `rg -i 'include|import' README.md` → `0`.
- **Aucun schéma, aucune version, aucune taille.** Les plafonds sont posés par les ÉDITEURS, pas
  par la convention — et le plus contraignant est muet : OpenAI Codex concatène les `AGENTS.md` de
  la racine au répertoire courant et tronque à **32 KiB** (`project_doc_max_bytes`) sans le dire.
  Cursor recommande < 500 lignes, Claude Code < 200.
- **Aucun dossier.** `.agents/` n'appartient pas à cette convention : ce sont deux propositions
  tierces et concurrentes (`bgreenwell/dotagents`, brouillon ; `agentsfolder/spec`, 5 ★), sans
  implémentation. Ne pas confondre avec `.agents/skills/`, racine de fait des *Agent Skills*, que
  le produit constate client par client dans `src/nodefony/src/cli/aiSyncReport.ts`.
