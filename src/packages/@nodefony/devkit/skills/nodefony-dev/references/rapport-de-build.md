# Le rapport de build — ce que pèse ce que tu bâtis

> Chargé depuis `nodefony-dev` §10, quand un changement touche ce que le build produit.

Chaque build (`npm run build` : serveur ET front) écrit, sans rien demander, un rapport sous
`node_modules/.rolldown/report/<dossier de sortie>/` — le chemin relatif au projet, chaque `..`
devenu `__` (le front bâti dans `public/dist` → `node_modules/.rolldown/report/public/dist/`).

- **Quand le lire** : une taille qui change, une dépendance qui entre, un paquet présent en deux
  versions, un build qui ralentit. Pas pour savoir si le build passe : son code de sortie le dit.
- **Comment** : `entry.md` d'abord (une vingtaine de lignes, il nomme le fichier à ouvrir
  ensuite). Pour juger TON changement, épingle la base AVANT de modifier
  (`cp .state.json baseline.json` dans ce dossier), rebâtis, lis `delta.md`. Un chiffre :
  `jq '.metrics["output.total_bytes"]' metrics.json` — ne lis pas les `.json` en entier.
- **Ce qu'il ne dit pas** : ses octets sont comptés AVANT minification et compression, jamais
  un poids réseau ; il ne vérifie aucun type (`npm run typecheck`) ; le mode watch et le serveur
  de développement n'en écrivent pas ; une installation propre l'efface, base comprise.
- **Le couper** (côté serveur) : `defineNodefonyRolldownConfig({ buildReport: false })` dans
  `rolldown.config.ts`.
