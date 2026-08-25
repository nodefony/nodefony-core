# Repères empiriques — pour situer un résultat

> Chiffres de référence (loopback, machine 32 GB) déjà mesurés avec le protocole de ce skill.
> Renvoyé depuis `SKILL.md` § Niveau 2 : utile pour juger si UN résultat neuf est dans l'ordre
> de grandeur attendu, pas pour republier ces chiffres tels quels sur une autre machine.
>
> **Maintenance** : édition en place. Un repère qui se périme se corrige ici, il ne s'annote pas.

## Repères empiriques (loopback, machine 32 GB) — pour situer un résultat

- **Connexions** : rupture **16 372** simultanées (re-validé 2026-05-21, plage 49152–65535
  = 16384 ports − quelques occupés). Épuisement des ports éphémères loopback, PAS les fd ni
  la RAM ; en réseau réel (IP clientes distinctes) ça remonte. Cleanup propre, 0 leak.
  ⚠️ **Sous-batcher l'ouverture** (`BATCH=50`) pour lire ce plafond : ouvrir des centaines de
  connects d'un coup échoue côté CLIENT (TLS loopback dual-stack) et **sous-estime** (mesuré
  4741 sans sous-batch vs 16372 avec). Le script `ws-connections.mjs` ET la sonde vitest
  `RUPTURE` le font ; lever `NF_WS_RUPTURE_CAP=20000` pour que la sonde atteigne le vrai plafond.
- **Messages** : echo 1 conn ~7 200 msg/s ; broadcast fan-out propre jusqu'à ~**40k msg/s**,
  sature vers ~**120k msg/s** (le serveur bufferise, ne crash pas).
- **Stress combiné supervision (2026-05-23, ORM_PATH=counts)** : sous `WS_STEP=400 HTTP_STEP=80
ORM_STEP=4` (≈ 4000 WS + counts qui wedgent la boucle), mesuré **CPU 100 %, ELU 100 % (idle 0),
  event-loop 500-600 ms, flux ORM ~180k req comptées**. ⚠️ **Le serveur NE TOMBE PAS** : il a répondu
  HTTP **200 en ~5,3 s** (vs ~240 ms à vide) — il **dégrade la latence mais sert toujours, 0 crash, 0 % err**.
  C'est la thèse confirmée : sous charge, le **différenciateur (realtime) meurt en premier** par famine
  event-loop, pas le service HTTP. **Indice de santé** = « Dégradé » (saturation planchée), PAS « Critique »
  (réservé aux pannes : erreurs, connecteur coupé, heap proche OOM). Cf [[project_realtime_granularity_clientlib]]
  (cadence adaptative AIMD = la suite). heap/rss gonflés PENDANT le stress (WS tenues) = normal, PAS une fuite
  (vérifier le reclaim APRÈS drain, pas pendant).
- Détails + historique : mémoire IA `project_ws_stress_studio_lag`.
