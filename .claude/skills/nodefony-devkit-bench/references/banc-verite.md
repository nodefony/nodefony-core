# Banc de vérité — le code généré tient-il debout ?

> Référence du skill `nodefony-devkit-bench`, chargée **avant de lancer ce banc** : le script rend
> un chiffre, c'est le protocole qui en fait une mesure. Déclencheurs : « j'ai modifié le scaffold », « le code généré compile-t-il ? », « est-ce que create entity marche encore ? ».
>
> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.

```bash
node .claude/skills/nodefony-devkit-bench/scripts/verify-generated.mjs
node .claude/skills/nodefony-devkit-bench/scripts/verify-generated.mjs --no-e2e  # plus rapide
node .claude/skills/nodefony-devkit-bench/scripts/verify-generated.mjs --keep    # garder le décor
node .claude/skills/nodefony-devkit-bench/scripts/verify-generated.mjs --link    # boucle courte, verdict amputé
node .claude/skills/nodefony-devkit-bench/scripts/verify-generated.mjs --database postgres  # le MÊME banc, un autre moteur
```

### Les trois moteurs — une application PAR moteur, jamais une variable

`--database <sqlite|postgres|mysql|mariadb>` change le moteur de l'application
témoin, et il faut bien qu'il la RECRÉE : le dialecte est une décision prise à
la création, les entités sont écrites pour lui (`createXTable("postgres")`), et
l'ORM refuse de démarrer sur un autre en nommant l'entité fautive. Pointer une
application SQLite vers un serveur PostgreSQL n'éprouve donc rien — c'est
pourquoi `NF_E2E_DATABASE_URL` ne suffit pas, et pourquoi la forge lance trois
passes plutôt qu'une matrice de variables.

Ce que cela a déjà trouvé, et qu'aucune passe SQLite ne pouvait voir : un
échantillon de clé étrangère écrit en TEXTE (`author-1`) face à une colonne
`uuid` — chaque POST rendait 500 en PostgreSQL, pendant que SQLite, où un `uuid`
et un texte sont le MÊME type, restait vert de bout en bout.

**Le décor, sur un moteur serveur : TROIS bases, et c'est structurel.** Une
suite de tests ne fabrique pas sa base — `CREATE DATABASE` est un privilège
d'administration que l'utilisateur applicatif n'a pas (constaté sur MySQL :
`GRANT ALL ON <base>.*` et rien d'autre). Le décor les fournit, ici comme dans
le compose que le générateur écrit :

| Base              | Rôle                                                            |
| ----------------- | --------------------------------------------------------------- |
| `app`             | le développement — celle que le `.env` généré joint             |
| `app_e2e`         | la suite e2e, jamais celle du développement                     |
| `app_e2e_scratch` | la base VIERGE de la suite de migrations (salie, remise à zéro) |

Les noms se dérivent une seule fois (`resolveDatabase`, `engine.ts`) ; le
serveur doit porter le rôle `app` / `app-dev`. À la forge, le job `dialectes`
de `scaffold.yml` les crée ; en local, une fois pour toutes sur le conteneur du
compose. Sans elles, l'étape e2e tombe en nommant la base absente.

**Prérequis : le checkout est BÂTI** (`npm run build`). Les tarballs sont
fabriqués depuis le `dist/` local : le banc éprouve ce que tu viens de compiler,
mais **tel qu'un installeur le reçoit**.

> **Il tourne tout seul à la forge, sur les TROIS systèmes** —
> `.github/workflows/scaffold.yml`, matrice `ubuntu · macos · windows` sur le
> plancher `engines` (Node 24, la version que pose la CI générée pour
> l'application de l'utilisateur), plus une variante haute sur ubuntu. Le lancer
> à la main sert à la boucle courte et au diagnostic, plus à obtenir le verdict :
> il arrive à chaque poussée. **Ce que ce job n'éprouve pas** est nommé dans
> [`docs/guides/integration-continue.md`](../../../../docs/guides/integration-continue.md)
> § 6 : le front d'une application générée, et les dialectes autres que SQLite.

> **Un job rouge doit se diagnostiquer SANS remonter le décor** — il pèse
> ~300 Mo et la machine qui l'a produit est jetée à la fin du job. Ce qui part
> en objet déposé (`if: failure()`) : le journal du banc, `report.json`,
> `echec.log` (la sortie ENTIÈRE de la commande tombée), le journal du serveur
> détaché de l'application témoin, l'état de son manifeste — et, sur les
> moteurs serveur, le **journal des conteneurs de base**. Ce dernier n'est pas
> un supplément : la cause d'un échec PostgreSQL tenait en une ligne côté
> serveur, que le banc ne pouvait pas voir depuis son client.
>
> Et l'extrait affiché dans le journal du job n'est plus « la fin de la
> sortie ». Une commande qui échoue derrière une barre de progression noyait sa
> propre cause : les derniers caractères ne portaient que
> `[⣷] 0 views fetching`. `scripts/lib/extrait-echec.mjs` déplie les réécritures de
> ligne, retire l'ANSI, garde les lignes qui NOMMENT l'échec **en plus** de la
> queue, et DIT combien de lignes il écarte — un extrait muet se lit comme une
> sortie complète. Son auto-contrôle rejoue l'ancienne règle sur les sorties
> réelles qui ont produit le défaut.

> **Le décor de ce banc est ISOLÉ, et ce n'est pas un détail d'exécution.**
> Longtemps il vivait sous le dépôt, paquets liés au checkout — la résolution de
> modules de Node remontait alors jusqu'aux `node_modules` du monorepo, et
> l'application témoin trouvait des paquets **qu'elle ne déclare pas**. Mesuré :
> l'étape production restait verte avec ET sans `@node-rs/argon2`, pendant qu'une
> application réellement installée mourait au boot sur cette dépendance. Ce n'est
> pas un cas particulier mais une **famille entière** — toute dépendance absente
> du gabarit était indétectable ici. Le décor sort donc du dépôt et s'installe
> depuis les tarballs (`scripts/lib/isolation.mjs`, partagé avec le banc de
> découvrabilité), et l'isolation est **constatée** avant la première mesure.
> `--link` reste pour la boucle courte : le rapport enregistre alors le décor
> (`decor`) et l'étape production ne vaut plus preuve.

Les étapes, dans l'ordre, et ce que chacune protège :

1. **décor** — application témoin isolée (hors dépôt, tarballs dépaquetés),
   isolation constatée, ports dédiés ;
2. **service + commande** — `create service`, la méthode d'exemple **remplacée**
   (le geste que le gabarit réclame), puis `create command --service` : la
   commande doit appeler la méthode NOUVELLE, et le service être enregistré ;
3. **génération** — cinq entités qui exercent toute la grammaire (unique,
   énumération avec défaut, entier avec défaut, index simple et composite,
   unicité composite, tailles de colonne, relation), dont deux émises pour
   PostgreSQL ;
4. **module** — `create module` : workspace npm, manifeste, entité déposée
   dedans (ce qu'il tient comme PAQUET est jugé plus loin, après le build) ;
5. **compilation** — l'étape qui manquait : un type faux ne se voit pas dans une
   assertion de chaîne ;
6. **le code des `AGENTS.md` compile** — les expressions citées dans les
   documents que l'agent lit d'office sont replacées dans leur classe de base
   et soumises au compilateur : un exemple faux AGIT (`this.context.cspNonce`
   sans le `?.` a été recopié à la lettre par trois agents, typecheck rouge
   3/3) ;
7. **lint du code généré** — un avertissement n'est ni une erreur de type ni une
   chaîne absente : rien d'autre ne le voit. La grille du dépôt est COPIÉE dans
   l'app (les motifs d'exclusion se résolvent depuis le dossier de la config —
   le `tmp/**` du dépôt écartait tout le décor lié, et l'étape rendait vert sans
   rien lire). L'étape se prouve d'abord sur un témoin fautif, puis juge ;
8. **décâblage** — les entités PostgreSQL quittent le manifeste : leur schéma
   enregistré sur un connecteur SQLite ferait échouer le boot, et cet échec ne
   dirait rien du générateur. Leurs fichiers restent — c'est leur type qu'on lit ;
9. **cohérence FK ↔ PK** — une colonne de référence doit avoir le type de la clé
   visée, sinon la jointure est refusée par le moteur ;
10. **build** — le runtime charge le `dist/` : sans lui, une entité neuve est
    invisible du serveur (cause n°1 des « ma route répond 404 ») ;
11. **le module généré tient debout comme un PAQUET** — il compile avec SON
    tsconfig (témoin fautif d'abord : un typecheck qui ne lit rien rend vert),
    ses tests passent, ses types se résolvent depuis l'APPLICATION, et une clé
    de configuration mal orthographiée est REFUSÉE. Ce dernier point a trouvé un
    défaut de produit : le gabarit levait une `Error` ordinaire, absorbée par le
    fail-soft du kernel — `use("@app/blog", { gretting: … })` laissait
    l'application démarrer en IGNORANT ce qui avait été écrit ;
12. **la commande s'exécute** — elle est lancée pour de vrai, et sa SORTIE est
    lue ;
13. **tests générés** — couche donnée ;
14. **HTTP réel** — 201 + `Location`, 422, 409 sur doublon, page `hasNext`,
    PATCH, 204 puis 404 ; et, pour la liste, les deux faces de chaque
    capacité : le **refus** (tri hors allowlist, paramètre inconnu, valeur mal
    formée) **et l'effet** (le tri ordonne, le filtre filtre) — voir l'encadré
    ci-dessous, un `ORDER BY` mort passait les refus sans broncher ;
15. **production** — l'app démarre dans le mode qu'aucune autre étape n'exerce,
    et sert DEUX routes : celle de l'application et celle d'un MODULE — un module
    qui se charge sans monter ses routes rendait 404 sans un mot ;
16. **inspection** — l'application se laisse lire sans ouvrir de port.

> **Le trou n'était pas dans le banc d'agent, il était ici.** Sur les sept types
> de `create`, ce script n'en exerçait que trois — `app`, `module`, `entity` ;
> `controller` l'est indirectement (`create module --controller rest`), mais
> `service`, `command` et `front` : rien. Or sa raison d'être est « le code
> généré tient debout », et c'est exactement par là qu'un défaut est passé :
> `create command --service` **exigeait la méthode `greet()` du gabarit**, que ce
> même gabarit dit de remplacer — suivre le conseil cassait la commande, sur un
> message qui réclamait une méthode d'exemple. D'où l'étape 2, qui fait le geste
> réclamé avant de générer. **Reste `front`, non couvert** (il tirerait un
> écosystème Vite complet dans le décor).
>
> **Et l'étape 12 juge la SORTIE, pas le code de retour** : le gabarit journalise
> « service non enregistré » puis rend la main NORMALEMENT. Vérifié en
> débranchant `@services([…])` — la commande sort **0** sans écrire une ligne de
> JSON. Un banc qui aurait lu le code de retour aurait été vert sur une
> application dont le service n'existe pour personne.

> **Prouver un REFUS ne prouve pas la CAPACITÉ — ce sont deux tests.** La suite
> générée éprouvait « un tri sur un champ non déclaré est refusé » et « une
> valeur de filtre mal formée est refusée », et s'arrêtait là. Un `ORDER BY`
> mort passe ces deux-là sans broncher : mesuré en débranchant le tri dans le
> décor, le test de refus est resté **vert**. D'où deux assertions de plus, et
> la façon de les écrire, qui n'est pas évidente :
>
> - **le tri** se lit en trois affirmations, pas une — le champ est PRÉSENT
>   dans la réponse (sinon on ordonne des `undefined`, qui forment une suite
>   parfaitement triée dans les deux sens — vécu sur une autre suite), ses
>   valeurs sont DISTINCTES (une colonne constante rend « trié » l'ordre que la
>   base a choisi seule), et `DESC` est l'inverse EXACT d'`ASC` sur une page qui
>   contient tout (`hasNext === false`, sinon les deux sens portent sur des
>   ensembles différents) ;
> - **le filtre** exige une ligne TÉMOIN qui ne matche pas. Sans elle,
>   « toutes les lignes rendues portent la valeur demandée » reste vrai avec le
>   filtre débranché, puisque tous les échantillons portent la même valeur.
>   C'est le témoin qui fait le test, pas l'assertion.
>
> Les deux ne sont donc émis que si l'entité s'y prête (`filterProbe`,
> `malformedProbe`, `sortProbe` — moteur) : un booléen ou une énumération à deux
> valeurs offrent un contraire, un filtre `"string"` ne refuse RIEN. Viser
> aveuglément le premier filtre déclaré faisait exiger le refus d'une valeur
> valide sur toute entité dont le seul filtre est une clé étrangère textuelle —
> le banc mettait alors en défaut le générateur au lieu de l'éprouver.

> **Une sonde de type doit porter sur un moteur qui DISTINGUE les types.** La
> cohérence FK ↔ PK a d'abord été écrite sur les entités SQLite du banc, et elle
> passait quel que soit le générateur : en SQLite, une clé `uuid` et une colonne
> texte sont le **même** type. La sonde ne pouvait rien voir. D'où les deux
> entités PostgreSQL — aucune base n'est requise, Drizzle déclare ces types sans
> se connecter. C'est la preuve négative qui l'a révélé, pas la relecture.

Le décor est **conservé** quand une étape échoue (le chemin est affiché) : la
première chose à faire est d'y entrer et de rejouer la commande fautive à la
