## La sécurité, fermée par défaut

Le pare-feu découpe l'application en **zones**, chacune avec sa chaîne d'authentification. Il refuse
plutôt que d'ouvrir : une configuration invalide capture le trafic et répond 401.

|                   |                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| **Identités**     | session serveur pour le web · jetons et clés d'API pour les machines · OAuth2/OIDC · WebAuthn · TOTP |
| **Cryptographie** | Argon2id pour les mots de passe · signatures Ed25519 · secrets chiffrés au repos                     |
| **Défenses**      | CSRF par métadonnées de requête · en-têtes de sécurité · limitation de débit · journal d'audit       |
| **Autorisation**  | hiérarchie de rôles vérifiée au démarrage, refus par défaut                                          |

### Équipe rouge, équipe bleue

Ces briques ne sont pas éprouvées par des cas nominaux — « le login fonctionne » ne prouve rien. Les
campagnes se mènent en **deux passes, et l'ordre est le cœur du dispositif** :

1. **Passe rouge — la menace d'abord.** La matrice d'attaque est construite depuis les standards et
   les faiblesses connues **avant d'avoir lu le code**. C'est un garde-fou contre son propre biais :
   qui lit l'implémentation en premier ne teste que ce qu'elle prévoit, et rate précisément ce
   qu'elle a oublié.
2. **Passe bleue — le code ensuite.** On lit l'implémentation, on couvre les branches restantes,
   on regarde les chemins que la passe rouge n'imaginait pas.
3. **Le cycle.** Faille trouvée → corrigée → **re-prouvée par un test qui échouait avant elle**. Un
   correctif sans son test de non-retour ne compte pas comme corrigé.

Ce qui distingue ces attaques d'un scan générique : beaucoup visent des surfaces **propres à cette
architecture** — les portées de l'injection de dépendances, les messages du pipeline WebSocket
partagé, le jeton porté par le contexte asynchrone, les zones du pare-feu et leurs contournements.
Aucun outil sur étagère ne connaît ces surfaces : il faut concevoir les attaques.

> ⚠️ **À savoir avant de concevoir ton application.** Le refus par défaut opère **par zone du
> pare-feu**, pas route par route : une route située hors de toute zone déclarée est publique.
> Déclare tes zones.
