/**
 * Composants **visuels réutilisables** de la page Log Backplane. Briques sans
 * état, sûres (rendu en TEXTE, jamais d'HTML injecté), accessibles. Partagées
 * par les onglets Live / Explorer / Fichiers / Backplane et le drawer de détail.
 */
import { Alert, Badge, Code, Group, Text, ThemeIcon } from "@mantine/core";
import {
  IconStack2,
  IconFileText,
  IconSearch,
  IconDatabase,
  IconDeviceFloppy,
  IconBroadcast,
  IconAffiliate,
  IconAlertTriangle,
} from "@tabler/icons-react";
import type { FC } from "react";
import type {
  ClusterTopology,
  LogDriverCapabilities,
  Severity,
} from "./logsTypes";
import {
  driverMeta,
  isClusterAware,
  severityColor,
  severityVariant,
  type DriverIconKind,
} from "./logFormat";
import { DocHint } from "../../components/ui";

/** Icône d'un type de driver. */
const DRIVER_ICONS: Record<DriverIconKind, FC<{ size?: number }>> = {
  memory: IconStack2,
  file: IconFileText,
  cluster: IconAffiliate,
  search: IconSearch,
  generic: IconDatabase,
};

/**
 * **DriverIcon** — icône d'un driver de relecture, dérivée de son nom via
 * {@link driverMeta}. Pastille `ThemeIcon` colorée.
 */
export function DriverIcon({
  name,
  size = 18,
  color = "brand",
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  const Icon = DRIVER_ICONS[driverMeta(name).icon];
  return (
    <ThemeIcon variant="light" color={color} size={size + 14} radius="md">
      <Icon size={size} />
    </ThemeIcon>
  );
}

/**
 * **ClusterScopeNotice** — avertissement d'honnêteté sur la portée de la
 * relecture en **cluster**. Rendu uniquement si `cluster.isCluster`. En cluster,
 * le data plane HTTP est servi par UN worker (round-robin) et la socket WS du
 * Live est portée par UN worker → la vue est partielle sauf driver agrégateur.
 * Trois cas (cf {@link isClusterAware}) :
 *
 *  - `context="query"` + driver agrégateur (`cluster-file`/elastic/loki) → note
 *    verte rassurante (vue cluster unifiée) ;
 *  - `context="query"` + driver local (`memory`/`file`) → **alerte orange** : la
 *    relecture ne voit que ce worker, résultats incohérents au refresh → bascule
 *    `cluster-file` (config) ;
 *  - `context="live"` → note bleue informative : le flux ne vient que d'un worker.
 *
 * Mono-process → rien (0 bruit). Pattern « honnêteté » du dashboard ORM (« fourni
 * par un autre worker »).
 */
export function ClusterScopeNotice({
  cluster,
  driverName,
  context,
}: {
  cluster: ClusterTopology | null | undefined;
  driverName: string | null;
  context: "query" | "live";
}) {
  if (!cluster?.isCluster) return null;
  const label = driverName ? driverMeta(driverName).label : "—";

  if (context === "live") {
    return (
      <Alert
        variant="light"
        color="blue"
        icon={<IconAffiliate size={16} />}
        title="Cluster — flux d'un seul worker"
      >
        En cluster, le flux temps réel ne provient que du worker portant la
        socket WebSocket (le PID est en tête de chaque ligne). Pour une vue de{" "}
        <b>tout</b> le cluster, va dans l'onglet <b>Explorer</b> avec le driver{" "}
        <Code>cluster-file</Code>.
      </Alert>
    );
  }

  if (isClusterAware(driverName)) {
    return (
      <Alert
        variant="light"
        color="teal"
        icon={<IconAffiliate size={16} />}
        title="Vue cluster unifiée"
      >
        Driver « {label} » : la relecture agrège les logs de <b>tous</b> les
        workers du cluster — résultats cohérents quel que soit le worker qui
        répond.
      </Alert>
    );
  }

  return (
    <Alert
      variant="light"
      color="orange"
      icon={<IconAlertTriangle size={16} />}
      title="Vue partielle — un seul worker"
    >
      Cluster détecté (worker PID {cluster.pid}). Le driver actif « {label} » ne
      relit que <b>ce</b> worker → les requêtes peuvent renvoyer des résultats
      incohérents d'un rafraîchissement à l'autre (round-robin entre workers).
      Configure <Code>log.queryDriver: "cluster-file"</Code> pour une vue
      unifiée du cluster.
    </Alert>
  );
}

/**
 * **SeverityBadge** — badge de sévérité RFC 5424 (couleur + variante cohérentes
 * partout). Largeur min fixe → colonnes alignées dans les listes.
 */
export function SeverityBadge({
  severity,
  size = "xs",
  fullWidth = true,
}: {
  severity: string;
  size?: "xs" | "sm" | "md";
  fullWidth?: boolean;
}) {
  return (
    <Badge
      size={size}
      color={severityColor(severity)}
      variant={severityVariant(severity)}
      style={
        fullWidth
          ? { flexShrink: 0, minWidth: 78, textAlign: "center" }
          : { flexShrink: 0 }
      }
    >
      {severity}
    </Badge>
  );
}

/**
 * Libellé **en clair** + icône de chaque capacité d'un driver. Le `label` est en
 * français parlant (pas de jargon « queryable ») ; `tech` garde le nom technique
 * du contrat (`write`/`query`/`stream`) pour les développeurs, affiché en second
 * dans le tooltip.
 */
const CAPABILITY_META: Record<
  keyof LogDriverCapabilities,
  {
    label: string;
    /** Libellé NÉGATIF affiché quand la capacité est absente (≠ label grisé,
     *  déstabilisant : « Non persistant » dit clairement ce qui manque). */
    labelOff: string;
    tech: string;
    icon: FC<{ size?: number }>;
    help: string;
    /** Aide spécifique à l'état ABSENT (sinon « non disponible sur ce driver »). */
    helpOff?: string;
  }
> = {
  write: {
    label: "Persistant",
    labelOff: "Non persistant",
    tech: "write",
    icon: IconDeviceFloppy,
    help: "Conserve les logs dans la durée : ils survivent à un redémarrage. Driver « en mémoire » = volatil (tout est perdu au reboot).",
  },
  query: {
    label: "Recherche",
    labelOff: "Sans recherche",
    tech: "query",
    icon: IconSearch,
    help: "Permet de FOUILLER l'historique : filtres, recherche plein-texte, suivi d'une requête (onglet Explorer). Sans elle, on ne peut que regarder le flux en direct, pas chercher dans le passé.",
  },
  stream: {
    label: "Temps réel",
    labelOff: "Live via le bus",
    tech: "stream",
    icon: IconBroadcast,
    help: "Ce driver EST lui-même la source du flux temps réel (seul « mémoire » l'est : il EST le ring buffer alimenté en direct).",
    helpOff:
      "Le temps réel ne vient pas de ce driver mais du bus « nodefony:syslog » (toujours actif). Tu ne perds donc PAS le direct : l'onglet Live fonctionne quel que soit le driver de relecture.",
  },
};

/**
 * **CapabilityBadges** — les 3 capacités d'un driver en badges **en clair**
 * (Persistant / Recherche / Temps réel) : vert plein si présente, gris barré
 * sinon. Chaque badge porte un tooltip qui explique la capacité + son nom
 * technique (`write`/`query`/`stream`) → auto-documentation, sans jargon.
 */
export function CapabilityBadges({
  capabilities,
  size = "sm",
}: {
  capabilities: LogDriverCapabilities;
  size?: "xs" | "sm";
}) {
  return (
    <Group gap={4} wrap="nowrap">
      {(Object.keys(CAPABILITY_META) as (keyof LogDriverCapabilities)[]).map(
        (cap) => {
          const meta = CAPABILITY_META[cap];
          const on = capabilities[cap];
          const Icon = meta.icon;
          // Design de popover UNIQUE = la fiche DocHint (même partout). Le chip
          // EST le déclencheur (survol/focus) ; présent = vert, absent = gris +
          // libellé négatif explicite.
          return (
            <DocHint
              key={cap}
              title={on ? meta.label : meta.labelOff}
              summary={
                on
                  ? meta.help
                  : (meta.helpOff ?? "Non disponible sur ce driver.")
              }
              width={300}
              sections={[
                {
                  label: "Contrat technique",
                  body: (
                    <Code style={{ fontSize: 11 }}>
                      capabilities.{meta.tech}
                    </Code>
                  ),
                },
              ]}
            >
              <Badge
                size={size}
                variant="light"
                color={on ? "teal" : "gray"}
                leftSection={<Icon size={11} />}
                tabIndex={0}
                style={{ cursor: "help" }}
              >
                {on ? meta.label : meta.labelOff}
              </Badge>
            </DocHint>
          );
        },
      )}
    </Group>
  );
}

/**
 * **SeverityCountChips** — compteurs par sévérité, **cliquables** = bascule un
 * filtre (santé en un coup d'œil + filtrage immédiat). Une sévérité à 0 est
 * masquée (pas de bruit). La sévérité active est mise en avant (variant plein).
 * Ergonomie calme : le style ne dépend QUE de l'état actif (pas de la valeur qui
 * tique) → pas de clignotement quand un compteur s'incrémente.
 */
export function SeverityCountChips({
  counts,
  active,
  onToggle,
}: {
  counts: Record<Severity, number>;
  /** Sévérités actuellement filtrées (vide = aucune). */
  active: ReadonlySet<Severity>;
  onToggle: (severity: Severity) => void;
}) {
  const entries = (Object.entries(counts) as [Severity, number][]).filter(
    ([, n]) => n > 0,
  );
  if (entries.length === 0) return null;
  return (
    <Group gap={4} wrap="wrap">
      {entries.map(([sev, n]) => {
        const isActive = active.has(sev);
        return (
          <Badge
            key={sev}
            component="button"
            type="button"
            onClick={() => onToggle(sev)}
            size="sm"
            color={severityColor(sev)}
            variant={isActive ? "filled" : "light"}
            style={{ cursor: "pointer" }}
            aria-pressed={isActive}
            aria-label={`${sev} : ${n} — ${isActive ? "retirer du filtre" : "filtrer"}`}
            rightSection={
              <Text
                span
                size="xs"
                fw={700}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {n}
              </Text>
            }
          >
            {sev}
          </Badge>
        );
      })}
    </Group>
  );
}
