# /audit — Audit initial du repo
Lis CLAUDE.md et MIGRATION_STATUS.md.
Analyse le dossier nodefony/ et src/ de ce repo.
Analyse aussi ../nodefony/src/nodefony/ (repo JS référence).

Génère un rapport dans MIGRATION_STATUS.md avec :
1. Statut réel de chaque fichier (✅ 🔶 ⬜ 🚫)
2. Dettes techniques détectées avec leur impact
3. Ordre de migration recommandé (dépendances entre modules)
4. Estimation de complexité par module (1=simple, 3=complexe)

Ne pas toucher au code — audit uniquement.
Mettre à jour les compteurs du tableau de progression.
