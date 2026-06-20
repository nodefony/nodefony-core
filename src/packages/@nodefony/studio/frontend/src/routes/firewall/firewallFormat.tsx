/**
 * Helpers de RENDU de la console Firewall — badges (icône + couleur + texte,
 * jamais la couleur seule = a11y WCAG). Données non maîtrisées (pattern, host…)
 * rendues en TEXTE/Code, jamais en HTML.
 */
import type { ReactNode } from "react";
import { Badge, Tooltip } from "@mantine/core";
import {
  IconCheck,
  IconX,
  IconShieldLock,
  IconShieldOff,
  IconLock,
  IconTicket,
  IconUserQuestion,
  IconPlugConnected,
  IconPlugConnectedX,
} from "@tabler/icons-react";

import { AUTHENTICATOR_META, authenticatorLabel } from "./firewallModel";

/** Badge générique activé/désactivé (icône + texte). */
export function OnOffBadge({
  on,
  onLabel = "Activé",
  offLabel = "Désactivé",
}: {
  on: boolean;
  onLabel?: string;
  offLabel?: string;
}): ReactNode {
  return (
    <Badge
      variant="light"
      color={on ? "teal" : "gray"}
      leftSection={on ? <IconCheck size={12} /> : <IconX size={12} />}
      style={{ textTransform: "none" }}
    >
      {on ? onLabel : offLabel}
    </Badge>
  );
}

/** Zone protégée (Zero Trust) vs publique explicite. */
export function ZoneSecurityBadge({
  security,
}: {
  security: boolean;
}): ReactNode {
  return (
    <Badge
      variant={security ? "light" : "outline"}
      color={security ? "teal" : "orange"}
      leftSection={
        security ? <IconShieldLock size={12} /> : <IconShieldOff size={12} />
      }
      style={{ textTransform: "none" }}
    >
      {security ? "Protégée" : "Publique"}
    </Badge>
  );
}

/** Stratégie d'identité de la zone : session BFF (stateful) vs stateless. */
export function StatelessBadge({
  stateless,
}: {
  stateless: boolean;
}): ReactNode {
  return (
    <Tooltip
      label={
        stateless
          ? "Stateless : chaque requête porte sa preuve (JWT / clé API), aucun registre serveur."
          : "Stateful : session serveur posée au login (cookie opaque révocable, BFF)."
      }
      withinPortal
      multiline
      w={260}
    >
      <Badge
        variant="dot"
        color={stateless ? "grape" : "cyan"}
        style={{ textTransform: "none" }}
      >
        {stateless ? "Stateless" : "Session BFF"}
      </Badge>
    </Tooltip>
  );
}

/** Mode de chaîne d'authenticators : `first` (OU) vs `all` (MFA). */
export function ModeBadge({ mode }: { mode: "first" | "all" }): ReactNode {
  return (
    <Tooltip
      label={
        mode === "all"
          ? "Tous les authenticators doivent passer (MFA) — le dernier porte l'identité."
          : "Le premier authenticator qui reconnaît la requête authentifie."
      }
      withinPortal
      multiline
      w={260}
    >
      <Badge
        variant="light"
        color={mode === "all" ? "red" : "blue"}
        style={{ textTransform: "none" }}
      >
        {mode === "all" ? "MFA (all)" : "first"}
      </Badge>
    </Tooltip>
  );
}

/** Badge d'un authenticator (label FR + teinte du registre). */
export function AuthenticatorChip({ name }: { name: string }): ReactNode {
  const meta = AUTHENTICATOR_META[name];
  const Ico =
    name === "anonymous" ? IconUserQuestion : meta ? IconLock : IconTicket;
  return (
    <Badge
      variant="light"
      color={meta?.color ?? "gray"}
      leftSection={<Ico size={12} />}
      style={{ textTransform: "none" }}
    >
      {authenticatorLabel(name)}
    </Badge>
  );
}

/** Statut de montage d'un authenticator (actif sur le pipeline ou simplement dispo). */
export function MountedBadge({ mounted }: { mounted: boolean }): ReactNode {
  return (
    <Badge
      variant={mounted ? "filled" : "light"}
      color={mounted ? "teal" : "gray"}
      leftSection={
        mounted ? (
          <IconPlugConnected size={12} />
        ) : (
          <IconPlugConnectedX size={12} />
        )
      }
      style={{ textTransform: "none" }}
    >
      {mounted ? "Monté" : "Disponible"}
    </Badge>
  );
}
