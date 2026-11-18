// Le pot à cookies des bancs e2e se comporte comme un navigateur : une réponse
// qui ne porte qu'un cookie ne fait pas tomber les autres.
import { describe, expect, it } from "vitest";
import { mergeSetCookie } from "./cookie-jar.mjs";

describe("mergeSetCookie — pot à cookies des bancs e2e", () => {
  it("une réponse qui ne pose qu'un jeton CSRF garde le cookie de session", () => {
    const jar = mergeSetCookie("nodefony=abc", [
      "csrf-token=xyz; Path=/; SameSite=Strict; Secure",
    ]);
    expect(jar).toBe("nodefony=abc; csrf-token=xyz");
  });

  it("un cookie se remplace par son nom", () => {
    expect(
      mergeSetCookie("nodefony=abc; csrf-token=1", ["nodefony=def; HttpOnly"]),
    ).toBe("nodefony=def; csrf-token=1");
  });

  it("Max-Age=0 et une date Expires passée retirent le cookie", () => {
    const now = Date.parse("2026-11-18T12:00:00Z");
    expect(mergeSetCookie("a=1; b=2", ["a=; Max-Age=0"], now)).toBe("b=2");
    expect(
      mergeSetCookie(
        "a=1; b=2",
        ["b=; Expires=Thu, 01 Jan 1970 00:00:00 GMT"],
        now,
      ),
    ).toBe("a=1");
    expect(mergeSetCookie("a=1", ["a=; Max-Age=0"], now)).toBeNull();
  });

  it("sans Set-Cookie, le pot reste tel quel", () => {
    expect(mergeSetCookie("a=1", undefined)).toBe("a=1");
    expect(mergeSetCookie(null, undefined)).toBeNull();
  });
});
