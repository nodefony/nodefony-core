import {
  getScaffoldContext,
  getScaffoldSpec,
  hydrateQuestion,
  scaffoldCaps,
} from "nodefony";
import type {
  IScaffoldCaps,
  IScaffoldContext,
  IScaffoldTypeSpec,
} from "nodefony";

/**
 * Types de scaffold servis par l'écran « Créer ».
 *
 * `app` en fait partie, avec une différence de nature : les quatre autres modifient le
 * projet COURANT (ils y écrivent et le recâblent), tandis qu'une app naît AILLEURS — dans
 * un espace de travail voisin. D'où sa destination, qui n'est pas une question de plus du
 * formulaire mais une **recomposition côté serveur** sous une racine autorisée (cf
 * `resolveScaffoldDestination` : le client choisit une racine par identifiant et un nom,
 * jamais un chemin).
 */
export const STUDIO_TYPES = [
  "app",
  "module",
  "controller",
  "front",
  "entity",
] as const;

/** Ce que le formulaire reçoit du moteur, pour UN projet. */
export interface IStudioCreateSpec {
  /** Les types servis, questions `optionsFrom` HYDRATÉES par les choix réels du projet. */
  specs: IScaffoldTypeSpec[];
  /** Capacités constatées — pilotent les questions `askIf`. */
  caps: IScaffoldCaps;
  /** Connecteurs, entités, et ce que devient chaque type de champ sur chaque moteur. */
  context: IScaffoldContext | null;
}

/**
 * Compose la matière du formulaire « Créer » pour le projet `projectRoot` — la part
 * du data plane `create/spec` qui dépend du PROJET.
 *
 * Fonction pure au sens du data plane : elle ne lit que le disque du projet, par les
 * fonctions du moteur (mêmes sources que le terminal et `--describe-json`). Extraite
 * du controller pour s'éprouver sur une application SQL ET une application MongoDB,
 * sans serveur : c'est l'ORM qui change la réponse (connecteur, types, capacités).
 *
 * **La même source que le terminal**, et c'est voulu : les deux fronts doivent
 * donner la même réponse à la même question. Studio tourne pourtant dans le
 * serveur démarré — lire ses connecteurs enregistrés y ferait apparaître ceux
 * qu'un module ouvre dans son code, et le terminal ne les verrait pas.
 *
 * @param projectRoot - racine de l'application servie.
 * @returns specs hydratées, capacités et contexte du projet.
 */
export function composeCreateSpec(projectRoot: string): IStudioCreateSpec {
  const context = getScaffoldContext(projectRoot);
  const specs = getScaffoldSpec()
    .filter((s) => (STUDIO_TYPES as readonly string[]).includes(s.type))
    // oxlint-disable-next-line no-map-spread -- la spec du moteur est PARTAGÉE : y écrire les questions hydratées la polluerait pour la requête suivante et pour le terminal
    .map((s) => ({
      ...s,
      questions: s.questions.map((q) => hydrateQuestion(q, context)),
    }));
  return { specs, caps: scaffoldCaps(projectRoot), context };
}
