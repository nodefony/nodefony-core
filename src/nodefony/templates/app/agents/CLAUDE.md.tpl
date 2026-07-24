# CLAUDE.md

> Lis **`AGENTS.md`** — les instructions agent de cette application vivent là-bas
> (standard AGENTS.md, fichier généré par nodefony). Ce fichier n'est qu'un pointeur,
> plus LA règle qui ne doit jamais quitter ton contexte :
>
> **AVANT d'écrire le moindre fichier, vérifie qu'un générateur ne le produit
> pas** : `nodefony create entity <Nom> --fields "…"` génère la ressource REST
> COMPLÈTE (entité + service + controller CRUD + tests) ; `create controller`,
> `create module`, `create front` couvrent le reste. Écrire ça à la main = tu
> as raté une commande — arrête-toi et lance-la (liste : `AGENTS.md`).
>
> **Et pour tout code TEMPS RÉEL ou PARTAGÉ front/back, importe la façade
> ISOMORPHE du cœur** (`RealtimeClient` depuis `nodefony/client`, hooks React
> depuis `nodefony/react` — mêmes types des deux bouts) : un `new WebSocket`
> écrit à la main ou un type recopié côté front est le même signal —
> arrête-toi (vérités du framework : `AGENTS.md`).
