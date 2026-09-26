/// <reference types="node" />
import { describe, it, expect } from "vitest";
import {
  INSPECT_SUBJECTS,
  readAdminSubject,
} from "../kernel/inspect/adminSubjects";
import { ADMIN_DEFAULT_ROLE } from "../kernel/adminPlane/adminRbac";
import type { IAdminCaller } from "../kernel/adminPlane/adminCaller";

/**
 * Ce que cette suite prouve : la CIBLE d'un sujet inspectable n'est jamais
 * ignorée en silence — elle est consommée, ou refusée en le disant.
 *
 * Le défaut réparé : `nodefony inspect routes auth` rendait les centaines de
 * routes de l'application sous un code de succès. L'argument était annoncé par
 * l'aide, reçu, puis jeté. Celui qui l'a tapé lit alors une collection
 * ENTIÈRE comme si c'était le résultat de sa recherche — et rien, dans la
 * réponse, ne le distingue d'un filtre qui n'aurait rien trouvé.
 *
 * Deux moitiés indissociables : le sujet qui SAIT filtrer le déclare, et celui
 * qui ne sait pas refuse au lieu de se taire.
 */

/** L'administrateur — la garde testée est en amont de tout contrôle de rôle. */
const ADMIN: IAdminCaller = {
  user: null,
  roles: [ADMIN_DEFAULT_ROLE],
  label: "banc",
};

describe("inspect — la cible d'un sujet est consommée ou refusée", () => {
  it("le sujet `routes` DÉCLARE son filtre, sinon la cible ne traverse pas", () => {
    // Le point de câblage exact : sans cette clé, `readAdminSubject` ne pose
    // aucune query et l'endpoint rend le dump entier — le défaut d'origine.
    expect(INSPECT_SUBJECTS.routes.filter).to.equal("q");
  });

  it("refuse une cible donnée à un sujet qui n'en consomme aucune", async () => {
    const read = await readAdminSubject(undefined, "modules", ADMIN, "http");
    expect(read.ok).to.be.false;
    if (read.ok) throw new Error("inatteignable");
    expect(read.reason).to.equal("target-not-supported");
    // Le refus NOMME la cible rejetée et les sujets qui en acceptent une :
    // un refus qui n'indique aucun geste fait réessayer la même commande.
    expect(read.message).to.contain("http");
    expect(read.message).to.contain("module");
  });

  it("laisse passer la cible sur un sujet qui la FILTRE, sans la réclamer", async () => {
    // Deux lectures du même sujet — le refus ne doit dépendre QUE de la
    // déclaration, pas de la présence d'un broker (il n'y en a pas ici).
    for (const target of ["auth", undefined]) {
      const read = await readAdminSubject(undefined, "routes", ADMIN, target);
      expect(read.ok).to.be.false;
      if (read.ok) throw new Error("inatteignable");
      // Sans broker la lecture échoue plus loin, au producteur — jamais sur
      // l'argument. C'est cette FRONTIÈRE que le banc tient.
      expect(read.reason).to.not.equal("target-not-supported");
      expect(read.reason).to.not.equal("missing-target");
    }
  });

  it("réclame toujours la cible d'un sujet qui l'EXIGE", async () => {
    const read = await readAdminSubject(undefined, "module", ADMIN, undefined);
    expect(read.ok).to.be.false;
    if (read.ok) throw new Error("inatteignable");
    expect(read.reason).to.equal("missing-target");
  });
});
