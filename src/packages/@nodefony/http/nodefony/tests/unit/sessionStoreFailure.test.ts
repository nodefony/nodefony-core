/// <reference types="node" />
import { expect } from "chai";
import { describe, it } from "vitest";
import { describeSessionStoreFailure } from "../../src/session/sessionStoreFailure.js";

/**
 * La conduite à tenir quand le stockage de session est inutilisable.
 *
 * Le défaut couvert : la sauvegarde de session a lieu juste avant l'écriture
 * des en-têtes, et son exception remontait telle quelle — rien n'était jamais
 * écrit sur la socket. Le client attendait son propre délai, et aucun journal
 * ne nommait la cause. Le banc de tenue dans la durée est resté rouge dix jours
 * pour cette seule raison : le seul symptôme visible est « pas de réponse ».
 *
 * Ce que ces cas gardent, c'est la DÉCISION. Que la réponse parte réellement
 * est prouvé ailleurs, sur un serveur réel — `#doSend` est une méthode privée,
 * qu'aucun contexte fabriqué ne peut atteindre.
 */

/** Ce que rend chaque moteur quand les migrations n'ont pas été appliquées. */
const TABLE_ABSENTE = {
  sqlite: "SQLITE_ERROR: no such table: session",
  postgres: 'relation "session" does not exist',
  mysql: "Table 'app.session' doesn't exist",
};

describe("panne du stockage de session — ce qu'on répond", () => {
  it("sert 500 : une session non persistée est une dégradation, pas un détail", () => {
    // Servir 200 laisserait croire que la connexion a été retenue alors que
    // rien n'a été écrit — la dégradation silencieuse que ce framework refuse.
    const vu = describeSessionStoreFailure(new Error(TABLE_ABSENTE.sqlite));
    expect(vu.statusCode).to.equal(500);
  });

  it("ne divulgue RIEN du moteur au client", () => {
    const vu = describeSessionStoreFailure(new Error(TABLE_ABSENTE.sqlite));
    expect(vu.body).to.not.match(/session"|SQLITE|no such table/);
    expect(vu.body).to.be.a("string").and.not.empty;
  });

  it("NOMME la cause dans le journal du serveur", () => {
    const vu = describeSessionStoreFailure(new Error(TABLE_ABSENTE.sqlite));
    expect(vu.message).to.match(/no such table: session/);
  });

  it("dit quoi FAIRE — les migrations, pas seulement la cause", () => {
    // Un message qui n'énonce qu'une cause envoie chercher là où il n'y a rien.
    for (const dialecte of Object.keys(TABLE_ABSENTE)) {
      const vu = describeSessionStoreFailure(
        new Error(TABLE_ABSENTE[dialecte as keyof typeof TABLE_ABSENTE]),
      );
      expect(vu.message, `dialecte ${dialecte}`).to.match(/orm:migrate/);
    }
  });

  it("reste utile quand la panne n'est PAS une table absente", () => {
    // Store réseau injoignable : parler de migrations comme seule piste
    // enverrait chercher au mauvais endroit — on nomme les deux.
    const vu = describeSessionStoreFailure(
      new Error("ECONNREFUSED 127.0.0.1:6379"),
    );
    expect(vu.statusCode).to.equal(500);
    expect(vu.message).to.match(/ECONNREFUSED/);
    expect(vu.message).to.match(/http\.session\.store/);
  });

  it("ne suppose pas qu'on lui passe une Error", () => {
    // Un store peut rejeter une chaîne, ou `undefined` : la décision doit
    // tenir quand même, sinon le remède devient lui-même la panne.
    expect(describeSessionStoreFailure("boom").message).to.match(/boom/);
    expect(describeSessionStoreFailure(undefined).statusCode).to.equal(500);
  });
});
