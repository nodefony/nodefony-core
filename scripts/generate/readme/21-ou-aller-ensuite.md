<!-- @if core,npm -->
## Où aller ensuite

- [Par où commencer](https://nodefony.net/docs/demarrer/) — cinq parcours selon ce que tu viens faire
- [Documentation](https://nodefony.net/docs/) · [Guides](https://nodefony.net/docs/guides/) · [Première application](https://nodefony.net/docs/tutoriels/premiere-application/)
- [L'architecture en vue d'ensemble](https://nodefony.net/docs/architecture/vue-ensemble/) — ce que le framework est, et ce que ses partis pris coûtent
- [Performance](https://nodefony.net/performance/) — ce qui a été mesuré, avec quel
  protocole, et ce que ces chiffres ne permettent pas de conclure ; une page par version publiée,
  dont [la version courante](https://nodefony.net/performance/latest/)
- [Décisions d'architecture](docs/adr/) — les choix structurants et leur pourquoi
- [Signaler une faille](SECURITY.md) — canal privé, jamais en ticket public
- Contribuer : ouvre une issue avant toute contribution substantielle. Le dépôt impose les
  _Conventional Commits_ et un `npm run typecheck` complet avant chaque envoi.
<!-- @end -->

<!-- @if app -->
## Où aller ensuite

- **Ajouter une route** : une méthode décorée `@route` dans un controller — c'est tout.
- **Un état propre à chaque requête** : chaque requête a son propre conteneur de services
  (un scope, posé comme un calque sur celui de l'application et jeté à la fin — en WebSocket,
  à la fin de la connexion). `RequestContext.getScope()` le rend depuis n'importe quel code de
  la requête ; `@injectable({ name: "tenant", scope: "request" })` y crée un service par
  requête, nettoyé (`clean()`) à sa fermeture — son constructeur reçoit le scope :
  `super("tenant", scope, false)`. Détail : `node_modules/nodefony/docs/service.md`.
- **Régler un module sans deviner** : `npx nodefony inspect schema <module>` liste les clés
  configurables avec leur description ; `npx nodefony inspect config` montre ce qui est
  posé aujourd'hui et d'où ça vient. Une clé inconnue est REFUSÉE au démarrage, en la nommant.
- **Régénérer autrement** : `nodefony create app` (interactif) ou
  `--preset <complete|minimal> --frontend <none|react|vue|angular|svelte>`
  `--database <sqlite|postgres|mariadb|mysql>` (scriptable).
<% if (it.complete) { %>- **Protéger une zone** : `use("@nodefony/security", { firewalls: { … } })` dans
  `nodefony.config.ts` (validée Zod au boot, config invalide = échec franc).
- **Canaux temps réel** : le module realtime multiplexe N canaux duplex sur une
  seule socket — voir la doc du framework.
- **Studio** est ta carte du territoire : modules chargés, routes, config
  résolue, sessions, logs — tout ce que le framework sait, il te le montre.
<% } %>
<!-- @end -->
