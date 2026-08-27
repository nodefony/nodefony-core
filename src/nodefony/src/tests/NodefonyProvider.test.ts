// @vitest-environment jsdom
/**
 * Le Provider React, EXÉCUTÉ — pas lu.
 *
 * Ce que ces cas prouvent, et qu'aucune lecture de fichier ne prouve : le
 * Provider fabrique bien UNE socket par URL, la connecte lui-même, et laisse
 * tranquille celle que l'application lui confie.
 *
 * Pourquoi ce fichier existe : le gabarit d'application était jusqu'ici vérifié
 * par des `assert.include` sur le texte rendu — on constatait que la bonne ligne
 * était écrite, jamais qu'elle marchait. C'est le même angle mort qui a laissé
 * publier un contrat que rien n'implémentait.
 *
 * `WebSocket` est remplacé par un compteur : compter les connexions OUVERTES est
 * la seule façon de distinguer « deux Providers partagent une socket » de « deux
 * Providers en ouvrent deux ». L'ouverture n'est jamais confirmée (aucun `open`
 * émis), ce qui suffit ici et évite tout timer de reconnexion.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NodefonyProvider, useNodefony } from "../client/react/index";
import { RealtimeClient } from "../client/realtime/RealtimeClient";

/** Sockets instanciées depuis le début du cas courant. */
let ouvertes: string[] = [];

class FakeWebSocket {
  static readonly CONNECTING = 0;
  readyState = FakeWebSocket.CONNECTING;
  constructor(readonly url: string) {
    ouvertes.push(url);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  send(): void {}
  close(): void {}
}

let root: Root | null = null;
let hote: HTMLDivElement | null = null;

beforeEach(() => {
  ouvertes = [];
  // Le registre de `shared()` vit sur `globalThis` : sans purge, un cas hérite
  // de la socket du précédent et « prouve » un partage qui n'a pas eu lieu.
  delete (globalThis as { __nfRealtime__?: unknown }).__nfRealtime__;
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  hote = document.createElement("div");
  document.body.appendChild(hote);
  root = createRoot(hote);
});

afterEach(() => {
  act(() => root?.unmount());
  hote?.remove();
  root = null;
  hote = null;
});

/** Rend le client vu par un enfant du Provider — c'est ce que l'app consomme. */
function Sonde({ vers }: { vers: (c: RealtimeClient) => void }): null {
  vers(useNodefony());
  return null;
}

describe("NodefonyProvider", () => {
  it("fabrique et connecte la socket quand on lui donne une url", () => {
    let vu: RealtimeClient | null = null;
    act(() => {
      root!.render(
        React.createElement(
          NodefonyProvider,
          { url: "/api/live/realtime" },
          React.createElement(Sonde, { vers: (c) => (vu = c) }),
        ),
      );
    });
    expect(vu).toBeInstanceOf(RealtimeClient);
    // UNE connexion : le Provider a bien appelé `connect()` de lui-même.
    expect(ouvertes).toHaveLength(1);
    expect(ouvertes[0]).toContain("/api/live/realtime");
  });

  it("n'ouvre QU'UNE connexion pour deux Providers de même url", () => {
    const clients: RealtimeClient[] = [];
    const unProvider = (cle: string) =>
      React.createElement(
        NodefonyProvider,
        { url: "/api/live/realtime", key: cle },
        React.createElement(Sonde, { vers: (c) => clients.push(c) }),
      );
    act(() => {
      root!.render(
        React.createElement(
          React.Fragment,
          null,
          unProvider("a"),
          unProvider("b"),
        ),
      );
    });
    // Le partage se PROUVE sur le réseau, pas sur l'identité des objets : c'est
    // le nombre de sockets ouvertes qui coûte cher à l'utilisateur.
    expect(ouvertes).toHaveLength(1);
    expect(clients).toHaveLength(2);
    expect(clients[0]).toBe(clients[1]);
  });

  it("ne touche pas au cycle d'une socket que l'application fournit", () => {
    // La console d'administration est dans ce cas : elle possède son cycle et
    // re-négocie la socket sur changement d'identité. Le Provider qui
    // appellerait `connect()` par-dessus lui volerait cette décision.
    const mien = RealtimeClient.shared({
      url: "/nodefony/studio/api/realtime",
    });
    ouvertes = [];
    act(() => {
      root!.render(
        React.createElement(
          NodefonyProvider,
          { client: mien },
          React.createElement(Sonde, { vers: () => {} }),
        ),
      );
    });
    expect(ouvertes).toHaveLength(0);
  });

  it("refuse franchement une url manquante, en nommant la route attendue", () => {
    // Sans URL il n'y a rien à deviner : le client visait autrefois une route
    // montée nulle part, et l'utilisateur n'obtenait qu'une socket qui retente.
    expect(() => RealtimeClient.shared({})).toThrow(
      /adresse du serveur temps réel manquante/,
    );
    expect(() => RealtimeClient.shared({})).toThrow(/api\/live\/realtime/);
    expect(ouvertes).toHaveLength(0);
  });
});
