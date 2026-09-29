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

## Ce que le profil ne voit pas — `wait-compare.sh` et `native-sample.mjs`

Le profil V8 échantillonne le JavaScript ; il ne dit ni si le process ATTEND, ni
ce que coûtent le C++ de Node, les builtins et le runtime V8 hors fonction nommée.
Mesuré sur #508 : il comptait ~36 µs/req là où le fil principal en brûlait ~60–90,
annonçait la parité d'une passe à l'autre puis 119 %, et **sur-attribuait les
petites fonctions d'un facteur ~15** (8,5 µs prêtés au traitement du `Host`, 0,5 µs
au micro-banc). Deux instruments complètent :

```bash
S=.claude/skills/nodefony-load-test/scripts
bash $S/wait-compare.sh nest-fair 3                    # sonde wait-probe.mjs, paires alternées
NF_NATIVE_SAMPLE=1 NF_WAIT_DIR=tmp/wait-native bash $S/wait-compare.sh nest-fair 2
node $S/native-sample.mjs <capA> <rpsA> <capB> <rpsB>  # écart par famille native, puis par frame
```

- **`wait-compare.sh`** (+ `wait-probe.mjs`, `wait-analyze.mjs`) : ELU, CPU du FIL
  principal contre process, GC, tours libuv, écritures socket, changements de
  contexte — ramenés à la requête. Le **CPU du fil par requête** a une dispersion
  < 1 % (résolution ~0,7 µs) : c'est l'arbitre A/B d'un levier de quelques µs, bien
  plus fin que le débit (±8 %) et que le profil.
- **`native-sample.mjs`** relit `sample` (macOS, sans root) : toute la pile du fil
  principal, par famille (JIT, builtins, chaînes, runtime, noyau, parseur, GC).
  Les frames JIT sont anonymes : pour NOMMER la fonction JS, revenir au profil,
  puis **convertir en ns par un micro-banc** avant d'y croire.
- `sample` suspend le fil à chaque relevé : le débit du run baisse, également pour
  les deux camps — il ATTRIBUE, il ne chiffre pas.
