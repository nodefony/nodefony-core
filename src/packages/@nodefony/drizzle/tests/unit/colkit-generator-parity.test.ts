import assert from "node:assert/strict";
import { ENUM_MAX_LENGTH } from "../../nodefony/entity/colKit.spec";
// Le générateur vit dans le cœur, qui ne peut pas dépendre de ce module : la
// borne y est RECOPIÉE. Ce test est ce qui empêche les deux copies de diverger.
import { PORTABLE_ENUM_MAX_LENGTH } from "../../../../../nodefony/src/cli/scaffold/entityFields";

describe("colKit ↔ générateur — une borne recopiée, confrontée", () => {
  it("la plus longue valeur d'énumération est la même des deux côtés", () => {
    assert.equal(PORTABLE_ENUM_MAX_LENGTH, ENUM_MAX_LENGTH);
  });
});
