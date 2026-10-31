# Profil comparé — le coût d'une requête face à un témoin équitable

> Référence du skill `nodefony-load-test` (RÈGLE N°0). **Maintenance** : vérité courante, éditer
> en place ; l'historique vit dans `git log`.

**Première question de tout travail sur le coût du cycle de requête : « comparé à QUOI ? »**
Un profil de Nodefony SEUL dit « 13 % dans les en-têtes, 9 % dans les écouteurs » — jamais
« 37 µs de trop, et où ». Sans référence, chaque poste paraît structurel, on rabote 2 % ici, on
relance un audit là. C'est ce qui a coûté des mois d'audits multi-modèles par LECTURE de code :
le premier profil comparé a désigné en une heure ce qu'aucun n'avait chiffré (72 contre 35 µs/req,
~30 Promises par requête contre 3-5, un bus d'événements et une portée d'injection par requête,
un `writev` en deux morceaux).

```bash
bash .claude/skills/nodefony-load-test/scripts/profile-compare.sh            # témoin : nest-fair
bash .claude/skills/nodefony-load-test/scripts/profile-compare.sh express-fair
```

Il profile Nodefony ET le témoin dans le même décor (`profile-cpu.sh` : `--cpu-prof` sous `wrk`,
production, après chauffe, arrêt gracieux), puis `profile-compare.mjs` rend trois tableaux en
µs/req : le total et l'écart ; le travail de Node et du moteur **fonction à fonction** (mêmes
fonctions des deux côtés : on y voit ce que le framework FAIT FAIRE à Node — écouteurs,
micro-tâches, écritures) ; le code propre de chaque camp, côte à côte. Profils dans `tmp/profiles/`.

Les règles qui en découlent :

1. **Pas d'audit par lecture de code, pas de sous-agent sur la perf du pipeline, sans ce tableau
   en entrée.** L'audit vient APRÈS, pour expliquer les postes que l'écart désigne — une analyse
   statique oriente, elle ne prouve pas (mesuré : 8 ancrages faux ou glissés sur 22).
2. **Le témoin doit faire le MÊME travail** — `bench-frameworks/fair-parity.mjs` le prouve sur le
   fil AVANT. Un témoin qui travaille moins fabrique un écart qui n'existe pas (vécu : `express-fair`
   sans nonce CSP, avec ETag, CORS ouvert — l'écart publié ne comparait rien).
3. **Un levier de quelques µs se juge au PROFIL, pas au débit.** Sur cette machine, le débit varie
   de ±8 % d'une série à l'autre : un gain de 2-3 % y est indiscernable (vécu sur #505, L1). Le
   profil comparé, lui, montre le poste disparaître. Le débit en paires alternées reste l'arbitre
   des gros leviers (> 5 %).
4. **Deux profils pris à des heures différentes ne se comparent pas en absolu** (le témoin a varié
   de 34,5 à 39 µs/req d'un run à l'autre) : on compare l'ÉCART, pris dans le même run.
5. **Le RATIO d'UN profil comparé n'est pas un verdict non plus** : à décor et commit identiques,
   six passes alternées ont rendu de 111 à 133 % (et 149 % une heure plus tôt, machine plus
   froide). Un ratio isolé ne classe donc ni un commit ni une régression — vécu : « 102 % fin
   septembre, 149 % aujourd'hui » lu comme une régression, réfuté par la bissection, dont les
   deux bornes se sont rangées à l'envers (121 % au bon commit, 111 % au mauvais). Le profil
   NOMME les postes ; l'écart se CHIFFRE par `wait-compare.sh` (CPU du fil principal, paires
   alternées, dispersion < 1 %). `bisect-perf.sh` ne tranche que sur un saut de plus de
   ~25 points.

6. **Un démarrage de Nodefony sur trois environ tombe dans un régime GC DÉGRADÉ**, et y reste :
   le pretenuring de V8 bascule des sites d'allocation partagés pendant le renouvellement des
   connexions (chauffe puis mesure), tout le graphe de la requête part alors dans le vieux tas —
   +45 % de CPU par requête, 14-19 collectes complètes au lieu de 3. Deux runs « identiques » ne
   mesurent donc pas toujours le même régime : c'est une source de la dispersion entre séries.
   Le constater : `node --trace-gc-nvp …` et compter les `"gc":"mc"` sur la fenêtre (3 = normal) ;
   le prouver : `--no-allocation-site-pretenuring` le fait disparaître sans changer le coût
   normal. Ne pas comparer un run dégradé à un run normal.
7. **La ligne « GC µs/req » de `wait-compare` lit des durées `perf_hooks`, pas des pauses V8** :
   elle a annoncé ×34 face à Nest quand `--trace-gc-nvp` rendait des collectes jeunes
   équivalentes (0,15 µs/req des deux côtés). Le coût réel du GC se lit à `--trace-gc-nvp`
   (pauses, octets promus) et au CPU des fils `node-V8Worker` (`sample`).

## Ce que le profil ne voit pas — `wait-compare.sh` et `native-sample.mjs`

Le profil V8 échantillonne le JavaScript ; il ne dit ni si le process ATTEND, ni ce que coûtent
le C++ de Node, les builtins et le runtime V8. Mesuré sur #508 : il comptait ~36 µs/req là où le
fil principal en brûlait ~60–90, annonçait la parité d'une passe à l'autre puis 119 %, et
**sur-attribuait les petites fonctions d'un facteur ~15**. Conséquences :

- un levier de quelques µs se juge au **CPU du fil principal par requête** (`wait-compare.sh`,
  dispersion < 1 %), pas au profil ni au débit ;
- une famille native (builtins, chaînes, noyau…) se découpe par `native-sample.mjs` ;
- le profil garde un rôle : NOMMER la fonction JS — puis la convertir en ns par un micro-banc.
- les accès **mégamorphes** (coût diffus, invisible à un micro-banc monomorphe) se COMPTENT
  par `node --log-ic` puis `scripts/ic-sites.mjs <v8.log> [top] [filtre]` : sites basculés en `N`,
  rattachés au code par horodatage. Comptage, donc insensible au thermal ;
- une capture native dont le débit diverge entre runs (> 3 %) est REFUSÉE par `native-sample.mjs`
  (code 3) : un poste de 1–2 µs ne se lit pas dans ce bruit.
- un écart **DIFFUS** (aucun poste ne domine) se localise par **bissection par court-circuit** :
  `NF_WAIT_CUTS="entry context pipeline route action" wait-compare.sh` sert, dans chaque
  manche, Nodefony coupé à chaque étage (`cut-probe.mjs`, préchargé — rien dans le produit) ;
  `cut-analyze.mjs` rend le coût de chaque étage = différence de deux coupes voisines DANS la
  manche, « BRUIT » si les manches ne s'accordent pas sur le signe, code 3 si une coupe
  disperse > 3 %.

Mode d'emploi, lecture de chaque ligne et pièges : [`catalogue.md`](catalogue.md)
§ « Mesurer ce que le profil ne voit pas ».
