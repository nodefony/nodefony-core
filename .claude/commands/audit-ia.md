# /audit-ia

Lis VISION_IA.md, CLAUDE_IA.md, IA_STATUS.md.

Audit la qualité des modules IA déjà présents dans src/packages/@nodefony/ :

Pour chaque module marqué ✅ dans IA_STATUS.md, vérifie :

1. **TypeScript strict**
   - bunx tsc --noEmit doit passer sans erreur
   - Aucun `any` dans le code
   - Aucun `@ts-ignore` ou `@ts-expect-error`

2. **Sécurité mémoire**
   - shutdown() existe et clean les Sets/Maps/Timers
   - Tests vérifient le cleanup (afterEach)
   - try/finally autour des reader.releaseLock()
   - clearTimeout/clearInterval dans finally

3. **Tests**
   - Couverture des cas d'erreur
   - Tests de shutdown / idempotence
   - bun test passe

4. **Sécurité d'entrée**
   - Validation des limites (maxLength, max())
   - Whitelist des énumérations
   - Sanitization des identifiants SQL si applicable

Génère un rapport AUDIT_IA.md avec :
- Module : ✅ Conforme / ⚠️ À corriger
- Liste des problèmes trouvés
- Recommandations

Ne corrige rien — juste audit.
