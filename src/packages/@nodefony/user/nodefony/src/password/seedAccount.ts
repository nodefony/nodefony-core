/**
 * Le **semis d'un compte au démarrage** — une règle, appelée par toutes les
 * applications au lieu d'être recopiée dans chacune.
 *
 * Le gabarit `create app` et le dépôt de développement du framework semaient
 * chacun leurs comptes avec leur propre copie de la logique, et ces copies
 * avaient déjà divergé. Or le gabarit est COPIÉ chez l'utilisateur à la
 * génération : un correctif écrit dans le gabarit n'atteint jamais une
 * application déjà générée. Écrite ici, la règle se met à jour avec
 * `@nodefony/user`.
 */
import type { UserService } from "../../service/UserService";
import { describeSeedFailure } from "./seedFailure";

/** Sévérités qu'un semis émet : un refus (`ERROR`) ou un avis (`NOTICE`). */
export type SeedLogSeverity = "ERROR" | "NOTICE";

/**
 * Où le semis écrit ce qu'il a à dire. L'appelant l'adresse à son journal
 * (`(m, s) => module.log(m, s, "USERS")`) : ce paquet ne connaît pas le
 * syslog du noyau.
 */
export type SeedLog = (message: string, severity: SeedLogSeverity) => void;

/** Un compte à semer, et de quoi expliquer ce qui lui arrive. */
export interface ISeedAccountRequest {
  /** Identifiant du compte (`"admin"`). */
  identifier: string;
  /** Rôles à plat. */
  roles: string[];
  /** Variable d'environnement qui porte le mot de passe (`"NF_ADMIN_PASSWORD"`). */
  envVar: string;
  /** Valeur lue dans {@link envVar} — `undefined` quand elle n'est pas posée. */
  envValue: string | undefined;
  /**
   * Mot de passe à prendre quand {@link envVar} n'est pas posée. `null` = aucun
   * défaut : le compte n'est pas créé (c'est la règle de la production, où un
   * mot de passe écrit dans le code serait public).
   */
  fallbackPassword: string | null;
  /** Compte d'administration (décide du `--admin` du remède). */
  admin?: boolean;
}

/**
 * Ce que le semis a fait — l'appelant en tire son propre message quand il en
 * a un à dire (`"no-password"` en production, par exemple).
 *
 * - `created` : le compte n'existait pas, il a été créé ;
 * - `exists` : le compte existait, rien n'a été écrit ;
 * - `no-password` : ni variable ni défaut, rien n'a été créé ;
 * - `failed` : la création a été refusée, le refus est journalisé en `ERROR`.
 */
export type SeedOutcome = "created" | "exists" | "no-password" | "failed";

/**
 * Sème un compte s'il n'existe pas — et ne réécrit JAMAIS un compte existant.
 *
 * Un compte déjà en base garde son mot de passe : le reprendre de la variable à
 * chaque démarrage écraserait celui que l'utilisateur a changé. Mais la
 * variable posée est alors ignorée, et l'exploitant qui vient de la modifier
 * croit avoir changé le mot de passe. Ce cas s'annonce donc en `NOTICE` — pas
 * une erreur : le démarrage est sain —, avec le geste qui change vraiment le
 * mot de passe.
 *
 * Un semis raté ne lève pas : amorcer un compte est un confort, et une
 * application sans compte démarre. Le refus part en `ERROR` (voir
 * {@link describeSeedFailure}).
 *
 * @param users - service utilisateur branché sur son dépôt.
 * @param request - le compte à semer.
 * @param log - où écrire l'avis ou le refus.
 * @returns ce que le semis a fait.
 */
export async function seedAccount(
  users: UserService,
  request: ISeedAccountRequest,
  log: SeedLog,
): Promise<SeedOutcome> {
  const { identifier, envVar, envValue, admin = false } = request;
  const fromEnv = envValue != null;
  if (await users.findByIdentifier(identifier)) {
    if (fromEnv) {
      log(describeIgnoredSeedPassword(identifier, envVar), "NOTICE");
    }
    return "exists";
  }
  const password = envValue ?? request.fallbackPassword;
  if (password == null) {
    return "no-password";
  }
  try {
    await users.createUser({
      identifier,
      plainPassword: password,
      roles: request.roles,
    });
    return "created";
  } catch (e) {
    log(
      describeSeedFailure(e, { identifier, envVar, fromEnv, admin }),
      "ERROR",
    );
    return "failed";
  }
}

/**
 * Rédige l'avis d'une variable de mot de passe ignorée parce que le compte
 * existe : QUELLE variable, POURQUOI elle ne sert à rien, QUEL geste.
 *
 * Le message ne porte jamais la valeur de la variable : il finit dans un
 * journal.
 *
 * @param identifier - compte déjà en base.
 * @param envVar - variable posée, et ignorée.
 * @returns le message à journaliser, sans saut de ligne.
 */
export function describeIgnoredSeedPassword(
  identifier: string,
  envVar: string,
): string {
  return (
    `${envVar} est posée mais IGNORÉE : le compte "${identifier}" existe ` +
    `déjà, et cette variable ne sert qu'à le créer — elle ne change jamais un ` +
    `mot de passe en base. Pour le changer : \`npx nodefony ` +
    `security:user:password ${identifier}\`. Retirer la variable fait taire ` +
    `ce message.`
  );
}
