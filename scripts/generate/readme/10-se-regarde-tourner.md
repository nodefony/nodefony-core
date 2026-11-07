<!-- @if app -->
<% if (it.complete) { %>
<!-- @end -->

## Le framework se regarde tourner

`@nodefony/studio` est une console d'administration livrée avec le framework : topologie du runtime,
journaux en direct avec rejeu, suivi d'une requête de bout en bout par son identifiant, schéma de la
base, graphe des classes par module, gouvernance de la sécurité (audit, pare-feu, rôles, sessions,
clés d'API), et les générateurs de code pilotables à la souris, la sortie diffusée comme un terminal.

<img src="docs/assets/studio-supervision.png" alt="Supervision du runtime dans la console d'administration" width="100%">

Sa force est en dessous : **elle ne consomme aucune API privée.** Toutes ses données viennent d'un
plan de données JSON protégé par les mêmes règles d'accès que le reste, **auto-décrit** — un appel en
renvoie le catalogue — et **duplex** : le même point d'accès répond en HTTP et par la socket. Ce
qu'affiche la console, un script ou un agent peut le lire tel quel.

Le suivi d'une requête en est l'illustration la plus directe : chaque requête porte un identifiant
propagé dans tout le pipeline, et la console rejoue son trajet complet — phases, requêtes de base de
données, décisions du pare-feu.

<img src="docs/assets/studio-request.png" alt="Suivi d'une requête de bout en bout par son identifiant" width="100%">

<!-- @if app -->
<% } %>
<!-- @end -->
