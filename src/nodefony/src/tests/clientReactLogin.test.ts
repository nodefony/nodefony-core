// @vitest-environment jsdom
/**
 * `useNodefonyLogin` EXÉCUTÉ dans un vrai rendu React : l'état suit le
 * déroulé, le déroulé reste le MÊME d'un rendu à l'autre, et démonter libère
 * l'abonnement. Les règles du déroulé sont éprouvées une fois dans
 * `clientNodefonyLogin.test.ts` ; ici, la traduction.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  useNodefonyLogin,
  type NodefonyLoginBinding,
} from "../client/react/index";
import { loginFetchBench } from "./fixtures/loginFetch";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("useNodefonyLogin — React", () => {
  it("🔴 l'état suit le déroulé jusqu'à `authenticated`, avec le même déroulé à chaque rendu", async () => {
    const banc = loginFetchBench();
    const vus: NodefonyLoginBinding[] = [];
    function Formulaire() {
      // Un objet d'options NEUF à chaque rendu : il ne doit rien recréer.
      const liaison = useNodefonyLogin({ fetch: banc.fetch, passkey: null });
      React.useEffect(() => {
        vus.push(liaison);
      });
      return null;
    }
    root = createRoot(document.createElement("div"));
    act(() => root!.render(React.createElement(Formulaire)));
    expect(vus.at(-1)!.state.step).toBe("identifier");

    const flow = vus.at(-1)!.flow;
    await act(() => flow.login("admin", "secret"));
    expect(vus.at(-1)!.state.step).toBe("mfa");

    await act(() => flow.submitMfaCode("123456"));
    expect(vus.at(-1)!.state).toMatchObject({
      step: "authenticated",
      user: { username: "admin" },
    });
    expect(new Set(vus.map((v) => v.flow)).size).toBe(1);
    expect(banc.calls).toHaveLength(2);
  });
});
