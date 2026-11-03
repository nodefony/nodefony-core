# CSP — index hors ligne

Copies figées par page (`AMONT.json`, suivies par `check-amont.mjs`). Les specs W3C sont les
sources **Bikeshed** brutes (`.bs`) : le texte normatif, sans le rendu HTML. Chercher au `rg`,
jamais lire en entier (`w3c-csp3.bs` pèse 226 Ko).

| Ce qu'on veut savoir                                                                     | Fichier                                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| La norme : directives, sources, nonces, `'strict-dynamic'`, repli, plusieurs politiques  | `w3c-csp3.bs`                                                |
| `require-trusted-types-for`, `trusted-types`, politiques et puits                        | `w3c-trusted-types.bs`                                       |
| `report-to`, groupes de points de rapport, en-tête `Reporting-Endpoints`, charge envoyée | `w3c-reporting.bs`                                           |
| `upgrade-insecure-requests` : ce qui est réécrit, navigation comprise                    | `w3c-upgrade-insecure-requests.bs`                           |
| La recommandation de l'OWASP (politique stricte, repli, pièges)                          | `owasp-csp-cheat-sheet.md`                                   |
| « Strict CSP » nonce + `'strict-dynamic'` et son repli CSP2 (dépôt web.dev ARCHIVÉ)      | `webdev-strict-csp.md`                                       |
| Vue d'ensemble pédagogique                                                               | `mdn-guide-csp.md`, `mdn-header.md`                          |
| Une directive : syntaxe, exemples, pièges                                                | `mdn-<directive>.md`                                         |
| **Quel navigateur supporte quoi, depuis quelle version**                                 | `bcd-content-security-policy.json` (`jq`, jamais `Read`)     |
| MCP Apps : CSP déclarée par ressource UI (`_meta.ui.csp`), défaut restrictif de l'hôte   | `mcp-apps-2026-01-26.mdx`, `mcp-apps-csp-cors.md`            |

Les specs MCP 2026-07-28 (cœur) et A2A 1.0.1 ne parlent pas de CSP : leurs échanges sont de
serveur à serveur, ou d'une page vers une autre origine, ce qui relève de `connect-src` côté page
et de CORS côté serveur.

Compatibilité d'une directive, sans ouvrir le fichier :

```bash
jq -c '.http.headers["Content-Security-Policy"]["strict-dynamic"].__compat.support
  | {chrome,firefox,safari,safari_ios}
  | map_values(if type=="array" then .[0].version_added elif type=="object" then .version_added else . end)' \
  .claude/skills/nodefony-rfc/references/csp/bcd-content-security-policy.json
# {"chrome":"52","firefox":"52","safari":"15.4","safari_ios":"mirror"}
```

Les directives sont au premier niveau (`["frame-ancestors"]`, `["strict-dynamic"]`) ; `"mirror"`
= même version que le moteur parent.
