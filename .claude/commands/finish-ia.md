# /finish-ia [module-name]

Lis VISION_IA.md, CLAUDE_IA.md et IA_STATUS.md.

Module à compléter : $ARGUMENTS

Suis exactement les instructions de IA_STATUS.md pour ce module.
Respecte les conventions de CLAUDE_IA.md.

À la fin :
1. Vérifie : bunx tsc --noEmit (zéro erreur)
2. Vérifie : bun test src/packages/@nodefony/[module] (tout passe)
3. Mets à jour IA_STATUS.md (statut du module passé à ✅)
4. Propose un commit message au format : "feat(ia): implement @nodefony/[module]"

Critique pour la qualité :
- Zéro any, zéro @ts-ignore
- shutdown() qui clean toutes les ressources
- afterEach dans les tests appelle shutdown()
- AbortController + try/finally pour cleanup
- Validation Zod sur tous les inputs externes
- Limites strictes (maxQueueSize, maxTokens, etc.)
