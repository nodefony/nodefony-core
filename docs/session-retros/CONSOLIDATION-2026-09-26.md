# Consolidation retex — 2026-09-26 — 26 retex (09-24 → 09-26g)

## Patterns récurrents détectés

| Pattern                                                                    | Occurrences | Impact                                                          |
| -------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------- |
| Un thème du sas devenu FOURRE-TOUT (🎯 : 54 puces sous un seul titre)      | 1 thème     | seuil de graduation (~5) muet pendant 8 sessions ; sas à 730 l. |
| Vert valable sur UN décor (moteur, thème, backend, mode)                   | 10          | défauts vus en production, dont deux issus de mes correctifs    |
| Automate d'édition non borné ou non relu (`--fix`, applicateurs, `sed`)    | 9           | fichiers hors sujet, typage cassé, appels WS effacés            |
| Gate qui ne prouve rien (tolérance, skip vert, option non exécutée)        | 10          | vert certifiant ce qu'il ne voit pas                            |
| Écart jugé hors de son régime (thermal, batterie, microbench, froid/chaud) | 7           | chiffres publiés puis retirés                                   |

## Fait

- **10 familles graduées** (table dans `RETEX.md`, § « Gradué aux CONSOLIDATE ») : une mémoire neuve
  `feedback_green_holds_for_its_decor`, huit sections versées dans les `feedback_*` porteuses.
- **Sas** : ~730 → 442 lignes ; snapshot `archive/RETEX-snapshot-2026-09-26.md`.
- **26 retex archivés** (`git mv`) ; la copie complétée du 09-24b remplace son ancienne version.
- **Porteurs** (`lessons-carriers --write`) : 129 leçons — 8 PRODUIT, 39 DÉPÔT, 82 CONTEXTE, 0 INERTE,
  aucune ancre morte. **Specs figées** (`refs:check`) : à jour.

## Plan d'action (qualité IA) — sur accord

1. **Contrôle de taille PAR THÈME dans `session:end`** : signaler un thème qui dépasse ~5 frictions
   au moment où on y verse — le seuil global (lignes du sas) n'a pas vu le fourre-tout. Porteur
   automate d'une règle aujourd'hui CONTEXTE.
2. **Rien d'autre à créer** : aucune des familles n'appelle un skill ; leurs porteurs possibles
   (job `test-decors`, gate de parité, `verify-generated --database`) existent déjà — c'est leur
   LANCEMENT qui a manqué, cf [[feedback_gate_must_run]].
