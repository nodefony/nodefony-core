import type { DescMethod, DescService } from "@bufbuild/protobuf";
import type Route from "../src/Route";

/** Une route montée par `@GrpcService`, et la méthode du contrat qu'elle sert. */
export interface IGrpcRoute {
  readonly route: Route;
  readonly method: DescMethod;
}

/** Ce que `@GrpcService` a déclaré pour une classe, lu au démarrage. */
export interface IGrpcDeclaration {
  readonly service: DescService;
  readonly routes: readonly IGrpcRoute[];
}

/**
 * Déclarations par classe contrôleur. Écrite à l'import (`@GrpcService`), lue
 * une fois au démarrage (`GrpcController.assertScope`) : jamais sur le chemin
 * d'un appel.
 */
const declarations = new WeakMap<object, IGrpcDeclaration>();

/**
 * Contrat déjà servi, par nom complet : deux classes qui serviraient le même
 * service monteraient deux fois les mêmes chemins.
 */
const servedBy = new Map<string, string>();

/** @internal */
export function declareGrpcService(
  ctor: object,
  declaration: IGrpcDeclaration,
): void {
  declarations.set(ctor, declaration);
}

/** @internal */
export function grpcDeclarationOf(ctor: object): IGrpcDeclaration | undefined {
  return declarations.get(ctor);
}

/**
 * Retient quelle classe sert un contrat.
 *
 * @returns le nom de la classe qui le servait déjà, ou `null`.
 * @internal
 */
export function claimGrpcService(
  typeName: string,
  className: string,
): string | null {
  const owner = servedBy.get(typeName);
  if (owner !== undefined) return owner;
  servedBy.set(typeName, className);
  return null;
}
