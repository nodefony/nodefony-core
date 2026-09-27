/**
 * Variables par lesquelles git redirige une commande vers UN AUTRE dépôt que
 * celui du répertoire courant. Git les pose lui-même pendant un commit, pour
 * ses hooks (`GIT_INDEX_FILE` pointe l'index TEMPORAIRE du commit en cours).
 */
const REDIRECTING_GIT_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
] as const;

/**
 * Environnement d'un git lancé sur un dépôt DIFFÉRENT de celui qui l'appelle
 * — l'application que `nodefony create` vient d'écrire, par exemple.
 *
 * Sans lui, un `create app` lancé depuis un hook de commit hérite de
 * `GIT_INDEX_FILE` : son `git add -A` écrit l'arbre de l'application neuve
 * dans l'index du commit EN COURS du dépôt appelant, avec des objets que ce
 * dépôt ne possède pas (vécu : `invalid object … for .github/workflows/ci.yml`,
 * commit refusé).
 *
 * @param env - environnement de départ (défaut : celui du processus)
 * @returns une copie sans aucune variable de redirection git
 */
export function isolatedGitEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const name of REDIRECTING_GIT_VARIABLES) delete out[name];
  return out;
}
