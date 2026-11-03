import { AbstractCrudService, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import type { RoomMemberRow } from "../entity/RoomMember";

/**
 * Ce que `create entity RoomMember` écrit dans `nodefony/service/`, réduit au
 * patron d'accès : le service reçoit son dépôt, l'accesseur le construit au
 * premier appel depuis le connecteur `default` de l'application, et le rebâtit
 * quand une autre base y est enregistrée (un test qui en ouvre une par cas).
 */
export class RoomMemberService extends AbstractCrudService<RoomMemberRow> {
  constructor(repository: IRepository<RoomMemberRow>) {
    super("roomMemberService", repository);
  }
}

let instance: RoomMemberService | null = null;
let boundTo: object | null = null;

/** Récupère le service, rebâti si la base enregistrée a changé depuis. */
export function getRoomMemberService(): RoomMemberService {
  const orm = ormRegistry.get("default");
  if (instance === null || boundTo !== orm) {
    instance = new RoomMemberService(
      orm.getRepository<RoomMemberRow>("RoomMember"),
    );
    boundTo = orm;
  }
  return instance;
}
