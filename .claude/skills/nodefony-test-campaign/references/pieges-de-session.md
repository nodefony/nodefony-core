# Les pièges d'une passe complète — symptôme, cause, geste

> **Maintenance** : édition en place. Chaque entrée a été payée au moins une fois ; une entrée se
> retire quand le produit ou l'outil la rend impossible, jamais parce qu'elle « ne devrait plus
> arriver ». Aucune date, aucun chiffre de mesure — l'histoire vit dans `git log`.

Ce fichier n'énumère pas des incidents : il énumère les **façons dont une passe de test ment**. Le
point commun de presque toutes : l'instrument rend un verdict que rien ne contredit, et on le croit.

## 1. Le verdict qu'on ne lit pas

### Un code de sortie avalé par un tuyau

**Symptôme** — une tâche de fond annonce « exit 0 » ; le journal, lui, contient des échecs.
**Cause** — `cmd | tee fichier` rend le code du DERNIER maillon. `tee` réussit toujours.
**Geste** — `cmd > fichier 2>&1; echo "EXIT=$?" >> fichier`, puis lire cette ligne. Ne jamais
conclure sur le code rapporté par un enchaînement qui contient un tuyau.

### Un total vert qui ne porte sur rien

**Symptôme** — « ✅ N passés », et pourtant la régression sort en production.
**Cause** — un banc sauté compte comme vert. Une variable d'infra absente ne lève pas : elle
désarme une suite entière.
**Geste** — lire le bloc du `gateReporter` et « Interrupteurs fermés » AVANT le total. Le compte
qui informe est celui des tests **sautés**, pas des passés.

### Une couverture annoncée sur le mauvais périmètre

**Symptôme** — un contrôle rend « ✅ 1 fichier » sur un lot de huit.
**Cause** — le contrôle filtrait sur une extension, et le lot en comportait d'autres.
**Geste** — la couverture se lit sur le **NOMBRE d'éléments annoncé**, jamais sur le verdict. Un
vert dont on ignore l'assiette n'est pas un vert.

## 2. Le rouge qui n'appartient pas au produit

### La saturation, premier suspect

**Symptôme** — des échecs par timeout, dispersés sur des modules sans rapport, souvent en grappe.
**Cause** — la passe complète fait tourner des dizaines d'espaces de travail en parallèle ; les
délais écrits en dur sautent sans que rien ne soit cassé. Un fork de worker qui attend « prêt » en
quelques secondes n'y arrive plus.
**Geste** — rejouer le cas SEUL. S'il passe, c'est de la saturation. Le noter, et si le cas est
récurrent, le ticket vise le **délai en dur**, pas le code testé.
**Ne pas** — relever le délai pour faire taire le rouge : le même cas reviendra sur une machine
d'intégration plus lente.

### L'état partagé qui s'accumule

**Symptôme** — un test passe pendant des semaines, puis échoue un jour sans qu'aucun code n'ait
changé ; souvent sur un garde-fou de boucle ou de pagination.
**Cause** — un magasin partagé (Redis, base, dossier temporaire) accumule les résidus des runs
précédents. Le test parcourt alors un espace de clés qui n'a plus rien à voir avec ce qu'il a créé.
**Geste** — demander le compte (`redis-cli INFO keyspace`, un `COUNT`, un `ls | wc -l`), purger la
famille concernée, rejouer. Un test qui repasse en une fraction du temps précédent confirme.
**Le signe qui met sur la voie** : le test lui-même documente souvent sa dépendance au décor, dans
un commentaire que personne ne relit.

### Le décor qui n'est pas celui que le banc suppose

**Symptôme** — `ECONNREFUSED`, `404` sur toutes les routes, « 1 worker(s) servent (≥2 attendu) ».
**Cause** — serveur requis et absent, serveur présent et interdit, variable de décor non posée,
cluster attendu là où tourne un mono-process.
**Geste** — le classement d'un banc se **vérifie en le lançant**, jamais en le lisant. Un tableau
de décors se périme silencieusement à chaque refactor.

### Deux serveurs sur le même port

**Symptôme** — une application se dit prête, publie ses ports, et rien ne lui arrive ; les tests
d'une application interrogent le serveur d'une autre.
**Cause** — sur macOS et les BSD, `127.0.0.1:P` et `*:P` sont deux liaisons distinctes. Le noyau ne
lève pas, la politique de glissement ne se déclenche pas, et c'est la liaison la plus SPÉCIFIQUE
qui reçoit les connexions locales.
**Geste** — arrêter le serveur de développement avant toute passe, et le CONSTATER
(`lsof -nP -iTCP:<ports> -sTCP:LISTEN`), sans se fier au fait qu'on vient de le demander.

## 3. L'instrument qui se retourne

### Le banc périmé

**Symptôme** — échec immédiat et structurel : méthode inconnue, symbole introuvable, import mort.
**Cause** — un refactor du produit non répercuté dans le banc. Ce n'est pas une régression runtime.
**Geste** — retrouver le remplaçant (le graphe symbolique dit dans quel module un symbole a
migré), puis **réparer ou retirer**. Un banc mort cité dans un catalogue coûte plus cher qu'un banc
absent : il fait ouvrir une enquête à chaque passe.

### Le décor prescrit par un fichier, et devenu faux

**Symptôme** — on suit la ligne de commande écrite dans l'entête d'un banc, et le serveur part en
boucle de redémarrage.
**Cause** — l'entête cite une variable que la configuration ne lit plus, ou un montage retiré
depuis. Le message d'erreur du produit, lui, est juste.
**Geste** — croire le message du produit, pas le commentaire ; puis corriger le commentaire dans la
foulée — c'est le moment où on sait ce qu'il faut y écrire.

### Le gate que personne ne lance

**Symptôme** — un contrôle est rouge depuis longtemps, et personne ne l'a su.
**Cause** — il n'existe que comme script npm : aucun workflow, aucun automate ne l'appelle.
**Geste** — vérifier le branchement (`rg` sur son nom dans les workflows) en même temps que le
verdict. Un gate non branché est un gate absent — et un gate **rouge en permanence** est pire :
on apprend à lire son rouge comme « les cas connus ».

### Le client qui rend une vue tronquée

**Symptôme** — un élément qu'on vient de modifier n'apparaît pas dans la liste qu'on relit.
**Cause** — certains clients en ligne de commande omettent des éléments sans le dire, et certaines
requêtes s'arrêtent à une première page silencieusement.
**Geste** — pour DÉCIDER, interroger l'objet précis plutôt que de balayer une liste ; et contrôler
tout compte contre un total demandé, jamais contre la longueur de ce qu'on a reçu.

## 4. Ce qui se répare mal

### Le remède qui change ce qu'on mesure

**Symptôme** — un contrôle redevient vert après correction, mais ne juge plus la même chose.
**Cause** — le remède évident déplace le sujet. Générer une application « sans installation » pour
éviter un accès réseau, par exemple, produit un rendu **non formaté que l'utilisateur ne reçoit
jamais** : le contrôle jugerait alors un artefact qui n'existe pas.
**Geste** — se demander ce que le contrôle est censé JUGER, et si le remède préserve cette chose.
La preuve porte sur l'artefact **reçu**, jamais sur un intermédiaire commode.

### Le correctif qui déclenche un autre gate

**Symptôme** — un commit trivial est refusé par un contrôle sans rapport apparent.
**Cause** — le dépôt tient des listes d'acquittements (« ce script n'est lancé par personne, c'est
su »). Câbler un script le fait sortir de sa liste, et le gate le dit.
**Geste** — lire le refus : il nomme la ligne à retirer. C'est le gate qui fonctionne, pas un
obstacle.

### Citer un ticket dans un commit le fait avancer

**Symptôme** — un ticket qu'on n'a pas commencé passe « en cours ».
**Cause** — un automate de pilotage promeut tout ticket qu'un commit cite sans le fermer.
**Geste** — citer un ticket dans un message uniquement pour dire ce que le commit NE fait pas est
légitime, mais il faut redescendre le statut à la clôture — un statut qui ment est pire qu'un
statut absent.

### Un serveur qui disparaît en cours de mesure, et qu'on prend pour un crash

**Symptôme** — un banc long s'arrête au milieu ; la sonde devient muette, le débit s'effondre sur
la dernière fenêtre, et la mémoire semble « redescendre » — un PLATEAU apparaît dans le verdict.
**Cause** — les modules de développement chargés en production le sont par une dérogation
**MINUTÉE et jamais désarmable** : à son échéance, le runtime s'arrête proprement. Rien n'est
cassé. Et le banc a moyenné la chute dans sa régression, donc son verdict décrit une mort, pas
une courbe.
**Geste** — comparer la durée ÉCOULÉE au TTL posé avant toute autre hypothèse. Régler le TTL sur
la durée RÉELLE et non demandée : une fenêtre de N secondes coûte bien plus que N secondes
(sondes, rafales, GC forcé) — mesuré, 90 minutes demandées en ont pris 153.
**Et le journal ne le dira pas** : un banc de mesure coupe souvent la journalisation du serveur
pour ne pas fausser le chiffre. Ce qu'on coupe pour mesurer, on le coupe aussi pour diagnostiquer.

### Clôturer la session pendant qu'une mesure tourne

**Symptôme** — un banc annonce « DÉCOR NON TENU : la charge machine est montée à N ».
**Cause** — les commits, leurs crochets (formatage, lint, contrôles de skills), un `push`, une
génération d'empreinte : tout cela travaille pendant la mesure.
**Geste** — une mesure longue se lance **en dernier**, après la clôture, ou l'on ne fait
strictement rien pendant. Un décor partagé ne dégrade pas la mesure : **il en change l'objet**.
Vécu en écrivant ce fichier même.

## 5. Les bons signes, qu'on prend pour des échecs

Trois comportements ressemblent à des pannes et sont exactement ce qu'on veut :

- **« Le banc ne mesurerait rien »** — un refus de mesurer sur décor incomplet vaut mieux que
  n'importe quel chiffre.
- **« INDÉTERMINÉ »** sous une durée minimale — une pente extrapolée d'une poignée de minutes
  décrit du bruit, et l'absence de preuve n'est pas une preuve d'absence.
- **« DANS LE BRUIT »** — deux mesures que la variance ne sépare pas ne se classent pas.

Un instrument qui rend un verdict **quoi qu'il arrive** est le seul dont il faut se méfier.
