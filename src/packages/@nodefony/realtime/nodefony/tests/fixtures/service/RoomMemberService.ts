import { AbstractCrudService, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import type { RoomMemberRow } from "../entity/RoomMember";

/**
 * Ce que `create entity RoomMember` écrit dans `nodefony/service/`, réduit au
 * patron d'accès : le service reçoit son dépôt, l'accesseur le construit au
 * premier appel depuis le connecteur `default` de l'application.
 */
export class RoomMemberService extends AbstractCrudService<RoomMemberRow> {
  constructor(repository: IRepository<RoomMemberRow>) {
    super("roomMemberService", repository);
  }
}

let instance: RoomMemberService | null = null;

/** Récupère le service (le construit au premier appel). */
export function getRoomMemberService(): RoomMemberService {
  instance ??= new RoomMemberService(
    ormRegistry.get("default").getRepository<RoomMemberRow>("RoomMember"),
  );
  return instance;
}
