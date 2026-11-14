# Un contrat, déclaré UNE fois — typer les deux bouts

> Chargé depuis `SKILL.md` §9 dès que navigateur et serveur échangent plus qu'un canal. Règle
> complète : `node_modules/@nodefony/realtime/docs/actions.md` (« Un contrat pour les deux bouts »).

Dès que navigateur et serveur échangent plus qu'un canal : sans contrat, une méthode oubliée
compile puis rend `-32601`. Le contrat est une **interface de types seuls** (0 octet compilé),
dans un fichier partagé que les deux côtés importent :

| Clé de `IRealtimeContract` | Ce qu'elle type                                       | Servie côté serveur par                                                |
| -------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| `serverToClient`           | ce que les canaux publient (gabarit `user:${string}`) | `getRealtimeHub<C>().publish`, `publishToUser`                         |
| `clientToServer`           | ce que le client pousse (`emit`)                      | les entrées                                                            |
| `serverMethods`            | les actions `{ in, out }`                             | la table `realtimeActions()` (une oubliée ne compile pas)              |
| `serverRoutes`             | les routes du pont `"VERBE /chemin"`                  | `static readonly serverRoutes = {…} satisfies ContractRouteSchemas<C>` |

- Navigateur : `NodefonySocket.fromContract<C>({ url })` ; serveur :
  `extends ContractRealtimeController<C>` ; politiques par `@RealtimePolicy` sur la classe (un nom
  hors contrat ne compile pas) — n'ajoute pas `@RealtimeAction` à une méthode de la table.
- Une `Date` arrive en `string` : le contrat lit le type à travers JSON.
- **Le type n'est pas une validation** : la politique et le schéma de route restent les gardes.
- Le contrat complet du chat : `chatContract.ts` de la démo ; la règle : `actions.md` (contrat).
