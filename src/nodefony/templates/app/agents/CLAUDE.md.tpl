# CLAUDE.md

> Lis **`AGENTS.md`** — les instructions agent de cette application vivent là-bas
> (standard AGENTS.md, fichier généré par nodefony). Ce fichier n'est qu'un
> pointeur, plus les trois réflexes qui ne doivent jamais quitter ton contexte.
>
> **1 · Tu vas créer un fichier ? Un générateur le produit sûrement.**
> `nodefony create --help` liste ceux de CETTE version — ne te fie pas à ta
> mémoire, la liste s'allonge. Ces dossiers ne s'écrivent JAMAIS à la main :
> `nodefony/entity/`, `nodefony/controllers/`, `nodefony/service/`,
> `nodefony/command/`, et un module entier. Si tu t'apprêtes à y déposer un
> fichier, tu as raté une commande : arrête-toi et lance-la. Chaque générateur
> accepte `--dry-run` (plan et diffs, zéro écriture) — regarde avant d'écrire.
>
> **2 · Tu vas toucher à la configuration ? Demande, ne déduis pas.**
> `nodefony env` donne la valeur EFFECTIVE de chaque variable et sa PROVENANCE ;
> `nodefony inspect config --json` fait de même pour la config des modules. Lire
> les `.env` à la main ne dit ni laquelle gagne, ni laquelle est ignorée parce
> qu'elle est mal orthographiée. Lance-la AVANT de modifier, et RELANCE-la après
> pour prouver que ta modification a pris.
>
> **3 · Tu vas démarrer ou arrêter le serveur ? Le framework s'en charge.**
> `npm run dev` démarre, `nodefony status` dit ce qui tourne et sur quels ports,
> `nodefony stop` arrête proprement. N'arrête JAMAIS par le port ni par le PID
> (`lsof`, `kill`, `pkill`) : le superviseur relance ce que tu tues, et un
> serveur survivant garde les ports — la course suivante échoue sur une erreur
> qui ne parle jamais de lui. Arrête ce que tu démarres.
>
> **4 · Temps réel ou code partagé front/back : passe par la façade isomorphe.**
> `RealtimeClient` depuis `nodefony/client`, hooks React depuis `nodefony/react`
> — mêmes types des deux bouts. Un `new WebSocket` écrit à la main ou un type
> recopié côté front est le même signal : arrête-toi (vérités du framework :
> `AGENTS.md`).
