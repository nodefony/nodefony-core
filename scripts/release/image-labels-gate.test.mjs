/**
 * Le contrôle des étiquettes OCI, éprouvé SANS docker.
 *
 * La confrontation est une fonction PURE, et c'est délibéré : le défaut qu'on
 * garde ici n'est pas une panne de docker, c'est une chaîne de construction qui
 * ne passe pas ses `--build-arg`. Le reproduire par une vraie image coûterait
 * une minute de build par famille d'écart, pour ne rien prouver de plus.
 *
 * Chaque cas ci-dessous est un état RÉEL de l'image `10.0.0-alpha.4` publiée sur
 * Docker Hub, ou l'état qu'un retrait de `--build-arg` produirait.
 */
import { describe, expect, it } from "vitest";

import { controlerEtiquettes } from "./image-labels-gate.mjs";

const OCI = "org.opencontainers.image";
const SHA = "b28d7586a1c94f0e2d3b5a7c8e9f0123456789ab";

/** Les étiquettes d'une image correctement estampillée. */
const justes = {
  [`${OCI}.title`]: "Nodefony",
  [`${OCI}.version`]: "10.0.0-alpha.5",
  [`${OCI}.revision`]: SHA,
  [`${OCI}.created`]: "2026-09-11T15:04:05Z",
};

const attendu = {
  version: "10.0.0-alpha.5",
  revision: SHA,
  titreInterdit: "demo",
};

describe("controlerEtiquettes", () => {
  it("laisse passer une image dont les étiquettes disent vrai", () => {
    expect(controlerEtiquettes(justes, attendu)).toEqual([]);
  });

  it("refuse l'état RÉEL de la 10.0.0-alpha.4 — aucun --build-arg passé", () => {
    const ecarts = controlerEtiquettes(
      {
        [`${OCI}.title`]: "demo",
        [`${OCI}.version`]: "0.1.0",
        [`${OCI}.revision`]: "",
        [`${OCI}.created`]: "",
      },
      attendu,
    );
    // Quatre familles à la fois : deux vides, une version qui ment, un titre
    // qui est celui de l'application témoin.
    expect(ecarts).toHaveLength(4);
    expect(ecarts.join("\n")).toMatch(/revision : étiquette VIDE/);
    expect(ecarts.join("\n")).toMatch(/created : étiquette VIDE/);
    expect(ecarts.join("\n")).toMatch(/0\.1\.0.*10\.0\.0-alpha\.5/s);
    expect(ecarts.join("\n")).toMatch(/application TÉMOIN/);
  });

  it("refuse une image SANS la moindre étiquette", () => {
    // `docker inspect` rend `null` dans ce cas ; l'appelant le traduit en `{}`
    // pour que les trois absences soient NOMMÉES au lieu d'un « aveugle ».
    const ecarts = controlerEtiquettes({}, attendu);
    expect(ecarts).toHaveLength(3);
    expect(ecarts.every((e) => /ABSENTE/.test(e))).toBe(true);
  });

  it("refuse un SHA court — une remontée qui doit deviner n'est pas une remontée", () => {
    const ecarts = controlerEtiquettes(
      { ...justes, [`${OCI}.revision`]: "b28d758" },
      { version: attendu.version },
    );
    expect(ecarts).toHaveLength(1);
    expect(ecarts[0]).toMatch(/40 hexadécimaux/);
  });

  it("refuse une révision qui n'est pas celle de la construction", () => {
    const ecarts = controlerEtiquettes(
      { ...justes, [`${OCI}.revision`]: "0".repeat(40) },
      attendu,
    );
    expect(ecarts).toHaveLength(1);
    expect(ecarts[0]).toMatch(/alors que la construction est faite sur/);
  });

  it("refuse une date de construction illisible", () => {
    const ecarts = controlerEtiquettes(
      { ...justes, [`${OCI}.created`]: "hier" },
      attendu,
    );
    expect(ecarts).toHaveLength(1);
    expect(ecarts[0]).toMatch(/ISO 8601/);
  });

  it("n'invente pas d'écart quand l'appelant ne dit pas ce qu'il attend", () => {
    // Sans attendu, seules les absences et les formes invalides mordent : le
    // contrôle sert aussi à regarder une image tierce, où l'on ne sait pas quelle
    // version DEVRAIT s'y trouver.
    expect(controlerEtiquettes(justes, {})).toEqual([]);
    expect(
      controlerEtiquettes({ ...justes, [`${OCI}.version`]: "0.1.0" }, {}),
    ).toEqual([]);
  });

  it('traite une étiquette d\'espaces comme vide — un --build-arg=" " ne dit rien', () => {
    const ecarts = controlerEtiquettes(
      { ...justes, [`${OCI}.version`]: "   " },
      {},
    );
    expect(ecarts).toHaveLength(1);
    expect(ecarts[0]).toMatch(/VIDE/);
  });

  it("ne casse pas sur des étiquettes absentes de l'objet inspecté", () => {
    // `docker inspect` peut rendre `null` : l'appelant le normalise, mais la
    // fonction ne doit pas lever si on l'appelle nue.
    expect(() => controlerEtiquettes(null, attendu)).not.toThrow();
    expect(controlerEtiquettes(null, attendu)).toHaveLength(3);
  });
});
