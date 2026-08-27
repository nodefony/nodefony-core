# RETEX.md — digest des retours d'expérience (SAS, lu à chaque début de session)

> **Rôle** : sas entre les retex bruts (`docs/session-retros/archive/<date>-<id>.md`, jamais relus
> seuls) et les leçons durables (mémoires `feedback_*` indexées dans `MEMORY.md`). Il porte les
> **frictions récentes pas encore confirmées**. Le skill `nodefony-session` le **lit au START/RESUME**
> et le **met à jour au END** (3-5 bullets du jour, par thème).
>
> **Règle anti-doublon (CRITIQUE)** : une leçon est **soit** ici (sas), **soit** en `feedback_*`
> (graduée). **JAMAIS les deux.**
>
> **🔴 SEUIL DE GRADUATION — il porte sur le THÈME, pas sur le compteur d'un bullet.** Un thème qui
> atteint **~5 frictions distinctes** est démontré et part en `feedback_*`, puis disparaît d'ici.
> Le compteur `[N×]` ne sert qu'à repérer une friction qui se répète à l'identique — il ne
> déclenche rien. _Pourquoi ce changement (2026-08-02) : l'ancienne règle « ≥3× » n'a JAMAIS
> déclenché en 135 frictions — chaque session écrivait un bullet neuf au lieu d'incrémenter, si
> bien qu'un thème à 35 frictions en dix jours n'a jamais été gradué._
>
> **Taille bornée : ~1 écran.** Snapshots complets avant coupe :
> `archive/RETEX-snapshot-<date>.md` — rien n'est perdu.

---

## ⚙️ Réutiliser du code d'un SCRIPT, c'est le RELANCER

- **Importer `test-all.ts` pour une seule fonction relançait l'infra, le build et la batterie
  entière.** Un script n'est pas une bibliothèque : son corps s'exécute à l'import. Ce qu'on veut
  partager se SORT du script d'abord (`scripts/lib/docker.ts`), sinon « réutiliser » veut dire
  « relancer ». Le symptôme était visible — `npm run coverage` affichait la bannière de la batterie
  de tests — mais il aurait pu ne pas l'être. [1× — 08-26]
- **Poser la variable d'un service ABSENT ne rend pas les tests skippés : elle les fait ÉCHOUER.**
  `NF_LOKI_TEST_URL` posée sans Loki → 4 tests du cœur rouges, module entier sans rapport, et le
  rouge imputé au produit. Un banc qui n'a personne au bout de son URL ne se tait pas, il tombe.
  Constater la santé du conteneur AVANT de poser quoi que ce soit. [1× — 08-26]

## 🧪 Un test qui ne parle jamais au serveur — et celui qui passe débranché

- **Un gabarit vérifié par `assert.include` sur son TEXTE rendu ne prouve rien de son comportement** [1× — 08-27] : la seule preuve du fournisseur React était qu'une chaîne figurait dans un fichier généré. Le monter pour de vrai (jsdom) et compter les connexions ouvertes a demandé une devDep, et c'est ce qui a révélé que le contrat tenait. Le même angle mort avait laissé publier un contrat que rien n'implémentait, le matin même.

- [1× — 08-23d] **`savepoint()` est un NO-OP chez Mongoose** (MongoDB n'a pas de
  savepoints). Un banc de coupure copié de drizzle l'utilisait pour « sonder » le
  serveur : il ne lui parlait JAMAIS et serait passé au vert sur une base éteinte. Avant
  d'utiliser une méthode de contrat comme SONDE, vérifier qu'elle fait une E/S sur CE
  dialecte.
- [1× — 08-23d] **Un test de bascule de primaire passait même en débranchant
  l'idempotence** qu'il prétendait éprouver : Mongoose dédoublonne en amont (son
  `readyState` n'émet que sur changement). Le débranchement est le SEUL révélateur ; sans
  lui, on publie un test complaisant en croyant avoir prouvé.
- **J'ai pollué ma propre mesure en travaillant pendant qu'elle courait.** Soak de 90 min annoncé
  « poste inutilisable » — puis j'ai commité, poussé, régénéré des fiches et interrogé la forge
  pendant les mesures. Le banc l'a relevé tout seul : « charge montée à 8,05 (départ 1,65) — un
  tiers a travaillé pendant la mesure ». Un décor partagé **ne dégrade pas** une mesure : il en
  change l'objet. Ce qui survit malgré tout (un heap plat ne se fabrique pas par pollution CPU) se
  garde ; le chiffre de pente, lui, se rejoue. [1× — 08-26]

## 🩺 Une correction qui ne couvre qu'un cas, présentée comme complète

- [1× — 08-27] **`gh issue create` fait la MOITIÉ du travail et rend un succès.** L'issue est
  créée, elle n'entre PAS au tableau de bord — donc dans aucun compteur d'avancement, ni ordre de
  travail, ni reste-à-faire, ni empreinte hors ligne. Le ticket ouvert ainsi est resté invisible du
  pilotage jusqu'à un contrôle manuel. Un oubli qui ne crie pas coûte plus cher qu'une erreur : on
  ne le cherche pas.

- **Dégraisser un fichier casse ses LECTEURS, et aucun ne se plaint.** Après avoir sorti 113
  lignes de `MIGRATION_STATUS.md` : le comptage du skill d'audit rendait `✅=0` (il lisait le seul
  fichier vivant), une ancre `fichier:ligne` écrite deux heures plus tôt pointait une phrase sans
  rapport, et huit règles disséminées affirmaient encore « l'avancement = ce fichier ». Aucune
  barrière ne l'a signalé — `anchor-check` ne mord que sur fichier absent ou ligne hors fichier.
  Avant de retirer d'une source, chercher qui la LIT : `rg --hidden` sur son nom, et exécuter les
  recettes qui la parcourent. [1× — 08-27]

- [1× — 08-25] **CodeQL n'a signalé QU'UN des trois frères.** L'alerte visait
  `generate-man.mjs` ; le même `existsSync(f) ? readFileSync(f) : …` vivait aussi dans
  `aiMcp.ts` — où le test préalable court-circuitait un `catch` qui distinguait pourtant DÉJÀ
  « illisible » d'« absent » — et dans `security-secrets.ts`, où une 4ᵉ copie ignorait le
  `lireSiPresentSync` de son PROPRE paquet. Un `rg` sur le MOTIF (pas sur le fichier signalé)
  les rend en une seconde ; l'analyseur montre ce qu'il atteint, jamais ce qui existe.

- **L'analyseur n'a signalé qu'UN des deux frères.** CodeQL pointait `MD_LINK` ; `JSON_HREF`, deux
  lignes plus bas, portait le MÊME motif quadratique sans être vu. Un outil montre ce qu'il atteint,
  pas ce qui existe — après chaque alerte, chercher le frère. `[1× — 08-25]`
- **Deux sites du même motif dans le fichier signalé.** L'alerte donnait `security-token.ts:250` ;
  le second `existsSync ? read : ""` (l.191) n'y figurait pas. `[1× — 08-25]`

- [1× — 08-25] **« Les handles trancheront » — non.** Un signal ASYMÉTRIQUE ne tranche que dans un
  sens : des ressources qui s'accumulent désignent un défaut, mais un compte stable n'explique
  RIEN — il retire un suspect sur quatre. Je l'ai présenté comme la mesure décisive alors qu'elle
  ne répondait même pas à la question posée (« palier ou hausse sans fin ? »), à laquelle seule la
  DURÉE répond. Le user a relevé en trois mots. Avant d'annoncer qu'une mesure tranchera, se
  demander ce que son résultat NÉGATIF prouverait.

- [1× — 08-25] **QUATRE défauts d'une même session étaient la MÊME faute : une règle appliquée à un
  seul frère.** Le gate Redis renommé d'un côté et pas dans le workflow ; `attendreServeur` écrit
  pour PostgreSQL quand le bloc MySQL relançait son conteneur sans attendre ; `NF_GATES_ALLOW` posé
  sur un step et pas sur son voisin ; `premierMessage` durci pour la deuxième attente d'un test
  pendant que `consumeHandshake`, dix lignes plus haut, restait un `once("message")` nu. Chaque fois
  le dépôt PORTAIT déjà la leçon — souvent avec le commentaire qui la raconte juste à côté. Le geste
  qui manque n'est pas « corriger » mais **« chercher les frères AVANT de commiter »** : `rg` sur le
  motif corrigé, pas sur le fichier. Coût mesuré : deux allers-retours de forge, dont un où le rouge
  suivant était MASQUÉ par celui que je venais de fermer (steps séquentiels d'un même job).
- [1× — 08-25] **Le dépôt possédait la réponse, le banc la redevinait — 2× dans la même nuit.** Un
  banc tuait son serveur par `process.kill(-pid)` (groupe de process : n'existe pas sous Windows,
  l'appel LÈVE et le `catch` le lit « déjà mort ») alors que `signalProcessGroup` est publiée par le
  cœur et utilisée par cinq sites du produit. Même motif que `besoinDeShell` la veille. **Avant
  d'écrire une primitive système dans un banc : chercher qui la porte déjà dans le barrel.**

- [1× — 08-25] **J'ai corrigé ma propre règle une heure après l'avoir écrite, et c'est la CI qui
  l'a trouvée.** « Un chemin absolu désigne un vrai exécutable, qui n'a besoin d'aucun shell » —
  une INFÉRENCE, pas un constat : `…\node_modules\.bin\oxlint.cmd` est parfaitement absolu et
  reste un script batch. Ce qui empêche Node de lancer une chose n'est pas l'ENDROIT où elle est,
  c'est ce qu'elle EST. Quand une règle de portabilité s'écrit, énumérer les formes, pas les
  emplacements.

- [1× — 08-23d] Détection de coupure câblée sur les événements de pool : ils ne voient
  que le client **INACTIF** (`pg-pool` retire son auditeur pendant l'usage). J'ai livré
  en annonçant le problème résolu ; c'est le user qui a douté, et il avait raison.
  **Avant d'annoncer une couverture, énumérer les cas et dire lesquels ne sont PAS
  couverts** — ici : coupure sous trafic, base gelée.
- [1× — 08-23d] Corollaire : **une sonde doit avoir sa propre montre**. Le premier
  battement de cœur était inopérant contre une base gelée — `ping()` PEND, et la sonde
  pendait avec la panne qu'elle devait observer.

- 🔴 **Un chiffre écrit EN DUR survit à la mesure qui le contredit — quatre fois dans une
  seule page.** Carte de tête annonçant le ratio d'un autre niveau · sous-titre d'une figure
  **contredisant les barres qu'il surmonte** (1,61/1,29/1,07 au-dessus de 1,42/1,09/1,07) ·
  avertissement « le comparatif reste à rejouer » alors qu'il venait de l'être · bandeau
  « BROUILLON » en tête d'une page qu'on s'apprêtait à lier depuis le README. Aucun n'était
  signalé par un test : ils se voient à l'ÉCRAN, et seulement là. Tout chiffre affiché se
  DÉRIVE de sa source. `[1× — 08-24]`
- **Un livrable annoncé en DEUX pièces livré en une** : j'avais dit « deux fichiers, deux
  publics », j'en ai publié un et clôturé. Le user a dû le relever. Annoncer un plan en N
  parties, c'est s'engager à recompter N à la livraison. `[1× — 08-24]`
- **Le banc nommait DEUX contournements dans son propre code, le produit n'en désamorçait qu'un.** Tâche 18 : le rôle recopié au semis est averti en toutes lettres dans le skill ; la liste de rôles sur l'action — celle que l'agent écrit réellement — ne l'était nulle part. Le gabarit MONTRE en plus la forme fautive, et elle fonctionne sur la route mesurée. Quand un code de banc énumère les façons de contourner, chacune est une ligne de doc à écrire. [1× — 08-25]
- **La règle existait, un cran plus bas.** La puce voisine du même fichier disait déjà « jamais la liste des routes du jour ; énumérer marche à l'essai, passe la revue, et laisse la route sœur NAÎTRE PUBLIQUE ». Écrite pour les routes, jamais pour les rôles. Chercher la convention-frère AVANT d'écrire une règle neuve. [1× — 08-25]
- **J'ai corrigé sur une cause PLAUSIBLE que je n'avais pas prouvée, et commité l'explication.**
  Un smoke rouge dont le message cherché figurait dans le diagnostic imprimé deux lignes plus bas :
  j'ai conclu « course de propagation de `docker logs` », ajouté une attente bornée, commité. Le
  rejeu suivant est retombé rouge — le message était là depuis dix secondes. La vraie cause était
  mécanique (`grep -q` sous `pipefail`). **Un rejeu VERT ne confirme pas une hypothèse : il ne fait
  que ne pas la contredire.** Le commit suivant a dû corriger le précédent. [1× — 08-26]
- **Le hook ne lançait qu'UNE des trois gardes que la forge lance.** `npm run skills:check` en
  compte trois ; le pre-commit n'avait branché que la première. Un script de skill orphelin passait
  donc en local pour se faire refuser vingt minutes plus tard en CI — l'aller-retour que ce hook
  existe pour supprimer. Coût de l'ensemble mesuré : **une seconde**. Il n'y avait aucun argument à
  l'asymétrie, seulement l'habitude d'avoir branché la première. [1× — 08-26]

## 🌍 Une portée GLOBALE n'est pas « un peu intrusive » — elle est FAUSSE

- **Le défaut était documenté au lieu d'être corrigé.** `ai:mcp` écrivait la porte MCP dans le
  foyer pour Vibe et Codex, et l'ANNONÇAIT : « deux applications Nodefony se disputent le même nom,
  la seconde efface la première sans un mot ». Or l'URL d'une porte porte un PORT : une déclaration
  globale ne peut désigner qu'UNE application — ce n'est pas un inconfort, c'est un résultat faux.
  Signal à reconnaître : **un commentaire qui décrit une collision au lieu de l'empêcher.**
  `[1× — 08-23c]`
- **Le dépôt contredisait sa propre commande, et c'est le dogfooding qui l'a montré** : un
  `.vibe/config.toml` COMMITÉ disait « jamais dans ~/.vibe » pendant que la commande y écrivait.
  Quand un fichier du dépôt argumente contre une de nos commandes, c'est la commande qui a tort.
  `[1× — 08-23c]`
- **Deux objections bloquaient, une seule tenait.** « Écrire le format d'un tiers » : levée en
  redirigeant `VIBE_HOME`/`CODEX_HOME` sur le projet — c'est LEUR binaire qui écrit LEUR format.
  « Le fichier n'est lu que dans un dossier de confiance » : vraie, mais elle se RETOURNE — un
  fichier non lu est inerte, une déclaration globale fausse est active. **Entre échouer en silence
  et réussir à côté, choisir le premier.** `[1× — 08-23c]`
- **Rediriger le home d'un agent y fait déposer ses fichiers de TRAVAIL** (`trusted_folders.toml`,
  `.codex/tmp/`). Un `.gitignore` qui ne versionne que la DÉCLARATION — dans le dépôt ET dans le
  gabarit d'app générée, sinon chaque app naît avec ces artefacts. `[1× — 08-23c]`

## 🎯 Un PORT qui répond ne dit pas À QUI — l'identité de la cible se PROUVE

- [1× — 08-27] **`-c core.hooksPath=.husky` a désarmé les hooks pendant deux commits, en silence.**
  Le dépôt utilise `.githooks` ; pointer un dossier VIDE ne produit aucune erreur — git n'exécute
  simplement rien. Ni prettier, ni oxlint, ni commitlint, ni le contrôle des fiches de skills. La
  forge serait sortie rouge sur quatre fichiers. Aucun message ne dit « ce chemin de hooks n'existe
  pas » : le succès et l'absence totale de contrôle sont indiscernables. Le nom mort venait d'un
  skill qui l'annonçait encore.

- **`nodefony check` accusait l'application témoin d'un défaut qui appartenait à MON poste** : deux
  manquements « le port 5151 est déjà tenu », parce que mon serveur de développement écoutait. Le
  banc frère posait des ports dédiés ; le mien, neuf, ne l'avait pas repris. Le verdict aurait été
  vert sur un runner — **une mesure qui dépend de ce qui tourne à côté ne mesure rien**, et elle ne
  le dit pas. [1× — 08-25]

- **Un run interrompu a empoisonné le suivant, et personne ne pouvait le voir.** Une passe arrêtée
  sur « l'agent n'a rendu aucun tour » a quitté sans éteindre son serveur ; le run d'après a trouvé
  ses ports dédiés pris, sa prémisse n'a donc jamais démarré le sien — et l'agent, le constat de
  porte et le juge des routes ont TOUS interrogé l'application du run précédent. Mêmes ports, même
  nom (`bench-app`) : aucun signal. Le seul verdict juste de la passe fut le rouge de
  `nodefony check` (« le port est tenu par un autre processus »), imputé à l'agent. Réflexe : avant
  de croire un port, demander à l'application sous test de se NOMMER — ici son `runtime.json`
  (`pid` + ports effectifs), local et gratuit. [1× — 08-23]
- **Un arrêt qui ne couvre pas les sorties d'URGENCE n'est pas un arrêt.** Celui du banc existait
  et nommait même le risque, mais il vivait après la boucle et ne valait qu'en régime `auth` — or
  une passe s'interrompt par `process.exit`, et une PRÉMISSE démarre l'application dans tous les
  régimes. Le nettoyage d'un décor s'arme sur `process.on("exit")` + signaux, jamais sur le seul
  chemin nominal. [1× — 08-23]

- 🔴 **Le DÉCOR d'une mesure ne vient pas de la machine qui l'AFFICHE.** Le générateur du
  rapport lisait Node et le nombre de cœurs sur la machine du RENDU (`process.version`,
  `sysctl`). En session, rendu et mesure ont lieu au même endroit : juste par COÏNCIDENCE, et
  rien ne pouvait le révéler. La première publication a rendu « **? cœurs logiques** » — et le
  cas dangereux est l'autre : un exécuteur qui répond attribue SES cœurs au banc, chiffre faux
  et crédible sur une page publique. Trouvé en comparant octet à octet la page SERVIE et la
  page bâtie. `[1× — 08-24]`
- **`os.tmpdir()` n'est PAS `/tmp` sous macOS** : c'est un dossier privé par utilisateur sous `/var/folders/…`. On cherchait dans `/tmp` (224 Ko) pendant que **13 Go** grossissaient à côté. Un outil qui agit sur un chemin doit l'ANNONCER, sinon l'appelant cherche ailleurs. [1× — 08-25]
- **Le verdict du gate se prend depuis SA cible** : il formate avec `cwd: dest` (le dossier de l'app générée). Reproduire la mesure ailleurs — même config, même version — rend un autre résultat, et on croit le sien. [1× — 08-25]

## 🧭 La doc qui AFFIRME une automatisation qui n'existe pas

- **La doc enseignait une URL qui n'est montée NULLE PART.** `client.md` et `react-hooks.md`
  ouvraient sur `RealtimeClient.shared({ url: "/nodefony/api/realtime" })` — aucune route ne sert
  cette adresse (Studio expose `/nodefony/studio/api/realtime`, l'app générée `/api/live/realtime`).
  Un débutant copiait l'exemple d'entrée et obtenait une socket qui ne se connecte jamais, **sans
  message** : l'échec est une tentative WebSocket qui retente en boucle. Trouvé en vérifiant une
  trouvaille de sous-agent qui ne visait que la valeur par défaut du code. [1× — 08-27]
- **Le §10.9 du plan de release — « ce qui bloque encore » — était périmé sur 4 de ses 5 items** :
  il annonçait bloquants le preset Svelte et devkit S1→S4 (livrés), deux rouges CI dont les
  workflows n'existent plus, et « la CI n'a jamais tourné sur un runner réel » (7/8 verts). Un
  document de pilotage qui ment envoie refaire du travail fini — c'est ce qui a déclenché tout
  l'audit du jour. [1× — 08-27]

- **Une mémoire m'a envoyé refaire une tâche déjà faite.** [2× — 08-27] (a) Un kit : « Publier
  docs/performance — dossier exhaustif PRÊT », alors que les dix pages étaient écrites, commitées
  et publiées sous `/performance/` depuis dix jours. (b) Un `_state` au RESUME : « PROCHAINE =
  merger `claude-ts` sur `main` » — `main`, `claude-ts` et `origin/main` pointaient déjà le MÊME
  commit, zéro écart ; restitué tel quel au user, qui a dû corriger. **Le garde-fou anti-`_state`
  périmé du skill `nodefony-session` ne couvre PAS ce cas** : il vérifie que le dernier commit
  figure bien dans `## Fait`, jamais que la PROCHAINE ÉTAPE reste à faire. **Un plan de mémoire
  n'est pas le terrain** — avant de restituer une prochaine étape, l'éprouver d'une commande
  (`git rev-parse main claude-ts`, `ls`, `git log -- <dossier>`).
- **Deux lignes du MÊME dashboard se contredisaient** : « RSS en PLATEAU ~244 MB » d'un côté,
  « AUCUN plateau » de l'autre. Personne ne lit un fichier de 900 lignes d'un bout à l'autre, donc
  la contradiction survit. Elle ne se voit qu'en cherchant le même FAIT à deux endroits. [1× — 08-26]
- **Mon propre outil renvoyait vers une section inexistante.** `npm run coverage` finissait par
  « Détail : docs/guides/integration-continue.md » — la page ne parlait pas de couverture. Un
  renvoi mort envoie chercher une explication qui n'existe pas : pire qu'aucun renvoi. [1× — 08-26]

- **Mon commentaire donnait un exemple d'attaque que je n'ai pas su reproduire.** J'avais écrit
  que `<<a>script>` redevient une balise après une passe ; testé, c'est faux. Ce qui protège
  vraiment était AILLEURS (`esc()` au rendu). Un commentaire qui invente sa justification est pire
  qu'un commentaire absent : il détourne le prochain lecteur de la vraie garde. `[1× — 08-25]`

- **« Ajouter un choix = ajouter UNE entrée ici ; aucun front n'est à modifier »** — vrai pour deux
  fronts sur trois. La voie FLAGS a une analyse écrite à la main : une question ajoutée y est servie
  à l'humain et REFUSÉE au script, sans un mot. J'ai cru l'en-tête et raté le drapeau. Une
  affirmation d'automatisation se vérifie avant d'être crue, et se corrige quand elle est fausse —
  ici par un gate qui refuse toute question qu'aucun drapeau ne sert. [1× — 08-22h]
- **Une doc dont tous les exemples passent par Docker fait prendre le chemin long.** Le skill
  navigateur disait « la voie locale d'abord » puis montrait dix `docker exec` : j'ai démarré un
  conteneur pour regarder une page locale, puis conclu à tort qu'un navigateur piloté était en
  panne (certificat de développement refusé). Ce que la doc MONTRE pèse plus que ce qu'elle dit.
  [1× — 08-22h]
- **Une doc périmée est lue comme la vérité par un tiers — et nous coûte plus que le défaut
  qu'elle décrit mal.** Un audit externe du dépôt a noté la sécurité 8/10 et l'a déclarée « pas
  terminée » : il avait lu le README de `@nodefony/security`, qui annonçait comme RESTANT deux
  briques livrées et câblées en production (voters d'autorisation, `@CsrfProtect`). Nous nous
  étions sous-notés nous-mêmes, dans une page publique. Deux autres du même lot : « TypeScript
  strict, zéro `any` » (3 casts + 128 `...args: any[]` en réalité) et un `MEMORY.md` de module qui
  contredisait le tableau de migration sur le RBAC. **Une promesse invérifiable se remplace par une
  promesse vérifiable** — « zéro `@ts-ignore` » se contrôle d'un `rg`, « zéro any » non. [1× — 08-26]

## ⏳ Un symptôme qui ressemble à un DÉLAI n'en est pas forcément un

- **« La commande meurt toute seule » n'était pas un timeout — il n'en existait aucun sur ce
  chemin.** Une question est une promesse en attente ; Node ne compte pas les promesses, il compte
  les HANDLES. Une commande qui boote a des dizaines de handles, donc sa question tient sans que
  personne n'y pense ; une commande standalone n'en a AUCUN, et le process sort au milieu de la
  question, code 0, sans erreur. Le user avait donné le discriminant sans le savoir : « sur le menu
  ça a l'air de tenir » — c'est exactement la frontière du fast-path. Réflexe à garder : quand un
  symptôme ressemble à un délai, chercher d'abord ce qui RETIENT le process, pas ce qui le tue.
  [1× — 08-22f]
- **Le défaut ne frappait que les commandes les plus SOIGNÉES.** Celles qu'on a travaillé à rendre
  rapides (zéro boot) sont précisément celles qui n'ont plus rien pour tenir. Une optimisation peut
  retirer un effet de bord dont personne n'avait noté qu'il servait de garde. [1× — 08-22f]

## 🚪 Une porte a plusieurs ENTRÉES — le défaut vit dans la COMPARAISON, pas dans chacune

- **« Présenter MAL valait moins que ne rien présenter », et aucun test ne pouvait le voir.** Sur
  la porte MCP, chaque entrée était éprouvée SÉPARÉMENT et chacune était juste : sans en-tête →
  200 + outils publics ✅ ; jeton invalide → 401 ✅ ; en-tête vide → 400 ✅. L'absurdité
  n'apparaît qu'en les METTANT CÔTE À CÔTE — un client qui tente de s'authentifier avec un jeton
  expiré obtenait MOINS que le même client muet, et un client MCP marque alors le serveur
  « failed » pour toute la session. Réflexe à prendre : pour toute porte à plusieurs entrées
  (anonyme / porteur / session / interne), écrire le TABLEAU de ce que chacune restitue, et
  chercher l'inversion. La conformité de chaque ligne ne dit rien de la cohérence de la colonne.
  [1× — 08-22g]
- **C'est le USER qui l'a trouvé, en s'en servant — et j'ai conclu deux fois avant de chercher.**
  D'abord « reconnecte », puis « c'est l'état de ton client » : deux réponses exactes (la porte
  répondait bien) et deux fois hors sujet, parce qu'aucune ne répondait à ce qu'il DEMANDAIT (« je
  veux des outils SANS authentification »). Il a fallu qu'il répète pour que je cherche le défaut
  de conception au lieu de défendre la mesure. ↝ [[feedback_user_repeats_question]] [1× — 08-22g]

## 🧭 Une garde ne couvre jamais une AUTRE question — même quand elle y ressemble

- **`--publish` forçait `--write` : deux gestes couplés qui ne devaient pas l'être.** Révélé en
  écrivant le workflow, qui serait tombé DÈS SA PREMIÈRE PASSE — sur le changelog, sans aucun
  rapport avec la publication. Préparer écrit et se relit ; publier part d'un tag et ne doit RIEN
  écrire. Écrire le second consommateur d'une API est ce qui montre ses couplages. `[1× — 08-25]`

- [1× — 08-25] **Mon banc de durée refusait de mesurer sans ramasse-miettes et sans charge — et
  acceptait sans broncher une machine PARTAGÉE.** Deux runs perdus le même jour : l'un tué par mes
  propres compilations (p99 × 12), l'autre faussé par une console d'administration ouverte dans un
  navigateur, qui tapait sur le serveur MESURÉ. Le tas s'est mis à monter de 13 MB/h alors qu'il
  est plat partout ailleurs — c'est-à-dire exactement la signature qu'on traquait : le décor a
  failli faire accuser le framework. Deux relevés gratuits manquaient : la charge machine, et le
  nombre de connexions (un banc en ouvre un nombre CONSTANT, donc toute connexion en plus est un
  intrus). **Une machine partagée ne rend pas une mesure moins bonne : elle rend une AUTRE mesure.**

- **La garde anti-abandon rendait NON JUGEABLE la tâche dont la bonne réponse est INVISIBLE au
  diff.** « Aucun fichier touché ⇒ abandon » est juste partout — sauf pour la tâche de
  configuration, qui se résout dans `.env.local`, **gitignoré par conception**. Un agent PARFAIT
  n'y touche aucun fichier suivi : deux passes écartées pendant que le juge d'état rendait exit 0.
  Le banc CONNAISSAIT le piège (son commentaire interdit toute sonde de diff sur cette tâche depuis
  longtemps) ; la garde, ajoutée plus tard **à un autre étage**, l'a réintroduit. L'exception se
  DÉCLARE sur la tâche, jamais en affaiblissant la garde pour tous. [1× — 08-24d]
- **Un `--dry-run` qui ne rend qu'un inventaire de fichiers n'est pas une simulation.** Les notes
  (table visée, connecteur, dialecte, routes) ne sortaient qu'en exécution RÉELLE ; l'agent à qui
  l'on demande un plan colle la sortie et ne peut pas nommer la base sur laquelle il travaille.
  Une simulation doit dire ce que la vraie commande dirait. [1× — 08-24d]

- **`grid.containLabel` d'ECharts contient les ÉTIQUETTES, pas les NOMS d'axes** — deux questions qui
  se ressemblent, une seule couverte. J'ai passé une itération à compenser par des marges calculées à
  la main, qui déplaçaient le défaut sans le corriger. La doc officielle le dit en une ligne
  (l'option est dépréciée en v6 et vaut `outerBoundsContain: 'axisLabel'`) ; le défaut de la v6
  couvre les deux. **Lire la doc de l'option AVANT de compenser son comportement.** [1× — 08-24]

- **`PACKAGE_NAME` bornait la traversée de chemin, pas le PÉRIMÈTRE.** Les deux gardes se
  ressemblent (« quel nom de paquet accepte-t-on ? ») et répondent à deux questions distinctes : la
  première empêche `../../etc`, la seconde décide ce qu'on a le DROIT de servir. Sans la seconde,
  la porte de documentation rendait les pages de n'importe quelle dépendance installée. [1× — 08-22f]
- **`requiresAuth` regardait comment l'identité est PROUVÉE, pas ce que l'appelant PEUT.** Une
  porte plus stricte en apparence cachait des données moins sensibles que celles qu'une autre
  rendait déjà au même appelant — et rendait la capacité inatteignable dans le mode nominal. [1× — 08-22f]

## 📐 Composer une assertion de chemin ne suffit pas — il faut composer avec la MÊME opération

- **La CI Windows était rouge sur deux tests qui SUIVAIENT pourtant l'axiome** (composés au
  `path.join`, jamais littéraux). Le code rendait un chemin ABSOLU (`path.resolve` → `D:\…`),
  l'attendu était seulement ENRACINÉ (`\…`). `resolve` d'un côté et `join` de l'autre ne décrivent
  pas le même chemin dès qu'une plateforme distingue les deux. Et mes tests du jour portaient le
  même défaut, non encore poussé. [1× — 08-22f]

## 🚧 Ajouter une EXIGENCE sans regarder qui PRODUIT l'artefact exigé

- **J'ai contredit une décision que le dépôt portait DÉJÀ, écrite dans un test, avec son
  motif.** Une mémoire listait « `verify` ignore les e2e » parmi les écarts de l'application
  générée ; je l'ai « corrigé ». Or `create.test.ts` exige l'inverse — « le gate LENT reste
  dehors : un `verify` qui boote l'app ne serait plus lancé, et on aurait remplacé quatre gates
  oubliés par un seul » — et la CI générée joue `test:e2e` SÉPARÉMENT, donc rien n'était oublié.
  Huit jobs rouges sur trois systèmes. Avant d'ajouter une exigence, chercher qui la porte déjà :
  un test qui l'INTERDIT est une décision, pas un oubli. Et une liste d'écarts héritée d'une
  session précédente se reconfronte au code avant d'être exécutée. [1× — 08-25]

- **J'ai posé `--deny-warnings` au gabarit de l'application sans regarder ce que le générateur
  ÉCRIT.** Le `vitest.config.ts` produit utilisait `Array#sort()` : toute application fraîchement
  générée aurait échoué à son PREMIER `npm run lint`, sur une porte que je venais d'ajouter pour
  l'aider. Invisible en relisant le gabarit — attrapé en lintant une app RÉELLEMENT générée avec ses
  propres règles. Une exigence neuve se mesure sur l'artefact reçu, jamais sur sa source.
  [1× — 08-25]

- **La porte s'est mise à exiger un scope ; la commande qui fabrique le jeton n'en demandait
  aucun.** `ai:mcp` enchaîne `security:token --write` (sans `--scope`) : le parcours nominal de
  l'utilisateur aurait produit un jeton refusé à la première lecture — un 401 remplacé par un 403,
  sans raison visible. C'est le **user** qui a demandé « le token mcp a des scopes par défaut ? ».
  Le geste manquant : quand on ajoute une condition d'accès, remonter la chaîne jusqu'à CE QUI
  fabrique l'artefact soumis à cette condition, et le vérifier en le LANÇANT. [1× — 08-22e]
- **Et l'exiger sans le PUBLIER, c'est exiger l'invisible** : le client suit le défi, lit le
  document de ressource, n'y voit aucun scope, obtient un jeton nu, se fait refuser — et n'a aucun
  moyen de savoir quoi demander. Une exigence neuve se publie dans le document que le refus
  désigne. [1× — 08-22e]

## ⏳ Un défaut « pratique » grave un pouvoir pour le jour où la distinction deviendra réelle

- **`admin:read admin:write` par défaut n'avait aucun effet** — le plan d'administration n'a qu'un
  rôle, les deux scopes ouvrent la même chose. Précisément pour ça, personne ne l'aurait remarqué ;
  et le jour où la séparation lecture/écriture deviendrait réelle, tous les jetons émis d'office
  porteraient le pouvoir d'écrire sans qu'aucune décision ne l'ait accordé. Un défaut se choisit sur
  ce qu'il vaudra APRÈS le durcissement prévu, pas sur ce qu'il vaut pendant qu'il est inerte —
  le plus étroit se durcit tout seul dans le bon sens. [1× — 08-22e]

## 🔑 Un secret écrit là où personne ne le lit — et la question « qui le lit ? » qu'on ne pose pas

- **Un jeton écrit SANS son mode : 0644, lisible par toute la machine.** Parti d'une alerte de
  RACE (`existsSync` puis `write`), j'ai trouvé pire à deux lignes. Et le remède existait DÉJÀ dans
  le paquet (`JwtKeystore` écrit sa clé en 0600) : une CLI en avait une version dégradée.
  Après chaque « on écrit quoi, où ? », poser « et qui a le droit de le LIRE ? ». `[1× — 08-25]`
- **Le fichier TEMPORAIRE porte le secret, et survivait à l'échec.** L'écriture atomique passe par
  `<f>.<pid>.tmp` puis `rename` ; si le `rename` lève, le tmp reste EN CLAIR sur le disque. On avait
  durci les permissions de la cible en laissant fuir le contenu à côté. Le cas est PROBABLE sous
  Windows (remplacer une cible ouverte y échoue, là où POSIX remplace) — et la cible est un `.env`
  que l'utilisateur a sous les yeux dans son éditeur. `[1× — 08-25]`

- **`--write` posait le jeton MCP dans `.env.local` : AUCUN code de l'application ne le lit.** Elle
  est le serveur de ressource, elle vérifie des jetons, elle n'en porte pas. Le consommateur — un
  agent — le cherchait ailleurs et recevait un 401 qui accusait le jeton. Une heure de diagnostic.
  `[1× — 08-22]`
- **La duplication ne survit pas à la ROTATION** : le fichier refusait d'être touché pendant que les
  agents auraient dû recevoir le neuf. La question de l'utilisateur — « pourquoi aussi dans
  `.env.local` ? » — valait mieux que ma conception. `[1× — 08-22]`
- **L'état de câblage n'a pas à être mémorisé : il EST dans les fichiers.** Un agent qui porte la
  clé a été câblé un jour ⇒ rotation muette. Un fichier d'état parallèle aurait menti à la première
  édition manuelle. `[1× — 08-22]`

## 🟢 Un test peut passer depuis TOUJOURS sans avoir jamais rien mesuré

- [1× — 08-27] **Un champ de pilotage rempli MÉCANIQUEMENT ressemble à un arbitrage.** La grappe
  #54 avait `ordre = numéro d'issue − 4` sur sept sous-tickets : le socle commun passait APRÈS les
  trois liaisons qui en dépendent, le ticket d'un AUTRE jalon ouvrait la marche, et celui que le
  parent désigne comme « le confort d'abord » finissait dernier. Rien ne criait, parce qu'un ordre
  faux est un ordre quand même. Le contrôle qui tranche en une seconde : **si les ordres vont dans
  le même sens que les numéros d'issue, personne n'a arbitré.**

- **Le premier instrument qui ACQUITTE à tort — pire que ceux qui accusent.** Le soak s'est
  arrêté à la 37ᵉ fenêtre d'un run de 180, est resté DEUX HEURES pendu, puis a rendu
  `verdict: "clean"`, exit 0. Son garde-fou de durée comparait à un plancher ABSOLU (10 min) et
  jamais à la durée DEMANDÉE : 15,7 min franchissaient le plancher. Un faux vert FERME la question
  au lieu de la poser — la traque RSS s'arrêtait là. `tronque` prime désormais sur tout, exit 2.
  [1× — 08-26]

- **`expect(...).toBeTruthy` sans les parenthèses ne s'exécute jamais.** Écrit dans MON test du
  jour ; il passait, évidemment. Une assertion qui n'appelle pas son matcher est une expression
  jetée. Remplacée par deux cas explicites, un par plateforme. `[1× — 08-25]`
- **Les tests vitest ne TYPECHECKENT pas.** Un narrowing cassé (`Number.isInteger(port)` ne dit
  rien à TS de `undefined`) laissait 3 161 tests verts et le BUILD rouge. Rattrapé par le hook
  pre-push, pas par moi : après une modif de type, lancer `npm run build`, pas seulement la suite.
  `[1× — 08-25]`

- [1× — 08-25e] **Mon gate de conformité neuf a été complaisant DEUX fois de suite, sur le même
  fichier.** D'abord un décor vide — je supposais que `runScaffold({type:"app", dir})` écrivait dans
  un sous-dossier, il écrit DANS `dir` : `prettier --check` répondait « aucun fichier trouvé », que
  le banc lisait comme « non conforme » et imputait au générateur. Décor réparé, quatre cas sont
  passés au VERT **sans rien mesurer** : prettier lancé avec un `cwd` donné et un chemin ABSOLU
  sortant de ce répertoire répond « All matched files use Prettier code style! » sans avoir rien
  contrôlé. Seul le cas sentinelle — « un fichier volontairement mal formé DOIT être refusé » — a
  rattrapé le second. **Tout banc de conformité commence par ce cas-là**, et il doit être le
  premier écrit, pas le dernier.

- [1× — 08-25] **Un seuil dont on ne voit jamais la marge est indistinguable d'un seuil
  décoratif.** Le gate mémoire ne publiait son delta qu'en ÉCHEC (message d'assertion), et le step
  de rapport filtrait sur `status == "failed"` : tant qu'il passait — toujours — aucun chiffre.
  Instrumenté, les marges sortent entre ×55 et ×572 **sur un poste au repos**. **Un gate à seuil
  doit publier sa MARGE à chaque passage**, sinon nul ne peut dire s'il garde encore quelque chose
  — et c'est le user qui a posé la question, pas le banc.
  ⚠️ **Suite, 08-25e : la conclusion « les seuils sont 55 à 572× trop larges » était FAUSSE.** Une
  marge n'est pas une propriété du code, c'est une propriété du RÉGIME de la machine qui l'a
  mesurée : le même gate rend **×12,7 à ×14,1** sur les trois systèmes de la forge et **×2,3 à
  ×7,0** sur un poste sous charge. Les resserrer aurait fabriqué un rouge à chaque passage.
  Dossier classé, chiffres et méthode dans `feedback_perf_memory_rule`. **Publier la marge était
  juste ; en tirer un verdict depuis UN seul décor ne l'était pas.**

- **Mon test neuf était complaisant par l'ORDRE de ses données.** Il devait prouver qu'une sonde lit
  l'état d'un socket (`LISTENING`) et n'attrape pas un client connecté au même port ; la ligne en
  écoute figurait AVANT celle du client, si bien que la première correspondance était la bonne par
  accident. Débranché, il restait vert. Lignes inversées, il tombe — et deux cas avec lui. Un jeu de
  données se compose CONTRE l'implémentation, pas dans son sens. [1× — 08-25]

- **Quinze cas VERTS en 0 ms, zéro requête émise.** Ma suite e2e neuve déduisait un corps valide
  en lisant un format d'erreur SUPPOSÉ (`issues[].path`) là où l'application rend
  `error.fields[].field`. Elle rendait `null`, et toute la famille CRUD faisait `return` en
  silence — chaque cas comptait passé. Le seul signe était la **colonne des durées**, jamais le
  total. Quatre gardes « anti-suite creuse » posées ensuite ont mordu au premier run. Corollaire :
  **quand une sonde peut rendre `null`, un cas doit AFFIRMER qu'elle ne l'a pas fait** — et le
  format d'une réponse se RELÈVE sur un serveur réel, il ne se suppose pas. [1× — 08-25]

- **Un `beforeAll` qui lève ne rougit rien : vitest marque les cas SKIPPÉS.** Trois cas de la
  couche donnée sont passés de « exécutés » à « skippés » sans qu'aucun total ne change de
  couleur — un skip se lit comme un vert dans un rapport parcouru vite. La garde qui l'énonce
  (« l'ORM DOIT être debout si des entités sqlite existent ») coûte quatre lignes. [1× — 08-25]

- **Trois de mes fautes ont été attrapées par les gates et les bancs, aucune par moi.** Un champ
  d'options inexistant (vitest muet, `tsgo` l'a refusé au build) · un gabarit de test qui ne
  COMPILAIT pas avec une dépendance injectée (mes assertions lisaient des chaînes, le banc de
  vérité a compilé : `TS2554`, trois fois) · un `container` nullable (gate pre-push). Le point
  commun : **mes propres tests lisaient du texte là où les leurs EXÉCUTENT**. Une assertion de
  chaîne sur un artefact généré ne prouve jamais qu'il tient debout. [1× — 08-24d]

- **Un gate qui SCANNE le dépôt s'auto-satisfait s'il se scanne lui-même.** Le contrôle « le
  registre ne réserve QUE des variables que le runtime lit vraiment » balayait tous les sources —
  y compris `reservedEnv.ts`, où chaque entrée est ÉCRITE. Toute entrée inventée s'y trouvait
  donc « lue », et le gate était vert par construction. Vu uniquement parce que j'avais débranché
  le registre pour éprouver l'autre sens : le premier test a mordu, le second est resté vert sur
  une entrée `NF_ZZZ_MORTE` qui n'existait nulle part. **Tout scanner de sources doit s'exclure de
  son propre périmètre**, et la seule façon de s'en apercevoir est de le voir rouge sur un cas
  fabriqué. [1× — 08-24d]
- **Trois passes payées pour mesurer notre PROPRE générateur.** Une sonde du banc devkit recalait
  l'agent sur une ligne écrite par le gabarit — un commentaire — parce que la garde
  anti-commentaire tombait sur le `+` du diff. Le pire n'est pas ce rouge : c'est que la même
  faute, sur une sonde INVERSÉE, aurait produit un VERT. Ne plus matcher, pour un interdit, c'est
  ne plus rien garder. [1× — 08-24d]

- **Un décor peut EXPIRER au milieu d'un run.** Le jeton de la porte MCP était émis pour 120 minutes
  — durée calibrée sur « la tâche la plus longue » — alors qu'une passe en dure 110 et qu'un run en
  compte trois. Les passes 2 et 3 auraient mesuré une porte fermée pendant que le décor enregistré
  annonçait « jeton posé ». **Un paramètre de décor se dimensionne sur la DURÉE DU RUN, jamais sur
  son unité de travail.** [1× — 08-24]
- **La machine fait partie du décor** : un run de deux heures est mort sur « your computer went to
  sleep ». Le banc s'en protège désormais lui-même (`caffeinate -w <pid>`, qui meurt avec lui). [1× — 08-24]

- **Un gate de couverture a rougi en CI, et il avait raison.** Le cas du 499 se skippait faute de
  trouver le journal du serveur — mais AVANT le correctif de la veille, le même test lisait un
  chemin en dur et, quand il était illisible, court-circuitait son assertion pour ne garder qu'un
  health-check : il passait VERT sans rien mesurer, depuis toujours. Le rouge du jour fut le
  premier verdict FIDÈLE. Réflexe : un gate qui se met à mordre après un correctif de test ne
  signale pas une régression, il révèle un mensonge ancien. [1× — 08-23]
- **La découverte d'un artefact doit RATISSER LARGE quand un marqueur tranche.** Le helper
  cherchait le journal dans deux emplacements et ignorait celui de la forge
  (`$GITHUB_WORKSPACE/nodefony-server.log`) : ajouter un candidat ne peut pas produire de faux
  positif (le marqueur unique décide), mais en OUBLIER un produit un banc muet. [1× — 08-23]

- 🔴 **Un garde qui vise le mauvais dossier ressemble exactement à un garde.** Deux suites
  nettoyaient `tmp/` quand le serveur écrit dans `tmp/upload` (la config de l'app le pose) :
  le `readdir` listait un dossier voisin, `unlink` réussissait à ne rien faire, et **4 420
  fichiers** se sont accumulés sans qu'aucun test ne bronche. Un `unlink` silencieux ne peut
  pas révéler ça — le garde rend désormais le NOMBRE supprimé et les suites l'assertent (vu
  rouge : `expected +0 to be above +0`, la mesure directe du défaut). C'est le USER qui l'a
  vu. `[1× — 08-24]`

- **Un gate neuf, vert du premier coup, laissait passer LE défaut qu'il existait pour attraper.**
  Le contrôle anti-lien-mort d'un site servi sous un sous-chemin résolvait un `/adr/` absolu contre
  la racine du DOSSIER de sortie — où le fichier existe — au lieu de la racine du domaine, où il
  n'existe pas. Il rendait donc « 0 cassé » sur un site dont tous les liens auraient été morts en
  ligne. Découvert en injectant le défaut exprès, pas en le relisant. [1× — 08-24]

## 🎭 Mon PROPRE `--dry-run` mentait — l'option dont le seul rôle est de dire ce qui va se passer

- **Mon `--check` rendait ROUGE sur l'empreinte qu'il venait d'écrire** : il comparait l'objet
  interne à l'objet écrit, lequel portait deux champs de plus. L'option dont le seul rôle est de
  dire « à jour ou pas » disait faux dès sa première utilisation. Un mode de contrôle se lance sur
  sa propre sortie AVANT d'être cru. [1× — 08-27]

- [1× — 08-25] **Mon test d'attaque a cassé la forge sur une plateforme.** Pour prouver qu'une
  injection s'exécutait, j'ai fait lancer `; touch …` par un shell — et le `touch` de BSD, qui
  ignore les options longues, a pris ses arguments pour des NOMS DE FICHIERS. Deux fichiers créés
  à la racine, `git add -A` les emporte, sept jobs Windows tombent au CHECKOUT (`invalid path`,
  exit 128), avant tout test. J'avais nettoyé le témoin attendu, pas les deux inattendus. Une
  charge d'attaque se joue dans un répertoire JETABLE, et l'on relève ce qu'elle a produit
  (`git status`), pas ce qu'on croit qu'elle a produit.
- [1× — 08-25] **J'ai lu le code de sortie du WRAPPER, pas celui de la commande.** `gh run watch`
  écrivait `exit=1` dans son fichier ; la notification de tâche annonçait « exit code 0 » — celui
  du shell qui l'enveloppait. J'ai annoncé la CI verte sur deux workflows... rouges, et sur 2 des
  6 seulement. Un verdict de forge se prend sur l'ÉNUMÉRATION complète des runs du commit, pas
  sur les quelques-uns qu'on a pensé à surveiller.

- **La même URL recomposée à trois endroits, et l'un avait gardé l'origine nue** : `--dry-run`
  annonçait `http://localhost:5151` là où l'exécution visait `…/nodefony/mcp`. On croit un dry-run
  sur parole — c'est précisément pour ça qu'on le lance. Une valeur, calculée une fois.
  `[1× — 08-22]`
- **Un texte de sortie PÉRIME sans que rien ne le signale** : le rendu disait encore « écrit
  `NF_MCP_TOKEN` dans `.env` » le lendemain du jour où ce comportement avait été retiré. Un message
  qui envoie chercher un secret dans un fichier qui ne le porte pas, c'est le diagnostic d'une heure
  qu'on vient de payer, offert au suivant. `[1× — 08-22]`
- **Un compteur de ressources comparait deux instantanés pris dans des RÉGIMES différents.** Le
  banc de durée a rendu « handles 21 → 73 (+52) · TCPSocketWrap +48 » suivi de « des ressources
  s'accumulent : c'est un défaut PRODUIT » — de quoi chercher une fuite de sockets pendant des
  heures. Les handles OSCILLAIENT (6, 72, 5, 73, 29, 72, 73) : une fenêtre tombe tantôt pendant une
  rafale `wrk` (c64 ⇒ ~66 sockets vivantes), tantôt entre deux. Le PLANCHER, lui, valait 5 au début
  comme à la fin. **Ce qui se compare, c'est l'état au repos — jamais deux relevés dont on ignore
  le régime.** [1× — 08-26]
- **`grep -q` sous `set -o pipefail` transforme un SUCCÈS en échec.** `grep -q` ferme le pipe dès
  qu'il trouve ; l'amont meurt en SIGPIPE (141) et le pipeline REND 141. Et seulement si l'amont
  avait encore de quoi écrire — donc de façon non déterministe : le même scénario de smoke, sans
  qu'une ligne ne change, vert ou rouge. Démontré nu : `seq 1 10000000 | grep -q "^1$"` → 141,
  `seq 1 3 | grep -q "^1$"` → 0. Le remède ne rustine pas un site : `case "$texte" in *"$motif"*)`
  ne crée aucun pipe. [1× — 08-26]
- **`$?` lu après un pipe est celui du DERNIER maillon** — relu deux fois dans la même soirée (un
  banc jugé « exit 0 » alors qu'il sortait 1, un commit cru accepté alors que le hook l'avait
  refusé). Capturer dans un fichier, PUIS lire le code sans pipe. [2× — 08-26]

## 🪟 Un message d'erreur qui n'énonce QU'UNE cause envoie chercher là où il n'y a rien

- [1× — 08-25e] **TROIS attentes muettes le même jour, dans trois bancs différents — et la troisième
  cachait un défaut de TEST qu'on prenait pour un défaut PRODUIT.** `new Promise(r => ws.once("pong",
r))` n'a aucune issue si la connexion se ferme : 60 s de « timed out » sans cause, une exécution
  sur deux. `abortedGet` résolvait sur `error` comme sur `close` sans jamais dire ce qu'il avait vu :
  « expected 1 to equal 20 », dix-neuf requêtes disparues en silence. Instrumenté, le message est
  devenu « côté client : 20 abandon(s) : expected 9 to equal 20 » — c'est-à-dire : les vingt ONT été
  abandonnées, le serveur n'en a vu que neuf, **parce que le test coupait avant qu'elles soient
  entrées dans l'action**. Sans l'instrumentation, on cherchait une fuite d'abandons dans le pipeline.
  **Toute attente doit avoir autant d'issues que la réalité en a**, et les nommer.

- **`spawnSync npm ENOENT` se lit « npm n'est pas installé »** — sur un runner où `npm ci` venait
  de réussir. La cause réelle : `npm` est un `.cmd` sous Windows, que Node refuse d'exécuter sans
  shell. Le message ne parle jamais de ce qui manque VRAIMENT (l'extension). [1× — 08-25]

- **Et quand il n'y a pas de message du tout : `status null`.** Un `.cmd` lancé sans shell ne rend
  ni sortie ni code — la garde du banc traduisait ce `null` en « un motif d'exclusion écarte
  l'application témoin », qui envoie chercher dans la configuration d'oxlint. Une garde qui
  INTERPRÈTE un symptôme doit d'abord distinguer « le contrôle a jugé et refusé » de « le contrôle
  n'a pas tourné ». [1× — 08-25]

- Trois jobs Windows rouges deux jours durant sur « man/nodefony.1 est PÉRIMÉE — node
  scripts/generate-man.mjs ». La page n'était pas périmée : git la convertissait en CRLF au checkout
  (`core.autocrlf`), le générateur écrit du LF, le gate compare octet pour octet. **Régénérer n'y
  changeait rien.** Le message nomme désormais les DEUX causes. Corollaire : un dépôt Node
  multiplateforme sans `.gitattributes` a ce piège en dormance. `[1× — 08-22]`

## 📐 Le verdict BINAIRE d'un banc gaspille ce qu'il a déjà mesuré

- [1× — 08-25e] **Le banc de tenue mesurait DEUX grandeurs et n'en jugeait qu'une.** Verdict « ✅ pas
  de fuite » sur un tas parfaitement plat, pendant que son RSS montait de 235 à 251 Mo avec un R² de
  0,92 et sans plafonner — en satisfaisant les trois conditions que le même fichier exige pour oser
  dire « fuite ». Pire : il recevait `heapTotal` et `external` de sa sonde et les JETAIT, donc il ne
  pouvait pas dire OÙ la hausse allait. Ventilé (tas réservé / externe / reste), le diagnostic tombe
  en une ligne — et il désigne l'extérieur de V8. **Ce qu'un banc mesure sans le juger est du travail
  déjà payé qu'on jette** ; ce qu'il juge sans le ventiler n'oriente vers rien.

- L'unanimité sur 3 runs a une résolution catastrophique : une tâche réussie 4 fois sur 5 sort
  « instable » **une fois sur deux** (P(3/3 | p=0,8) = 0,51). Vérifié dans le fichier : la tâche 13
  était à `2/3` le 2 août ; trois runs rejoués trois semaines plus tard ont rendu `2/3`. Deux
  mesures payées, zéro information. Les TOURS, eux, séparaient nettement (52·54 contre 69·88) —
  et le banc les jetait à la décision. `[1× — 08-22]`
- **Ne pas contourner à la main le refus d'un outil** : le dépistage a REFUSÉ de comparer (décor
  différent), je l'ai refait au `jq` et j'ai lu trois « chutes » qu'aucun changement n'expliquait.
  Refaire le calcul qu'une garde interdit, c'est reproduire l'erreur qu'elle empêche. `[1× — 08-22]`

## 🎭 Un test de CARACTÉRISATION grave un défaut au lieu de le décrire

- « initSyslog 2x avec kernel → 2 listeners (**pas de deduplication**) » — aucune justification, un
  simple constat figé. Il gardait un vrai bug : `listenWithConditions` AJOUTE un abonné, donc
  reconfigurer le filtre ne servait à rien (l'ancien écrivait toujours) et chaque ligne acceptée par
  plusieurs abonnés était écrite plusieurs fois. Signal à reconnaître : un intitulé qui **décrit un
  comportement sans dire pourquoi il serait souhaitable**. `[1× — 08-21e]`
- **Un renommage mécanique EMPORTE le témoin qui portait l'ancienne forme.** Le selftest du décor
  posait `NODEFONY_DEV_PORTS` pour graver « l'ancienne forme échappe au filtre `NF_` » ; le
  renommage global l'a transformée en `NF_DEV_PORTS`, donc correctement filtrée — et le test est
  tombé **parce que la réalité s'était améliorée**. Signal : un test rouge dont l'intitulé commence
  par « ⚠️ connue ». Le geste est de RETIRER la règle, pas de rafistoler le témoin. `[1× — 08-23c]`

## 🚪 Un fast-path standalone ne vaut QUE pour l'invocation directe

- `card`, `check`, `env`, `symbols`, `ai:sync`, `ai:mcp`, `git:hooks` : lancées depuis le MENU, le
  kernel tourne déjà, elles passent par commander et **BOOTENT** — leur sortie arrivait sous dix à
  trente lignes de « MODULE ADD ». Même piège pour les capacités déclarées : `CliKernel.start()` les
  applique d'après la commande DEMANDÉE, or depuis le menu c'est `menu`. Toute règle posée « au
  démarrage d'après argv » a un angle mort : le choix différé. `[1× — 08-21e]`

## 🧨 Une commande de DÉCLARATION ne doit jamais désarmer ce qu'elle trouve

- [1× — 08-27] **`docker compose --profile X down` ne borne PAS la descente au profil.** Voulant
  arrêter le seul conteneur navigateur, j'ai emporté `nodefony-redis` — un service d'infra que
  d'autres suites utilisent. Le drapeau qui SÉLECTIONNE à la montée ne RESTREINT pas à la
  descente. Relancé aussitôt, mais le geste juste était `down <service>` nommé, ou `stop`.

- `ai:mcp` sans option RETIRAIT l'en-tête `Authorization` posé la veille — deux fois en une heure sur
  la config du développeur, dont une par un `--json` de simple vérification. Le message disait
  « (remplaçait <la MÊME url>) » : un remplacement qui ne remplace rien de visible. Deux règles :
  **`null` ≠ `false`** (« je n'ai rien demandé » n'est pas « je veux l'anonyme »), et **ce qu'on
  enlève se NOMME** dans la sortie. `[1× — 08-21e]`

## 🧵 Trois choses ne suivent PAS d'un process à l'autre — enchaîner se teste

- Enchaîner une commande sur une autre (`spawnSync`) : l'ENVIRONNEMENT (un enfant ne reçoit que ce
  qu'on lui donne — et `NODE_ENV` si la cible n'existe qu'en dev), le RÉPERTOIRE (écrire dans le
  PROJET, pas là où l'on a tapé), le TERMINAL (`stdio: "inherit"`, sinon `isTTY` est faux chez
  l'enfant et il ne peut rien demander). Rendre la DÉCISION pure et la tester ; le spawn est de la
  plomberie. Le gabarit `create command` l'enseigne désormais. `[1× — 08-21e]`

## 🖥️ Piloter un TTY par `expect` prouve mal — préférer rendre le câblage testable

- Cinq tentatives pour valider un choix de menu : filtres qui ne mordent pas, `\r` qui valide le
  premier item, prompt masqué impilotable, serveur de dev lancé par erreur **deux fois** (qu'il a
  fallu arrêter). Le prompt `search` d'inquirer ne se pilote pas de façon fiable. Quand un câblage a
  échoué en silence, l'exposer (méthode publique) et l'ÉPROUVER coûte moins cher qu'un pty.
  `[1× — 08-21e]`

## 💾 Un CACHE à demi écrit est pire qu'un cache absent — il écrase une donnée valide

- `[1× — 08-21d]` 🔴 **Trois symptômes sans rapport apparent, une seule racine : un `writeFile` en
  fire-and-forget.** Le menu perdait TOUTES ses commandes de module, la complétion proposait des
  noms de commandes au lieu des options, et le user devait relancer `nodefony -h` « à chaque fois ».
  Cause unique : `writeFile` OUVRE et TRONQUE avant d'écrire, donc un process qui sort avant la fin
  — le cas NOMINAL d'une commande CLI courte — laisse un fichier de **0 octet**. Chaque commande
  détruisait ainsi le cache que la précédente avait écrit. Le geste : **temporaire + `rename`**
  (atomique) dès qu'une écriture n'est pas attendue ; un process tué laisse alors l'ancien fichier
  INTACT. Et le diagnostic : `wc -c` sur le cache AVANT de suspecter sa logique de lecture.
- `[1× — 08-21d]` **Un fallback silencieux transforme un cache manquant en fonctionnalité amputée.**
  Le menu masquait le groupe entier sans un mot ; il ÉNONCE désormais l'absence et renvoie à
  `--help`. Corollaire de conception : ce qui répond à un TAB ou ouvre un menu ne doit jamais
  démarrer l'application — mais doit dire ce qu'il ne sait pas.

## 🖥️ L'interactif se prouve au PTY — et chaque couche peut salir la sortie

- `[1× — 08-21c]` **`script(1)` + `printf` piloté = prouver un prompt TTY sans machine ni
  main** : `(sleep 4; printf 'blog'; sleep 1; printf '\r') | script -q cap.txt npx nodefony
menu` — quatre preuves rendues dans la session (rendu groupé, filtre à la frappe, Ctrl+C,
  écran reset + commande exécutée). La capture se relit APRÈS strip ANSI, et le viewport
  d'inquirer ne rend que la fenêtre : « absent de la capture » ≠ « absent du menu » (vécu :
  un groupe en bas de liste cru manquant, révélé par le filtre).
- `[1× — 08-21c]` 🔴 **Un Ctrl+C « propre » a demandé DEUX corrections, chacune une couche
  plus bas** : (1) `throw` après `terminate()` — terminate est ASYNCHRONE, l'erreur remontait
  au kernel avant l'exit (CRITIC + exit 1) ; (2) `quiet` perdu par `CliKernel.terminate` qui
  délègue au kernel → le log INFO ressurgissait après « À bientôt. ». La sortie d'un CLI est
  une CHAÎNE de terminaisons : la prouver au pty à CHAQUE couche, pas au premier vert.
- `[1× — 08-21c]` **`stream-json` ne montre PAS le contexte initial injecté** : « VÉRIFIER
  absent du transcript » ne prouvait pas « CLAUDE.md pas injecté ». Tranché par une sonde
  discriminante à 1 centime : CLAUDE.md témoin « réponds BANANE42 » + `claude -p` → réponse
  conforme = le pointeur EST le seul canal injecté d'office en headless. L'instrument d'abord.
- `[1× — 08-21c]` **`perl -pe 's/\x{00A0}//'` sans décodage UTF-8 opère en OCTETS** : il a
  matché le seul 0xA0 et laissé le 0xC2 orphelin — fichier UTF-8 invalide, pire qu'avant.
  Remplacer un caractère multi-octets exige `-CSD` (ou opérer sur la séquence complète), et
  se vérifie à l'`od -c`, pas à l'œil.

## 🧪 Vérifier que la transformation a EU LIEU, avant de croire la mesure

- [1× — 08-27] **Mon cas « évidemment sale » de flottant était PROPRE.** J'avais écrit le test
  d'arrondi sur `8.1 + 0.6`, en affirmant en commentaire qu'il valait `8.700000000000001` : le
  calcul est exact, et le test restait vert une fois la garde débranchée. Il a fallu BALAYER la
  plage pour trouver un cas réel (`1.1 + 0.1 = 1.2000000000000002`, un parmi 1 608). Une
  intuition sur les flottants ne se cite pas, elle se cherche à la commande.
- [1× — 08-27] **J'ai conclu « c'est la CI » sur DEUX points de mesure.** `gh run list --limit 300`
  ne remontait qu'à trois jours ; pour les cinq jours précédents je n'avais aucun chiffre et j'ai
  extrapolé la corrélation. La conclusion était juste — la preuve, non. Le rattrapage : reprendre
  la série entière par l'API, puis la CONFIRMER par une mesure indépendante (7,3 jobs par run
  contre 5,4–9,1 clones par run). Une corrélation qui ne couvre pas la période qu'elle explique
  n'est pas une corrélation.

- [1× — 08-27] **Mon propre audit se CONTREDISAIT, et c'est ce qui l'a sauvé.** Il annonçait
  `reflect-metadata` bundlé dans un `dist/` ET « jamais importé côté serveur » — deux verdicts
  incompatibles. Cause : ma détection cherchait `from "x"` et ratait `import "x";`, l'import à
  effet de bord, précisément la forme du paquet en cause. Sans la contradiction visible dans le
  MÊME rapport, la branche « dérive » aurait rendu un vert faux pendant des mois. Faire produire
  deux mesures indépendantes à un instrument, c'est lui donner le moyen de se dénoncer.
- [1× — 08-27] **Un `&&` a poussé l'état d'AVANT un commit refusé.** `git ci … ; git log -1 && git
push` : le hook a rejeté le commit, `git log` a réussi (il affichait l'ANCIEN HEAD), donc le push
  est parti — et j'ai lu « poussé ». Le maillon en échec n'était pas dans la chaîne `&&` ; celle-ci
  ne prouvait donc rien de ce que je croyais qu'elle prouvait.

- **`declare -A` n'existe pas en bash 3.2 (celui de macOS) — et mes propres « ok » l'ont masqué.**
  La table associative a échoué, l'identifiant d'option est parti VIDE, et six tickets ont reçu la
  priorité par défaut. Mon script affichait pourtant « #57 ok P1 » : il traçait mon INTENTION, pas
  le résultat, et le `>/dev/null` posé sur l'appel qui écrit achevait de cacher l'échec. Ce qui a
  tranché : relire les champs par l'API. Ne jamais faire confiance à un `echo` qui répète ses
  propres arguments. [1× — 08-27]
- **🔴 `npm install` sur un arbre DÉJÀ installé outrepasse une dépendance de pair ; `npm ci` la
  refuse.** Monté TypeScript 7 : build 21/21, 3 160 tests verts, `npm outdated` vide — j'ai écrit
  dans un commit que ma réserve « ne tenait pas ». La forge a rougi QUATRE chaînes sur cinq
  plateformes : `@angular/build` déclare `peer typescript@">=6.0 <6.1"`, une plage fermée. Le seul
  signe local était un `npm warn ERESOLVE overriding peer dependency` noyé dans cinq lignes
  identiques. Toute montée de dépendance s'éprouve par `npm ci` (ou `--dry-run`), jamais par un
  `npm install` sur son propre arbre : c'est le cas d'école de « prouver sur l'artefact REÇU ».
  [1× — 08-27]
- **Une sonde qui rend ZÉRO se suspecte avant le produit.** « frames: 0 » sur cinq sockets m'a fait
  douter du serveur : la clé n'existait pas, les données étaient sous `recues`/`envoyees`. `jq` sur
  une clé absente rend un compte de 0, jamais une erreur — le même silence que le champ manquant.
  [1× — 08-27]
- **Un chiffre faux dans mon PROPRE message de commit** : « 21 tickets créés » pour 24 réellement
  ouverts, écrit dans le commit qui reprochait à un ticket son chiffre périmé. Compté par `gh` juste
  après, corrigé avant la poussée. La règle « un chiffre se re-mesure » vaut d'abord pour ce que
  j'écris moi-même. [1× — 08-27]
- **Un chiffre repris d'un audit se REMESURE avant d'entrer dans un ticket.** « 437 ancres en dérive »
  venait d'une mesure d'une semaine ; rejouée, elle rendait **108 sur 4 421 (97,6 % justes), 0 LINE_OUT,
  0 FILE_NOT_FOUND**. Le ticket annonçait 2 j de travail là où il en fallait 0,5, et surtout il
  alarmait le user sur une doc « toute fausse » qui ne l'était pas. Un audit rend une PHOTO ; entre la
  photo et le ticket, le code a bougé. [1× — 08-27]
- **Le menu rendait `undefined` sur toutes les pages** après ma modification du scanner : le générateur
  consomme le `dist` du module, pas le `.ts` que je venais d'éditer. Vu SEULEMENT parce que j'ai
  regardé le HTML rendu au lieu de croire le build vert. Le piège n°1 du dépôt, encore. [1× — 08-27]

- **Mon débranchement n'a RIEN débranché, et l'a écrit quand même.** `pkill -f "bin/nodefony
production"` ne tuait rien (Nodefony renomme ses process) et mon `;` au lieu d'un `&&` imprimait
  « serveur tué » de toute façon. Le gate est passé au vert sans avoir été éprouvé. Refait en tuant
  par le PORT, avec la mort CONSTATÉE après coup : 3 tests sont tombés. [1× — 08-26]
- **`timeout` n'existe pas sur macOS → code 127 lu comme « la commande n'existe pas ».** J'ai
  failli conclure que `nodefony inspect/check/env` étaient absents, alors que c'est mon préfixe qui
  manquait. Un 127 accuse toujours le PREMIER mot de la ligne. [1× — 08-26]
- **Un pathspec `dossier/**/*.mjs` ne matche PAS la racine du dossier** : mon comptage rendait 4
  scripts là où `git ls-files` du dossier en voit 44. Dans un outil dont le seul rôle est de dire
  « ce chiffre ne dit pas tout », un comptage faux est l'ironie maximale. Recroisé zone par zone
  avant de livrer. [1× — 08-26]

- [1× — 08-25] **J'ai édité un script bash PENDANT son exécution.** Bash lit le fichier au fur et à
  mesure, à l'OFFSET D'OCTETS : mon insertion a décalé la suite, et l'interpréteur est tombé au
  milieu d'une ligne (`══: command not found`). Le rouge n'accusait rien d'autre que moi, et
  `bash -n` ne pouvait pas le voir. La règle « ne pas éditer pendant un run » ne vaut pas que pour
  les suites de tests : elle vaut pour le script LUI-MÊME.

- **Ma mutation n'avait PAS été appliquée — et j'ai failli conclure que mes tests ne mordaient
  pas.** Un `str.replace(old, new)` dont l'ancre ne correspond pas ne lève rien : il réécrit le
  fichier INCHANGÉ. Les 46 verts qui ont suivi ne prouvaient donc rien. Toute mutation porte
  désormais un `assert old in s` — et le grep de contrôle vient APRÈS. `[1× — 08-25]`

- [1× — 08-25e] **La règle de portabilité que le PRODUIT avait déjà payée, rejouée dans un test une
  heure après l'avoir écrite.** Mon banc invoquait `node_modules/.bin/prettier` par `execFileSync` :
  npm n'y écrit sous Windows qu'un `.cmd` et un `.ps1`, l'appel échoue, et trois jobs Windows sont
  tombés sur cinq rouges qui ne disaient rien du générateur. Le dépôt porte `besoinDeShell` et
  `nodefonyBin()` pour exactement ça. Remède : `process.execPath` + le script `.cjs` — aucun shell,
  un seul chemin pour les trois systèmes. **La règle vaut pour TOUTE ligne écrite, pas seulement
  pour celle qu'un utilisateur exécute.**

- [1× — 08-25e] **Un champ ABSENT n'est pas une valeur à zéro.** Le banc lisait `inflightCount` d'un
  serveur bâti AVANT que cette sonde existe : `undefined ?? -1` → « -1 en vol », et le message
  accusait de nouveau le produit. La garde distingue désormais les deux et lève « son dist est
  ANTÉRIEUR à cette sonde, reconstruire ». Même famille : la sonde mémoire forçait un GC **en no-op
  silencieux** sans `--expose-gc` — elle rend maintenant `gcForced`, et le banc REFUSE de mesurer
  quand il vaut faux. **Une capacité dont dépend une mesure doit être CONSTATÉE par la mesure
  elle-même**, sinon on publie un chiffre faux avec l'aplomb d'un chiffre vrai.

- **Mon débranchement est passé VERT, et ce n'était pas le test qui avait tort : le serveur n'avait
  pas rechargé.** J'ai daté le handler 5 s dans le futur pour prouver qu'une assertion d'ordre
  mordait ; les six cas sont restés verts. La cause n'était pas l'assertion mais le dist, encore
  l'ancien. Constaté en interrogeant la route (écart mesuré à +4998 ms), et l'assertion est alors
  tombée. Un débranchement se PROUVE comme un correctif : par ce que sert le process, pas par ce
  qu'on vient d'écrire. [1× — 08-25]

- **🔴 Une commande composée REFUSÉE par un hook n'exécute AUCUNE de ses parties — deux fois en une
  session, et deux fois j'ai conclu sur un état que je croyais acquis.** (a) `python … <<PY` qui
  écrit un test, suivi d'un `cd relatif && vitest` : le refus portait sur le `cd`, et le test n'a
  jamais été écrit — j'ai lu « 9 passed » comme une preuve alors que c'étaient les 9 tests
  d'origine. (b) `cp fichier sauvegarde` suivi d'un `git checkout` : le refus portait sur le
  checkout, la sauvegarde n'existait pas, et le patch a été perdu. **Ne jamais mettre dans la même
  commande une écriture qu'on veut garder et un geste susceptible d'être refusé** ; et après tout
  refus, RELIRE l'état plutôt que de supposer que la première moitié est passée. [1× — 08-24d]

- **Un remplacement de texte qui ne trouve rien ne dit RIEN — et le formateur a déjà réécrit la
  cible.** Quatre câblages d'échelle sur huit n'ont jamais été appliqués : mes motifs portaient sur
  du code que prettier avait reformaté entre-temps, donc ils ne matchaient plus. Aucune erreur, aucun
  avertissement — c'est un lint sur variable inutilisée qui l'a révélé, longtemps après. Depuis :
  tout remplacement programmatique s'assortit d'un `assert` sur « le contenu a changé », et on
  RECOMPTE les usages attendus. [1× — 08-24]

- **[2× — 08-24] La MÊME cause, le même jour, sur un autre fichier.** Trois règles d'exclusion
  ajoutées à une liste ne l'ont jamais été : prettier avait reformaté la cible entre-temps et mes
  `replace` étaient sans `assert`. Le résultat était JUSTE — par accident, une autre règle rattrapait
  le cas — avec de mauvais motifs affichés. Un patch qui n'a pas eu lieu ne se voit pas dans la
  sortie ; il se voit à ce qu'on ASSERTE.

- **Un fichier qui ne charge plus, cinq fois pour la même raison.** Un backtick dans un commentaire
  CSS, à l'intérieur d'un gabarit de chaîne, coupe le gabarit : le module refuse de se charger. Cinq
  occurrences dans une seule session, chacune détectée tout de suite mais chacune coûtant un cycle.
  Le remède n'est pas la vigilance : c'est `node --check <fichier>` DANS la commande qui édite. Une
  faute mécanique répétée demande un automate, pas de l'attention. [1× — 08-24]

- **Mon INSTRUMENT comptait deux fois la même chose.** « 271 chevauchements d'étiquettes sur 62
  schémas » — chiffre alarmant, et faux : chaque figure contient DEUX rendus (clair et sombre) aux
  mêmes coordonnées, dans la même balise. Mesure refaite par SVG : 4. Avant de corriger un chiffre
  qui surprend, vérifier ce que l'instrument a réellement compté. [1× — 08-24]
- **Un « tout vert » ne couvre que les chemins qu'il emprunte.** `aDroite` n'existait pas dans
  `lines()` — la suite passait au vert parce qu'aucun cas ne traversait ce code. Le cas ajouté cinq
  minutes plus tard l'a fait tomber immédiatement. [1× — 08-24]

- Un hook a bloqué un appel Bash entier (garde `cd` relatif), **python inclus** : l'édition n'a jamais eu lieu, j'ai buildé du code inchangé et conclu deux fois sur du vide. Le `grep` de contrôle sur le fichier édité coûte une seconde. [1× — 08-22]
- `$?` après un pipeline est celui de la DERNIÈRE commande : `prettier --check f | tail` rend toujours 0. Quatre verdicts faux d'affilée. [2× — 08-22]
- `prettier --check` lancé depuis le dépôt sur un chemin HORS périmètre ne trouve aucun fichier et sort **0** : « conforme » disait en réalité « rien vérifié ». Toujours mesurer dans le décor où la config s'applique. [1× — 08-22]
- Le CLI s'exécute depuis `dist` : un gabarit se lit au disque (édition immédiate), le MOTEUR non — build avant de mesurer. [1× — 08-22]

- **`grep -c` compte des LIGNES, pas des occurrences** — sur un rendu HTML, il a fait
  conclure « 1 NaN » puis « 4 lignes avec 12226 » sans rapport avec le nombre réel. Et le
  même jour, un `grep "12 226"` à l'espace normale n'a rien trouvé dans une page qui l'écrit
  avec une espace **insécable** : « le chiffre a disparu » était faux deux fois de suite.
  Compter = `grep -o … | wc -l` ; chercher un nombre formaté = motif tolérant au séparateur.
  `[1× — 08-24]`
- 🔴 **J'ai failli « corriger » un graphe JUSTE.** En lisant un SVG séquentiellement, chaque
  valeur tombait à côté du libellé de la barre SUIVANTE : j'ai cru à des libellés décalés
  d'un cran, et le corriger aurait introduit le vrai défaut. Les coordonnées (`y`) l'ont
  tranché en une commande. Dans un rendu, l'ordre du DOCUMENT n'est pas l'ordre VISUEL.
  `[1× — 08-24]`
- **Un `rm -rf` composé que zsh REFUSE n'exécute AUCUNE de ses parties** — un glob sans correspondance annule la commande entière. J'ai annoncé « décors nettoyés » sur un compte que je n'avais pas relié au geste ; 156 Mo étaient toujours là. Même famille que la chaîne `&&` interrompue. [1× — 08-25]
- **Prettier lancé sur une copie sous `tmp/` ne traite RIEN** : le `.prettierignore` du dépôt écarte ce dossier, la commande sort **0** sans avoir lu le fichier — j'en ai conclu « 0 écart » sur un fichier que le gate déclarait non conforme. La sortie masquée (`>/dev/null`) a caché que rien n'avait été traité. [1× — 08-25]

## 🗄️ Gradué aux CONSOLIDATE (retiré d'ici — règle anti-doublon)

Ces thèmes ont quitté le sas pour des mémoires durables. Ne pas les réécrire ici.

**CONSOLIDATE 2026-08-24 :**

| Thème (frictions)                                                  | Destination                                      |
| ------------------------------------------------------------------ | ------------------------------------------------ |
| 🔌🧪🎭 Le DÉCOR d'un banc : variable, pas dû ; ni celui livré (19) | `feedback_stale_decor_poisons_verdicts` (§ banc) |
| 🎯🔍⚖️🗣️ La sonde mesure-t-elle la CHOSE ? zéro muet (12)          | `feedback_prove_the_target_not_the_verdict` (§)  |
| 🏭🖨️ Le GABARIT n'est pas son RENDU — formater l'un ≠ l'autre (9)  | `feedback_dogfood_distributed_templates` (§)     |
| 🚦🐚🧾 Le code de sortie LU n'est pas celui MESURÉ (7)             | `feedback_shell_false_diagnostics` (§)           |
| 🎯🧰 La commande du DÉPÔT est l'autorité — le frère existe (7)     | **`feedback_repo_command_is_authority`** (neuve) |
| 🧪 Un test neuf peut FIGER sans discriminer (6)                    | `feedback_gate_must_bite` (§ figer)              |
| 📌 Un chiffre publié sans son COMMIT n'est pas réfutable (6)       | `feedback_measure_method` (§ 5)                  |
| 🩹🔁🧭 Corriger l'OCCURRENCE, pas le MOTIF — se recontaminer (6)   | `feedback_single_source_rule` (§)                |
| 🔎 Une ABSENCE de trace n'est pas une preuve (5)                   | `feedback_source_over_memory` (§)                |
| 🔗 « Valider la chaîne » = l'EXÉCUTER (5)                          | `feedback_prove_on_received_artifact` (§)        |

_Coupés au même passage (toutes frictions antérieures au CONSOLIDATE du 08-20, jamais reconduites) :_
🚦 contrôle de cible rouge · 🔇 mode machine qui coupe le journal · 📐 pourcentage de profil ·
🤖 `haiku` trompé 2× · 🕵️ cause temporelle commune · 🧭 leçon gravée dans UN artefact ·
🏷️ nom de variable déjà pris · 🧾 racine ≠ paquet · 🧰 réécrire le métier d'un outil ·
⛓️ gate en chaîne · 🎚️ valeur par défaut · 🎭 état sauvegardé sans identité · 🪟 Windows « après » ·
🖼️ rendu qui remplace · 🎲 variance d'un banc d'agent · 🪦 phrase qui justifie une absence ·
🤝 nom partagé entre paquets · 🕸️ interface sans son appelant · 🚚 déménager un artefact ·
🪞 serveur tolérant vs strict · 🚧 donnée arrêtée à la frontière · 🕳️ pointeur conforme ·
📏 cellule obèse · 🩺 montée de version · 🗣️ juge qui exige une sortie vide.
Snapshot : `archive/RETEX-snapshot-2026-08-24.md`.

**CONSOLIDATE 2026-08-20 :**

| Thème (frictions)                                             | Destination                                    |
| ------------------------------------------------------------- | ---------------------------------------------- |
| 🧰 Outillage : ce qui pend, ce qui ment, ce qui lance (24)    | `feedback_prove_the_target_not_the_verdict`    |
| 🧪 Un gate ne prouve rien tant qu'on ne l'a pas vu ROUGE (14) | `feedback_gate_must_bite` (§ débranchement)    |
| 🧭 Annoncer une NORME sans l'avoir lue jusqu'aux ÈRES (10)    | `feedback_spec_conformance_vs_reachability`    |
| 📚 La doc officielle périme la mémoire (7)                    | `feedback_source_over_memory`                  |
| 🔬 Quatre instruments faux d'affilée sur UNE question (6)     | `feedback_suspect_instrument_and_own_diff` (§) |
| 🔦🧩 Une capacité qu'on n'ATTEINT pas n'existe pas (6)        | `feedback_capability_unreachable_is_absent`    |
| ⏱️ Un test qui attend un DÉLAI FIXE mesure la machine (5)     | `feedback_test_no_fixed_delay`                 |
| 🗣️🧭 Le user REPOSE la question · prémisse à vérifier (7)     | `feedback_user_repeats_question`               |
| 📦 npm : un arbre réparé à la MAIN n'est pas une garantie (5) | `feedback_npm_tree_not_a_guarantee`            |

_Coupés au même passage (antérieurs au 2026-08-06, déjà couverts par une mémoire graduée) :_
🧬 patron N fois · ⚖️ geste puni par l'outil · ⚙️ montée d'outil · 📖 API d'une lib maison ·
🔎 ce que le journal des commits cache · 🔴 gate rouge en permanence · 🛡️ garde posée/retirée ·
🕳️ import qui compile chez moi. Snapshot : `archive/RETEX-snapshot-2026-08-20.md`.

**CONSOLIDATE 2026-08-06 :**

| Thème (frictions)                                             | Destination                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| 🧾🎛️ Paramètre accepté puis jeté · capacité au store (21)     | `feedback_param_accepted_then_dropped`                             |
| 📏🌡️🔬 Régime machine · fenêtre de banc · profil/in-situ (26) | `feedback_bench_machine_regime`                                    |
| ✅🚫🕳️ Données discriminantes · refus≠capacité · filet (22)   | `feedback_test_discriminant_or_dead`                               |
| 🥫🧬 Gabarits distribués · dogfooding · agent étranger (11)   | `feedback_dogfood_distributed_templates`                           |
| 🧰🎚️ Décor sale : serveurs, ports, stores, env de banc (10)   | `feedback_stale_decor_poisons_verdicts`                            |
| 📄 Une livraison n'entraîne pas sa doc · anchor-fix (6)       | `feedback_refactor_grep_consumers` (section doc)                   |
| 🧰 Formes shell : zsh `:A`, BRE `\{`, `rg -oh`, `&&` (6)      | `feedback_shell_false_diagnostics` (tableau)                       |
| 🗄️ Concurrence & dialectes (ESCAPE, ODKU, pool froid) (9)     | kit `project_orm_multidialect_chantier_kit` (§ Leçons dialectes)   |
| 📦 Surface npm & publication (6)                              | kit `project_release_nodefony10` (§ Pièges de surface npm)         |
| 🤖 Piloter un agent TIERS (6)                                 | kit `project_devkit_bench_agent_switch` (§ Piloter un agent tiers) |
| ⚖️🎯🎭 Juges, sondes de moyen, décor du banc (11)             | kit `project_devkit_bench_matrix` (§ Juges et sondes)              |
| 🔀 Deux appels au même traducteur (2)                         | fondu dans `feedback_param_accepted_then_dropped`                  |
| 📣 Commande maison filtrée par la familiarité (2)             | fondu dans `feedback_dogfood_distributed_templates`                |
| 🧹 Remise à zéro fichiers ≠ process (2)                       | fondu dans `feedback_stale_decor_poisons_verdicts` + kit matrix    |

**CONSOLIDATE 2026-08-02 :**

| Thème (frictions)                                       | Mémoire                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| 🧪 Suspecter son instrument / son propre diff (35)      | `feedback_suspect_instrument_and_own_diff`                              |
| 🪞 Un exemple de CODE agit, même faux (8)               | `feedback_agent_example_over_prose`                                     |
| 🕳️ Gate qui ne LIT rien · débranchement destructeur (7) | `feedback_gate_must_bite` + `feedback_destructive_needs_identity_scope` |
| 🎯 Isoler une variable · sonde de proximité (8)         | `feedback_measure_method` + `feedback_bench_probe_false_verdicts`       |
| 🔍 Inventaire exhaustif par croisement (4)              | `feedback_inventory_needs_crosscheck`                                   |
| 🎲 Variance d'un run à l'autre (4)                      | `feedback_measure_method` + `feedback_bench_probe_false_verdicts`       |
| ✅🧷 Un vert de test ne typecheck rien (3)              | `feedback_gate_must_bite`                                               |
| 🟢 Test non exécuté = rouge · vert annoncé (4)          | `feedback_gate_must_bite` + `feedback_green_covers_only_its_diff`       |
| 📦🔗🔬 Ce qui est COPIÉ ne se met pas à jour (4)        | `feedback_single_source_rule`                                           |
| 🧨 Commande composée refusée (1)                        | `feedback_shell_false_diagnostics`                                      |

## 🧰 Un GATE excellent que personne ne lance ne garde rien

- **Un gate qui rend 24 candidats dont 19 pour un fichier que tout le monde cite ne sera plus jamais lu** [1× — 08-27] : le bruit tue un contrôle aussi sûrement que son absence. Écarter les fichiers trop cités — en ANNONÇANT lesquels et combien — a ramené le lot à 3, exactement les bons. Et le seul nom de fichier ne désigne rien : `index.ts` faisait remonter un ticket d'un autre module ; le motif minimal est le chemin sur deux segments.

- [1× — 08-27] **Une règle RECOPIÉE hors de son skill gagne contre le skill — et fait faire
  l'inverse.** Le `CLAUDE.md` racine et la mémoire IA désignaient le conteneur comme « l'exception
  qui lève la règle pas-de-Chromium » ; le skill dit depuis sa v1.1.0 que la voie normale est
  LOCALE (rien à démarrer) et que le conteneur est un dernier recours. J'ai lancé le conteneur
  sans ouvrir le skill : le résumé était sous mes yeux, pas lui. **Le paquet publié, lui, portait
  déjà la bonne doctrine** — c'est le dépôt qui avait dérivé, pas ce qu'on distribue. Le contrôle :
  quand un `CLAUDE.md` résume un skill, il ne doit garder que le RENVOI et le déclencheur, jamais
  la doctrine — sinon l'agent applique le résumé périmé et n'ouvre jamais la source.

- [1× — 08-27] **Un contrôle rangé dans un SKILL se périme sans le dire — et il l'a fait.** L'audit
  `external` supposait `const external: string[] = [...]` ; la migration rolldown a fait passer **20
  configs sur 21** à la forme en ligne. Il ne lisait plus RIEN, ne signalait rien, et personne ne
  s'en est aperçu : c'est ainsi que `zod` est entré dans le paquet du module `test` et
  `reflect-metadata` dans deux `dist/` publiés. Il ne balayait pas non plus `src/modules/*`. Le
  déplacement dans le dépôt (`npm run externals:check`, appelé par la forge) n'est pas un rangement,
  c'est ce qui le rend testable et corrigible avec le code qu'il garde.
- [1× — 08-27] **Le dépôt a refusé mes deux nouveaux scripts : « personne ne les appelle ».** Le gate
  de placement des scripts a bloqué le commit sur `ticket-open.mjs` et `ticket-progress.test.mjs`
  — écrits, testés, et branchés nulle part. C'est exactement le défaut que la session venait de
  corriger ailleurs, reproduit dans le même commit. Un script sans appelant est un script mort ;
  ici c'est une machine qui l'a vu, pas moi.

- [1× — 08-27] **Quand la SOURCE DE VÉRITÉ déménage, le rituel qui la lit ne suit pas tout seul.**
  Le pilotage de la publication est passé du plan Markdown aux issues il y a une session — et la
  reprise continuait de restituer un état écrit à la main, qui vieillit entre deux sessions quand
  un ticket, lui, a un état. Le tableau de bord existait, personne ne le lisait au bon moment.
  Deux gestes à faire le jour où l'on déplace une source : **brancher dessus le rituel qui la
  consulte**, et **énoncer ce qui gagne en cas de contradiction** (ici : le ticket bat le
  document). Et constater la joignabilité avant d'en tirer un verdict — un `gh` muet hors ligne
  ferait conclure « rien n'a avancé ».
- [1× — 08-27] **Un SKILL que rien ne NOMME n'est jamais chargé — la règle existe et ne mord pas.**
  `nodefony-ticket` était écrit, versionné, conforme, avec ses déclencheurs — et cité NULLE PART :
  ni dans la table des skills du `CLAUDE.md`, ni par une seule phrase du banc de déclenchement, qui
  l'annonçait « porte non testée ». Résultat : j'ai ouvert quinze tickets sans lui, et le user a dû
  demander leur réécriture entière. Le coût ne se voit pas au moment où on saute le skill, il se
  paie une session plus tard. Créer un skill n'est pas fini tant que trois choses ne sont pas là :
  une entrée dans le `CLAUDE.md` (un POINTEUR, jamais la règle), au moins un cas au banc, et des
  déclencheurs pris des mots RÉELLEMENT employés — pas de ceux qu'on imagine.
- [1× — 08-25] **Un « flake » qui revient N'EST PAS un flake.** `websocket-fragmentation` est tombé
  sur Windows puis sur macOS en une heure, toujours en « timed out 60 s ». Traité deux fois comme
  un aléa de plateforme ; c'était une COURSE : le listener `message` était posé APRÈS l'`open`,
  alors que `ws` peut émettre le premier message dans la MÊME boucle d'événements que l'upgrade.
  Reproduit en injectant un retard entre les deux — l'ancienne forme perd dès qu'un tour de boucle
  s'intercale, à 0 ms déjà. Le test qui tranche entre « aléa » et « course » ne coûte rien :
  RALENTIR artificiellement l'étape suspecte et voir si l'échec devient systématique.
- [1× — 08-25] **Lire OÙ l'étape échoue avant de chercher QUOI corriger.** Un déploiement Pages
  rouge m'a fait ouvrir le générateur de site : l'échec était dans `Set up job`, sur un
  `Failed to download action` — panne réseau du runner, avant la moindre ligne de notre workflow.
  Un simple rejeu l'a réglé. Le nom de l'étape en échec est la première information du log, et
  c'est celle qui dit si le dépôt est même concerné.

- [1× — 08-25] **Un banc rouge sur sa PROPRE garde d'entrée n'a jamais mesuré.** `soak.yml`
  échouait à chaque passe sur « machine OCCUPÉE » (21,72 de charge sur 3 cœurs) : il suit un
  `npm ci` + build, et `loadavg[0]` est une moyenne sur UNE MINUTE — elle décrit le passé, pas
  l'instant. La garde était juste, son MOMENT ne l'était pas. Quand une garde de décor refuse
  systématiquement dans un environnement donné, la question n'est pas « faut-il la desserrer ? »
  mais « que devrait-elle faire à la place ? » — ici, ce que son message conseillait déjà à un
  humain : attendre la retombée.

- [1× — 08-25] **Un gate qui ne lit que la moitié de son domaine.** `scripts-audit` portait un
  contrôle « renvois morts » — mais il ne lisait que le TEXTE des `SKILL.md`. Un script qui en
  LANCE un autre par un chemin en dur y échappait entièrement, et la forme employée
  (`join(repo, ".claude", "skills", …)`) n'est visible d'AUCUNE expression cherchant un chemin.
  Le gate était vert pendant que quatre systèmes tombaient sur `Cannot find module`. Étendre un
  gate à un nouveau support commence par se demander ce qu'il ne REGARDE pas.
- [1× — 08-25] **Une fiche générée périmée ment avec l'autorité du généré.** `skills-doc --check`
  contrôlait la conformité des sources, jamais la fraîcheur de ce qu'il avait lui-même produit :
  le registre annonçait un skill à 455 lignes quand il en portait 619. Tout générateur doit
  savoir dire « ce que je produirais diffère de ce qui est sur disque » — c'est le même
  comparateur que celui qui évite de réécrire, donc il est déjà là.

- **La chaîne de PUBLICATION transitait par `.claude/skills/`, avec un CYCLE.**
  `scripts/release.mjs` appelait un script du skill, qui réimportait le cœur du produit ; la CI
  lançait le smoke depuis `.claude/`. Un skill renommé ou fusionné aurait emporté la capacité de
  publier, sans qu'aucun test ne tombe. Ce qui S'EXÉCUTE appartient au produit ; le skill garde la
  MÉTHODE. Corollaire : il manquait une page pour l'HUMAIN — trois lecteurs, trois endroits.
  `[1× — 08-25]`

- [1× — 08-25] **`schedule` et `workflow_dispatch` ne partent QUE depuis la branche par défaut.**
  Workflow écrit, commité, poussé sur la branche de travail — et incapable de se déclencher : ni
  rendez-vous hebdomadaire, ni bouton. L'API le dit franchement (« not found on the default
  branch »), mais rien dans le fichier ne le laisse deviner. Un `push` borné aux bons fichiers le
  rend éprouvable tout de suite ; le reste exige d'être porté sur la branche par défaut.
- [1× — 08-25] **Un `on: push` sans `branches:` part sur TOUTE branche — Dependabot compris**,
  dont les branches rebasent sur la branche de travail et embarquent donc le fichier neuf. Deux
  exécuteurs mobilisés trente minutes pour une montée de dépendance sans rapport, dont le `npm ci`
  échouait de toute façon. Le workflow voisin bornait déjà ses branches : la règle existait, elle
  n'a pas été recopiée.
- [1× — 08-25] **Le banc de release était rouge depuis TROIS passes hebdomadaires**, jamais lues —
  et le correctif dormait dans le dépôt depuis la veille, jamais éprouvé. Un rendez-vous
  automatique dont personne ne lit le verdict ne garde rien : il fabrique juste de la confiance.

- **La passe principale était ROUGE depuis 20 exécutions, et plus personne ne la lisait.** Deux
  erreurs de lint triviales la tenaient — et derrière elles, en file, deux autres gates qui
  seraient devenus le rouge suivant (un fichier dérivé du formateur, un faux positif de
  `skills:check`). **Un rouge permanent ne protège plus : il éteint le signal**, et il masque
  exactement autant de choses qu'il y a de gates derrière lui dans la chaîne `&&`. Le réflexe qui
  manquait : regarder `gh run list` au début d'une session qui touche à la CI. [1× — 08-25]

- **Le faux positif qui maintenait le rouge venait du gate lui-même** : deux RENDEURS de rapports
  (ils lisent un JSON déjà mesuré, écrivent du HTML) étaient classés « bancs à déplacer » sur du
  VOCABULAIRE — `bench`, `p99`, `médiane` — alors que le même fichier appliquait déjà « on exige
  un APPEL » à docker et au serveur. Une heuristique qui juge sur les mots condamne le code qui
  PARLE du sujet. [1× — 08-25]

- **La moulinette des skills a trouvé deux défauts que je n'aurais pas vus** : une description à
  1396 caractères pour un plafond de 1024, et un auto-contrôle livré une heure plus tôt que AUCUN
  SKILL.md ne citait — donc que personne n'aurait jamais lancé. Le réflexe « je viens de livrer, je
  passe le gate du dépôt » vaut mieux que n'importe quelle relecture. [1× — 08-24]

- **`anchor-check.mjs` existait, résolvait chaque ancre `fichier:ligne` contre le code, et n'était
  branché NULLE PART** — ni CI, ni script npm : une ligne dans un `SKILL.md`. Passé sur le corpus,
  il a sorti **481 SUSPECT et 8 ancres pointant dans le vide**, dont deux vers un
  `rollup.config.ts` supprimé à la migration rolldown. L'outil était bon depuis le début ; ce qui
  manquait, c'est qu'il TOURNE. Réflexe : quand un dépôt contient un contrôle qui n'est appelé par
  aucun workflow ni aucun script, c'est un défaut à part entière — le brancher AVANT d'en écrire un
  autre. [1× — 08-23b] ↝ [[feedback_gate_must_bite]]
- **Et le brancher exige de mesurer ce qu'il rendrait d'abord** : tel quel il aurait rendu la CI
  rouge (481 SUSPECT). Il ne mord que sur l'indiscutable (fichier introuvable, ligne au-delà de la
  fin) ; les dérives sont rapportées sans échouer, sinon la CI rougirait à chaque refactor honnête.
  Un gate qu'on branche sans mesurer son verdict actuel est un gate qu'on désactivera la semaine
  suivante. [1× — 08-23b]

- **Un outil cassé depuis longtemps, que personne n'appelait.** L'aperçu HTML d'une page de doc
  importait un paquet absent du dépôt : il échouait sur « module introuvable » à chaque invocation —
  invocations qu'il n'y avait plus. Il portait en outre son PROPRE moteur de rendu, donc l'aperçu ne
  montrait pas ce qui serait publié. Supprimé, remplacé par une option du générateur du site. Un
  outil qu'on ne lance jamais ne se contente pas de dormir : il POURRIT, et on s'en aperçoit le jour
  où on compte dessus. [1× — 08-24]
- **Un gate ROUGE EN PERMANENCE ne garde rien non plus — on apprend à lire son rouge.** `format:scaffold` échouait depuis toujours sur des cas dits « structurels connus » ; personne ne relisait la liste. `App.tsx` y a accumulé **onze** écarts invisibles, livrés tels quels à qui générait une app. Le remède n'est pas de supprimer le gate mais de le rendre capable de VERT : il CONSTATE qu'une non-conformité dépend du nom (sa ligne fautive porte le nom de l'app), la nomme, et n'échoue que sur le reste. [1× — 08-25]

## 🎯 Une ancre PLAUSIBLE et fausse coûte plus cher qu'une ancre visiblement périmée

- **Une preuve d'ABSENCE collée à une ancre salit l'ancre** [1× — 08-27] : « `fichier:ligne` — aucun `X` nulle part » fait chercher `X` autour de la ligne pointée, qui ne l'a évidemment pas. L'ancre était juste ; corriger son numéro l'aurait cassée. L'absence se met sur sa PROPRE ligne, écrite comme une commande qui la rend observable.
- **Un chiffre de pilotage jamais confronté dérive d'un ordre de grandeur** [1× — 08-27] : le champ `Jours` vaut ×8 le temps constaté — non par négligence, mais parce que l'unité est calibrée sur quelqu'un qui code à la main. Un ticket surestimé se REPORTE, et le report fait repayer tout son contexte. Mesuré seulement parce que le user a relevé « 0,5 j pour 30 minutes ».

- **Un KIT de chantier lu comme un ÉTAT : 9 items sur 11 étaient DÉJÀ FAITS.** Le tableau de bord
  avait été dégraissé la veille pour cette raison exacte ; les kits de la mémoire de travail, eux,
  continuaient d'annoncer du reste-à-faire livré depuis des semaines — commandes d'état et d'arrêt,
  révocation de session, administration des utilisateurs, deux consoles, repli d'interface, arbre de
  process sous Windows, et jusqu'au « bug WebSocket à 30 s », qui ne se reproduit pas sur 48 s
  d'observation. Sans le contrôle exigé par le user, 8 tickets naissaient pour du travail fait. Un
  kit est un PLAN : il dit ce qu'on voulait faire, jamais ce qui est. Le confronter au code et au
  `git log` AVANT d'en tirer quoi que ce soit. [1× — 08-27]
- **`gh project item-list` a rendu 39 items quand l'API en comptait 40** — le ticket ajouté à la
  minute était absent de sa sortie, sans erreur ni avertissement. Ce qui a tranché : redemander la
  MÊME donnée par GraphQL. Même famille que le champ `title` figé : ce client rend une vue à lui,
  pas l'état du tableau. Pour lister ou retrouver un item, GraphQL ; `item-list` pour un coup
  d'œil, jamais pour décider. [1× — 08-27]
- **Un renvoi « cf #9 » dans un corps de ticket pointait une demande de fusion de dépendances**,
  pas une issue. Un renvoi mort ressemble exactement à un renvoi vivant : un numéro existe
  toujours. Vérifier ce que DÉSIGNE le numéro, pas qu'il résolve. [1× — 08-27]
- **`rg` saute les dossiers cachés sans `--hidden`** : un relevé « qui appelle ce script ? » a rendu
  zéro appelant alors que `.claude/skills/` en contenait. Un relevé incomplet a l'air d'un relevé
  complet. [1× — 08-27]

- [1× — 08-27] **Un champ DÉRIVÉ d'une API peut être figé sur une valeur morte — et il a l'air
  d'une réponse.** `gh project item-list` rend un `title` par item : **38 sur 38** portaient encore
  l'ancien libellé de leur issue, renommée le matin même. J'ai failli annoncer au user que son
  tableau de bord était périmé. Ce qui a tranché en dix secondes : redemander la MÊME donnée par
  l'autre voie — GraphQL rend le titre courant, donc l'affichage est juste et c'est le champ du
  client qui ment. **Devant une valeur surprenante, chercher une SECONDE voie vers la même donnée
  avant d'accuser la source** ; et préférer par défaut le champ qui pointe l'objet réel
  (`.content.title`) à celui que l'outil a recopié (`.title`).
- [1× — 08-27] **Une substitution de texte SANS frontière de mot fabrique des faux positifs qui
  ont l'air d'un travail bien fait.** Un motif `ADR` sans limite a mordu sur « c**adr**e », `store`
  sur « re**store** » : le ticket recevait un lexique définissant des mots qu'il n'employait pas —
  et un lexique hors sujet est pire que pas de lexique, il fait douter le lecteur d'avoir compris.
  Même mécanisme pour la ZONE lue : détecter les termes sur le corps entier a posé sur un ticket de
  libellés de menu un lexique « surcharge, isomorphe, ADR », mots pris dans des **exemples cités**.
  Deux réflexes, à poser AVANT de lancer la passe : borner la zone (ici le seul bloc « Le
  problème », citations retirées) et exiger `(?<!\p{L})…(?!\p{L})` autour de tout motif.
- [1× — 08-27] **Un remplacement mot à mot ne sait pas ACCORDER — le genre entraîne le
  déterminant.** « aucun binding » est devenu « aucun liaison », « Le drift » → « Le dérive ». Une
  liste de couples anglais→français doit porter les formes AVEC article (`un binding → une
liaison`), essayées avant les formes nues. Et un motif qui porte du gras (`un **breaking
change**`) doit être échappé AVANT que ses espaces deviennent souples, sinon l'expression
  régulière ne se construit même pas. Le contrôle qui rattrape tout en une ligne : après la passe,
  chercher `(un|le|ce|aucun) (liaison|dérive|surcharge|route|rupture)` et l'inverse.
- **`anchor-check` a validé une ancre devenue fausse.** J'avais inséré 30 lignes dans
  `envReport.ts` ; l'ancre `envReport.ts:147` de la doc pointait désormais une AUTRE fonction, et
  le gate a rendu « 6 ancres — 6 OK ». Il vérifie que le fichier existe et que la ligne est dans
  ses bornes, pas que la ligne désigne encore ce que la phrase annonce. **Après toute insertion
  dans un fichier ancré, relire les ancres soi-même** — le vert du gate ne couvre pas ce
  cas. [2× — 08-24d]

- **Ma propre correction a introduit 7 `LINE_OUT`.** `anchor-check` résout par BASENAME, et il
  existe un autre `config.ts` (234 lignes) et un autre `bearer.ts` (23 lignes) que ceux que je
  visais : mes ancres neuves pointaient le mauvais fichier, en étant parfaitement crédibles. C'est
  le gate qui me l'a dit. Depuis, le vérificateur rejette toute ancre dont le basename correspond à
  plus d'un fichier — un `index.ts` en a matché **57**. [1× — 08-23b]
- **Corollaire de tri** : recaler n'est pas toujours améliorer. Viser la déclaration d'un symbole
  générique (`router?: Router;`) ferait reculer une ancre d'un point précis vers un simple typage,
  parfois 900 lignes plus haut. Écarté volontairement — visiblement décalé vaut mieux que plausible
  et faux. [1× — 08-23b]

## 🤝 Un sous-agent répond « INCHANGÉE » quand chercher devient pénible

- **Le verdict « en fait livré » se déclenche dès qu'une PARTIE du travail existe.** Sur 48 lignes
  de feuille de route confrontées au code, 26 rendues « livrées » — plusieurs contredites par les
  remarques du même relevé (« reste à généraliser », « bug CLI ⬜ »). Le même biais a classé
  « corrigée » une dette qui ne l'était pas, en se fondant sur le seul module du lot qui l'était,
  ce que la ligne indiquait déjà. La question qui manque : _TOUT_ le travail décrit est-il là ?
  Corollaire : ne jamais appliquer un lot de verdicts délégués sans recontrôler ce qu'on va
  changer — les 4 « corrigées » recontrôlées ont livré 1 faux. [1× — 08-27]

- **Trois lots sur quatre ont classé la majorité des cas difficiles « INCHANGÉE — contexte correct
  pour le concept ».** J'ai répercuté ce verdict tel quel, en concluant « faux positifs pour
  l'essentiel ». Un échantillon tiré au hasard a rendu **6 sur 6 FAUX**. La complaisance ne se voit
  pas : la réponse est plausible, motivée, et arrive vite. Réflexe : sur un lot délégué, TIRER AU
  SORT quelques items et les vérifier soi-même avant de croire la proportion annoncée — c'est le
  seul contrôle qui distingue « rien à faire » de « l'agent n'a pas cherché ». [1× — 08-23b]
- **Un sous-agent s'est aussi trompé sur un fait simple** (`SLOW_CONSUMER_BYTES` déclaré disparu
  alors qu'il est défini `RealtimeHub.ts:63`). Un vérificateur AUTOMATIQUE — la ligne proposée
  contient-elle la preuve annoncée ? — a rejeté 7 propositions sur 77 sans rien lire. Déléguer la
  RECHERCHE, garder l'ÉCRITURE, et intercaler un automate entre les deux. [1× — 08-23b]

## 🪤 Une garde peut EMPÊCHER ce qu'elle prétend gérer

- **Une garde MORTE-NÉE : `try/catch` autour d'un `import` STATIQUE.** Le shim `create-nodefony`
  protégeait l'absence de `nodefony` par un `try` autour de l'appel — Node résout les imports
  statiques AVANT la première ligne du module, donc le `catch` n'était jamais atteint et
  l'utilisateur recevait une trace de pile interne. `await import()` dans le `try`. Trouvée en
  DÉBRANCHANT le paquet, jamais en relisant. `[1× — 08-25]`

- **Enregistrer un handler `SIGTERM` a rendu le banc IMMORTEL.** Le filet d'arrêt ne pouvait pas
  s'exécuter — ce script vit dans des `spawnSync` qui BLOQUENT la boucle d'événements, et un
  handler de signal est un callback JS. Pire : l'enregistrer DÉSACTIVE la mort par défaut. Sans
  handler, `SIGTERM` tuait le process (en laissant le serveur) ; avec, ni arrêt ni nettoyage —
  `SIGKILL` obligatoire. Le nettoyage a été déplacé à l'ENTRÉE du run suivant, là où la boucle
  tourne. [1× — 08-23b]
- **Et ma première mesure du correctif était un FAUX VERT** : le port était bien rendu après le
  `SIGTERM`, mais par la remise à zéro du décor qui tombait au même instant. Le verdict était juste
  pour la mauvaise raison. C'est en regardant si le PROCESS avait survécu — une seconde question,
  sur un autre observable — que le vrai défaut est apparu. Une sonde qui n'observe qu'un symptôme
  confirme n'importe quelle cause. [1× — 08-23b] ↝ [[feedback_bench_probe_false_verdicts]]

## 🔇 Ce qu'on COUPE pour mesurer, on le coupe aussi pour DIAGNOSTIQUER

- [1× — 08-25] **Un `tail -200` qui se fait passer pour le journal.** Sur un serveur qui
  journalise chaque requête, 200 lignes couvrent TROIS secondes : l'échec du milieu de suite n'y
  était pas. J'en ai conclu que la trace était perdue et j'ai renoncé au diagnostic — alors que
  le journal ENTIER était publié en artefact depuis toujours, au step suivant. Un aperçu doit
  DIRE qu'il est un aperçu et où est le complet ; sinon il ne tronque pas seulement la sortie,
  il tronque la recherche.

- [1× — 08-23e] Un banc de performance pose `NF_LOG_DRIVER=null` pour ne pas mesurer le coût des
  journaux. Le jour où le serveur n'a pas démarré, il n'a su dire que « BOOT TIMEOUT — voir
  /tmp/nf-bench.log », en renvoyant vers un fichier de **zéro octet**. La cause tenait en une ligne
  `CRITIC`, invisible par construction. Un réglage qui protège la MESURE aveugle le DIAGNOSTIC :
  prévoir, sur le chemin d'échec, un rejeu sans ce réglage — on n'y arrive que quand il n'y a plus
  rien à mesurer.

## 👯 Un JUMEAU non vérifié n'est pas vérifié — « aligné » n'est pas « prouvé »

- [1× — 08-23e] Deux scripts de banc portent en en-tête « à garder alignés ». J'ai appliqué le même
  correctif aux deux, puis validé la sortie JSON **d'un seul**. L'autre ajoutait cinq `%s` au format
  sans les arguments correspondants et produisait du JSON invalide (`"warmupSec":,"durSec":,`) —
  découvert seulement parce qu'un consommateur a refusé de le lire, plusieurs heures après.
  **Prouver sur un artefact ne prouve rien sur son jumeau**, et un `printf` mal alimenté ne lève
  jamais : il écrit un trou. ↝ [[feedback_prove_on_received_artifact]]

## 📖 Une DOC qui enseigne un geste dangereux le propage — et survit à sa correction

- [1× — 08-27] **Un code de planification interne dans un titre n'est pas une abréviation, c'est un
  pointeur MORT.** « exécuter R6 », « S5 DDL prod » : le lecteur n'a pas le document derrière, donc
  le titre ne lui dit rien — reproche direct du user, deux fois dans la même session (« S ?? n'a
  rien à faire dans un titre », « un idiot doit comprendre »). Vaut pour tout artefact qui SORT de
  ma tête : ticket, message de commit, page publiée. Le test tient en une question — quelqu'un qui
  n'a jamais ouvert ce dépôt sait-il ce dont on parle ? Si la réponse exige d'aller chercher un
  tableau de bord, c'est raté. Et le sigle qui reste nécessaire (DDL, TOTP) se DÉFINIT sur place.
- [1× — 08-25] **Une source qui fait autorité peut être PÉRIMÉE, et le dire avec aplomb.** Le guide
  npm de l'OpenSSF recommande encore d'authentifier une publication par un jeton d'automatisation
  — retirés du registre depuis novembre 2025, et remplacés par la publication de confiance
  précisément parce que ces jetons étaient le vecteur des vols de compte. La doc du dépôt, elle,
  était à jour. Une source externe se DATE avant d'être suivie ; ici, c'est le dépôt qui avait
  raison contre la référence.

- [1× — 08-23e] Après avoir corrigé une purge de ports qui tuait son propre lanceur, la même
  commande restait **enseignée** dans la table de dépannage d'un autre skill (`lsof -ti:PORT |
xargs kill -9`) — c'est-à-dire exactement ce qu'un agent lit puis applique. Elle venait d'un retex
  de juillet dont la leçon était JUSTE (les orphelins échappent à `pkill -f`), à un mot près.
  Corriger le code sans balayer ce qui l'ENSEIGNE laisse la classe de bug se réintroduire par la
  documentation. Le balayage se fait sur le CONCEPT, pas sur le fichier corrigé.

## 👻 Un process qui n'écoute AUCUN port échappe à toute purge par port

- [1× — 08-23e] Un superviseur de développement orphelin (son enfant tué en `-9`) survit sans tenir
  le moindre port : invisible à `lsof`, absent d'un `pkill -f bin/nodefony` (son titre de process est
  autre), et pourtant bien vivant. Deux conséquences opposées le même soir — il **interdisait** tout
  démarrage en production (garde qui déduisait la collision d'une présence au lieu de la constater),
  et il **ressuscitait** le serveur au milieu d'une mesure. Un décor de banc se remet à zéro par
  l'arrêt PROPRE de l'outil (`nodefony stop`), la purge par port n'étant que le filet.

## 🗄️ Archivé au CONSOLIDATE du 2026-07-30 — 59 thèmes, 190 frictions

Snapshot : `archive/RETEX-snapshot-2026-07-30.md`.
