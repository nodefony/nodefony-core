/**
 * Radiography — la **radiographie** d'une exécution du Playground : ce que le
 * serveur a réellement fait de la requête, entre le clic et la réponse.
 *
 * Le pont : chaque réponse porte `x-request-id`, et le Profiler (dev-only) a
 * indexé son profil sur cette clé → un GET sur `/nodefony/profiler/api/{id}`
 * rend la traversée complète :
 *
 *  - **le firewall** — la zone traversée, ce qu'elle acceptait, ce qui a
 *    RÉELLEMENT résolu l'identité (ou le motif exact du refus) ;
 *  - **le waterfall** — où le temps est passé (routing, parse, auth, action),
 *    requêtes ORM placées DANS la barre `action` ;
 *  - **les requêtes ORM** — le SQL paramétré, sa durée, ses lignes.
 *
 * Un 401 cesse d'être un mur : il dit par quelle zone il est passé et pourquoi
 * il a été refusé. Le forage exhaustif (logs corrélés, événements d'audit) vit
 * dans la page « Suivi de requête », liée en bas.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Card,
  Divider,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import { IconRadar2, IconShieldCheck, IconShieldX } from "@tabler/icons-react";
import { useStore } from "../../stores";
import type { ProfileEntry, ProfileSecurity } from "../../stores/ProfilerStore";
import { PhaseWaterfall, QueryTable, fmtMs } from "../logs/profileVisuals";

/** Délai avant la 2ᵉ tentative — cf `useProfile` (course avec le teardown). */
const RETRY_MS = 150;

/** Ce que dit chaque issue de zone, en clair. */
const OUTCOME_LABEL: Record<string, string> = {
  granted: "identité authentifiée",
  anonymous: "anonyme accepté (la zone l'autorise explicitement)",
  denied: "refusé — aucune preuve d'identité présentée",
  failure: "refusé — preuve présentée mais invalide",
  throttled: "ralenti — trop de tentatives (backoff NIST)",
  bypass: "zone traversée sans authentification (route exemptée)",
  public: "zone publique — aucune identité exigée",
};

/** Motifs de refus du firewall, en clair. */
const REASON_LABEL: Record<string, string> = {
  no_credentials: "aucun credential envoyé",
  invalid_credentials: "credential invalide",
  unauthenticated: "token non authentifié",
  throttled: "trop de tentatives",
};

function outcomeOk(outcome: string | null): boolean {
  return (
    outcome === "granted" ||
    outcome === "anonymous" ||
    outcome === "public" ||
    outcome === "bypass"
  );
}

/**
 * Charge le profil serveur d'une requête.
 *
 * Le Profiler collecte au **teardown** de la requête, qui peut se produire
 * juste APRÈS que le client ait reçu le corps → un premier GET peut légitimement
 * tomber sur un 404. On retente UNE fois ; au-delà, on le dit (jamais de
 * spinner infini).
 */
function useProfile(requestId: string | null) {
  const store = useStore();
  const [profile, setProfile] = useState<ProfileEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!requestId) return;
    setLoading(true);
    setError(null);
    const get = () =>
      store.api.getAbsolute<ProfileEntry>(
        `/nodefony/profiler/api/${encodeURIComponent(requestId)}`,
      );
    try {
      let entry: ProfileEntry;
      try {
        entry = await get();
      } catch (e) {
        if ((e as { status?: number }).status !== 404) throw e;
        await new Promise((r) => setTimeout(r, RETRY_MS));
        entry = await get();
      }
      setProfile(entry);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(
        status === 404
          ? "Profil introuvable : le profiler n'est actif qu'en développement (et ne garde que les 500 dernières requêtes)."
          : e instanceof Error
            ? e.message
            : "Erreur inattendue.",
      );
    } finally {
      setLoading(false);
    }
  }, [requestId, store]);

  useEffect(() => {
    setProfile(null);
    void load();
  }, [load]);

  return { profile, error, loading };
}

/** Ce que la zone acceptait × ce qui s'est réellement passé. */
function FirewallCard({ security }: { security: ProfileSecurity }) {
  const ok = outcomeOk(security.outcome);
  const label = security.outcome
    ? (OUTCOME_LABEL[security.outcome] ?? security.outcome)
    : "—";
  return (
    <Card withBorder padding="sm" radius="sm">
      <Group gap="xs" mb={6}>
        {ok ? (
          <IconShieldCheck size={16} color="var(--mantine-color-teal-6)" />
        ) : (
          <IconShieldX size={16} color="var(--mantine-color-red-6)" />
        )}
        <Text size="sm" fw={600}>
          Firewall
        </Text>
        <Badge size="sm" variant="light" color={ok ? "teal" : "red"}>
          {security.outcome ?? "—"}
        </Badge>
        {security.zone && (
          <Badge size="sm" variant="outline" color="gray">
            zone {security.zone}
          </Badge>
        )}
        {!security.protected && (
          <Badge size="sm" variant="light" color="gray">
            non protégée
          </Badge>
        )}
      </Group>

      <Text size="sm" mb={4}>
        {label}
        {security.reason && (
          <Text span c="red" size="sm">
            {" "}
            — {REASON_LABEL[security.reason] ?? security.reason}
          </Text>
        )}
      </Text>

      {/* Ce qui était POSSIBLE (la zone) vs ce qui a AGI (le maillon résolveur). */}
      {security.candidates.length > 0 && (
        <Text size="xs" c="dimmed">
          Authenticators acceptés ({security.mode ?? "first"}) :{" "}
          {security.candidates.map((c) => (
            <Badge
              key={c}
              size="xs"
              mr={4}
              variant={c === security.authenticator ? "filled" : "default"}
              color={c === security.authenticator ? "teal" : "gray"}
            >
              {c}
            </Badge>
          ))}
          {security.authenticator
            ? " — le maillon plein a résolu l'identité."
            : " — aucun n'a abouti."}
        </Text>
      )}

      {security.roles && security.roles.length > 0 && (
        <Text size="xs" c="dimmed" mt={4}>
          Rôles :{" "}
          {security.roles.map((r) => (
            <Badge key={r} size="xs" mr={4} variant="light" color="blue">
              {r}
            </Badge>
          ))}
        </Text>
      )}
    </Card>
  );
}

export interface RadiographyProps {
  /** `x-request-id` de la réponse — `null` = porte sans traçabilité (socket). */
  requestId: string | null;
}

/** Panneau « radiographie » sous les résultats d'une exécution Playground. */
export function Radiography({ requestId }: RadiographyProps) {
  const { profile, error, loading } = useProfile(requestId);

  if (!requestId) {
    // Fail-loud : jamais une case vide sans dire POURQUOI elle est vide. Deux
    // causes possibles, toutes deux vraies ici — pas d'identifiant de requête.
    return (
      <Alert
        variant="light"
        color="gray"
        icon={<IconRadar2 size={16} />}
        title="Radiographie indisponible : aucune réponse tracée"
      >
        La traversée s'indexe sur le <code>x-request-id</code> de la réponse. Le
        pont socket (<code>api.request</code>) n'en émet pas encore : le
        contexte WebSocket vit pour toute la connexion, pas pour un message — un
        profil par frame reste à concevoir. Et une requête HTTP qui n'aboutit
        pas (erreur réseau) n'a, elle, aucune réponse à tracer. Rejouez sur la
        porte HTTP.
      </Alert>
    );
  }

  if (loading && !profile) {
    return (
      <Group gap="xs" py="xs">
        <Loader size="xs" />
        <Text size="sm" c="dimmed">
          Lecture du profil serveur…
        </Text>
      </Group>
    );
  }

  if (error) {
    return (
      <Alert variant="light" color="yellow" icon={<IconRadar2 size={16} />}>
        {error}
      </Alert>
    );
  }

  if (!profile) return null;

  const queries = profile.queries ?? [];

  return (
    <Card withBorder padding="sm" radius="sm">
      <Group gap="xs" mb="xs">
        <IconRadar2 size={16} />
        <Text size="sm" fw={600}>
          Radiographie
        </Text>
        <Text size="xs" c="dimmed">
          {fmtMs(profile.durationMs)} serveur · {profile.user ?? "anonyme"}
        </Text>
      </Group>

      <Stack gap="sm">
        {profile.security ? (
          <FirewallCard security={profile.security} />
        ) : (
          <Text size="xs" c="dimmed">
            Aucune zone firewall traversée (route hors zone).
          </Text>
        )}

        <div>
          <Text size="xs" c="dimmed" mb={4}>
            Où le temps est passé
            {queries.length > 0 ? " (les requêtes ORM sont DANS l'action)" : ""}
          </Text>
          <PhaseWaterfall profile={profile} withQueries />
        </div>

        {queries.length > 0 && (
          <>
            <Divider />
            <QueryTable queries={queries} />
          </>
        )}

        <Anchor
          size="xs"
          href={`/nodefony/logs/trace/${encodeURIComponent(profile.requestId)}`}
          target="_blank"
        >
          Ouvrir le suivi de requête complet (logs corrélés, audit) →
        </Anchor>
      </Stack>
    </Card>
  );
}
