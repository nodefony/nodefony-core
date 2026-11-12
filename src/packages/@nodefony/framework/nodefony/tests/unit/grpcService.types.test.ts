import { describe, expectTypeOf, it } from "vitest";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { HandlerContext } from "@connectrpc/connect";
import type { ContextType } from "@nodefony/http";
import { GrpcController, GrpcService } from "../../grpc/index.js";
import type { GrpcServiceClass } from "../../grpc/index.js";
import {
  EnvelopeSchema,
  FixtureService,
  Level,
  TreeService,
  type Envelope,
  type SayRequest,
} from "../fixtures/grpc/gen/nodefony/fwtest/v1/fixture_pb.js";

/**
 * #695 critère 7 — garde de TYPES (rendue par `npm run typecheck`, pas par
 * vitest : rien ici ne s'exécute). `@GrpcService(Contrat)` n'accepte qu'une
 * classe qui implémente CHAQUE méthode du contrat avec sa signature générée —
 * types imbriqués, `oneof`, `map`, `enum`, `int64` compris. Débrancher la
 * contrainte (`GrpcServiceClass` → `new (...args: never[]) => GrpcController`)
 * rend chaque `@ts-expect-error` inutile, donc une erreur.
 */

type EnvelopeInit = MessageInitShape<typeof EnvelopeSchema>;

describe("#695 — @GrpcService contraint la classe au contrat généré", () => {
  it("une classe conforme, types complexes compris, est acceptée", () => {
    class TreeController extends GrpcController {
      constructor(context: ContextType) {
        super("TreeController", context);
      }
      mirror(request: Envelope, ctx: HandlerContext): EnvelopeInit {
        void ctx;
        const tree =
          request.payload.case === "tree" ? request.payload.value : null;
        return {
          header: { sequence: (request.header?.sequence ?? 0n) + 1n },
          payload:
            tree === null
              ? { case: "text", value: "vide" }
              : {
                  case: "tree",
                  value: {
                    label: tree.label,
                    children: tree.children,
                    named: { racine: { label: "r" } },
                  },
                },
          level: Level.HIGH,
          score: 0.5,
        };
      }
    }
    expectTypeOf(TreeController).toExtend<
      GrpcServiceClass<typeof TreeService>
    >();
  });

  it("les classes fautives ne compilent pas", () => {
    // Jamais exécuté : seul le compilateur lit ces lignes (un second
    // `@GrpcService` du même contrat serait refusé à l'exécution).
    const neverRun = (): void => {
      class MissingMethod extends GrpcController {
        constructor(context: ContextType) {
          super("MissingMethod", context);
        }
        say(request: SayRequest) {
          return { sentence: request.sentence };
        }
      }
      // @ts-expect-error — `ping`, `watch`, `collect`, `converse` manquent.
      GrpcService(FixtureService)(MissingMethod);

      class WrongNestedType extends GrpcController {
        constructor(context: ContextType) {
          super("WrongNestedType", context);
        }
        mirror(request: Envelope) {
          // `sequence` est un int64 : un `bigint`, jamais un `string`.
          return { header: { sequence: String(request.header?.sequence) } };
        }
      }
      // @ts-expect-error — type imbriqué faux (int64 rendu en chaîne).
      GrpcService(TreeService)(WrongNestedType);

      class WrongOneof extends GrpcController {
        constructor(context: ContextType) {
          super("WrongOneof", context);
        }
        mirror() {
          // Le cas `raw` porte des octets, pas un nœud.
          return { payload: { case: "raw" as const, value: { label: "x" } } };
        }
      }
      // @ts-expect-error — branche de `oneof` au mauvais type.
      GrpcService(TreeService)(WrongOneof);

      class WrongEnum extends GrpcController {
        constructor(context: ContextType) {
          super("WrongEnum", context);
        }
        mirror() {
          return { level: "LEVEL_HIGH" };
        }
      }
      // @ts-expect-error — un enum se rend par sa valeur, pas par son nom.
      GrpcService(TreeService)(WrongEnum);

      class NotAController {
        mirror(): EnvelopeInit {
          return {};
        }
      }
      // @ts-expect-error — la classe doit étendre GrpcController.
      GrpcService(TreeService)(NotAController);
    };
    void neverRun;
  });
});
