import assert from "node:assert/strict";
import {
  SYSTEM_CHANNEL_POLICY,
  SECURITY_CHANNEL_POLICY,
} from "../../nodefony/src/realtime/frameAuthorizer";

// Le projet tient une convention à deux échelles : un rôle dont le nom porte le
// préfixe du framework désigne l'exploitant de l'INSTANCE — la seule échelle qui
// traverse l'isolation entre organisations clientes ; tout autre rôle appartient
// à l'organisation et sera scopé le jour du multi-tenant.
//
// La convention n'était écrite nulle part qu'un automate relise, et elle était
// déjà contredite : les canaux d'introspection du processus (journaux, base,
// supervision, ramasse-miettes forcé) étaient gardés par un rôle
// d'organisation. Sans conséquence tant qu'une seule organisation existe — une
// fuite du pod vers le client dès qu'il y en a deux, et un renommage qui
// coûterait une version majeure.
//
// Ce banc porte la convention pour les politiques de PLATEFORME. Il ne juge pas
// ce qu'une application déclare pour elle-même (`realtimeChannels`) : ouvrir un
// canal à un rôle d'organisation reste son droit, à condition de le DÉCLARER.

/** Préfixe réservé à l'échelle plateforme. */
const PREFIXE_PLATEFORME = "ROLE_NODEFONY_";

/** Les politiques que le framework impose lui-même, par nom. */
const POLITIQUES_PLATEFORME = [
  ["SYSTEM_CHANNEL_POLICY", SYSTEM_CHANNEL_POLICY],
  ["SECURITY_CHANNEL_POLICY", SECURITY_CHANNEL_POLICY],
] as const;

describe("Échelle des rôles — les politiques de plateforme", () => {
  it("chaque politique système exige un rôle de l'échelle plateforme", () => {
    for (const [nom, politique] of POLITIQUES_PLATEFORME) {
      const roles = politique.roles ?? [];
      assert.ok(
        roles.length > 0,
        `${nom} n'exige aucun rôle : une ressource du processus serait ouverte ` +
          `à tout compte authentifié.`,
      );
      for (const role of roles) {
        assert.ok(
          role.startsWith(PREFIXE_PLATEFORME),
          `${nom} exige « ${role} », un rôle d'ORGANISATION, pour une ressource ` +
            `du processus. Le jour où plusieurs organisations partagent une ` +
            `instance, l'administrateur de l'une lira l'état de toutes. ` +
            `Utiliser un rôle « ${PREFIXE_PLATEFORME}* », ou déclarer ` +
            `explicitement l'ouverture côté application (realtimeChannels).`,
        );
      }
    }
  });

  it("ces politiques exigent aussi une identité (pas seulement un rôle)", () => {
    for (const [nom, politique] of POLITIQUES_PLATEFORME) {
      assert.equal(
        politique.authenticated,
        true,
        `${nom} doit exiger une identité : un rôle ne se vérifie pas sur un anonyme.`,
      );
    }
  });

  // Sans cette borne, le banc passerait pour la plus mauvaise des raisons : une
  // liste vide ne prouve rien.
  it("la liste contrôlée n'est pas vide", () => {
    assert.ok(POLITIQUES_PLATEFORME.length >= 2);
  });
});
