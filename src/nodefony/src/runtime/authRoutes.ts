/**
 * Route de connexion par session du framework : `POST` avec `{username, password}`.
 *
 * Elle est MONTÉE par `mountSessionAuthRoutes` (module framework), mais on la
 * cite partout ailleurs : la commande qui crée un compte, l'indice d'identité
 * d'une route gardée, l'outillage `nodefony/testing`, les tests générés d'une
 * application. Chacun la recopiait en littéral, et la copie qui part chez
 * l'utilisateur était précisément celle que rien ne surveillait.
 *
 * Elle vit donc ici, dans le seul paquet que tous importent. Le monteur, lui,
 * est confronté à cette valeur par un test du module security ; les gabarits
 * qui ne peuvent pas l'importer (code navigateur, workflows, `AGENTS.md`) le
 * sont par un test du cœur qui exige que toute écriture de la route égale
 * celle-ci.
 */
export const AUTH_LOGIN_PATH = "/nodefony/security/api/auth/login";
