# Un écran qui se met à jour tout seul

> Détail chargé à la demande depuis le `SKILL.md` (§ « Un écran qui se met à jour tout seul »). Vérité courante — éditer en place, historique = `git log`.

- **Un widget temps réel est invisible tant qu'il ne se passe rien.** Format par paliers (jamais
  une valeur qui saute de millisecondes à secondes), `font-variant-numeric: tabular-nums` sur
  tout nombre qui change, aucune animation rejouée à chaque tick, `prefers-reduced-motion`
  respecté, et un contrôle pause/fréquence dès que ça bouge seul plus de 5 s (WCAG 2.2.2).
  **Le test** : fixe l'écran 30 secondes — rien ne doit bouger sans cause.
- **N'anime que `transform` et `opacity`** ; `contain: content` sur chaque widget vivant,
  `content-visibility: auto` sur les longues listes.
- **Accessibilité, le minimum qui se vérifie à l'œil** : un seul `<h1>` par page, `aria-label`
  sur tout bouton-icône, `aria-expanded` sur tout bascule, `aria-live` sur les zones qui changent
  seules, `role="img"` + `aria-label` sur un graphe SVG, jamais une information portée par la
  **couleur seule**, `rel="noopener noreferrer"` sur les liens externes.

- **Une route d'API répond du HTML** : un repli SPA générique avale les routes voisines — le
  premier motif qui correspond gagne. Déclare la route de la page monopage avec
  `fallback: true` : elle ne sert alors que ce qu'aucune autre route ne sert, quel que soit
  l'ordre. `npx nodefony inspect routes --json` montre l'ordre réel.
- **Des utilisateurs « déconnectés au hasard »** : le traitement global « 401 = session expirée »
  frappe aussi la connexion refusée (un mauvais mot de passe rend 401) — et détruit une session
  valide. Exempte les routes d'authentification du traitement global. `me` ne renvoie jamais
  401 : il répond toujours 200, `{ user: null }` sans session.
- **La connexion ne s'écrit pas en `fetch`** : `/login` est servie ; la liaison du front
  (`useNodefonyLogin`…) porte `me()` et `logout()` — suis l'adresse que rend `logout()`, sinon
  la session Keycloak reste ouverte. Détail : skill `nodefony-authentication`.
- **Ta page répond 200 et son script ne s'exécute pas** : la politique de contenu exige un `nonce`
  sur les scripts, et le navigateur refuse un `<script>` en ligne qui n'en porte pas (« Refused to
  execute inline script »). Un `curl` ne le voit JAMAIS, il ne lit que le corps. Signe le script
  (valeur `this.context?.cspNonce`) ou sors-le dans un fichier servi ; ne desserre PAS la politique.
- **Une image, une police ou une API tierce est bloquée** (« violates the following Content
  Security Policy directive ») : AJOUTE l'origine exacte par `headers.cspSources` de
  `@nodefony/security` (`{ cdn: { "img-src": ["https://cdn.example.com"] } }`), ou sur la seule
  route qui en a besoin par `@Csp` — ne réécris pas `headers.csp`. Une socket servie depuis une
  AUTRE origine se déclare par `realtime.publicOrigin`. Ce que les navigateurs ont bloqué se lit,
  en administrateur, sur `GET /nodefony/security/api/csp-reports` (`headers.cspReport`) — Brave
  n'envoie aucun rapport, éprouve sous Chrome ou Firefox.
- **En production, la modification front n'apparaît jamais** : hors développement il n'y a PAS de
  rechargement à chaud, et le manifeste est lu AU BOOT. `npm run build`, puis **redémarre le
  serveur**, puis rechargement forcé.
