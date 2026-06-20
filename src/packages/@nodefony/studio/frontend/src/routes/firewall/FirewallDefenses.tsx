/**
 * Section **Défenses** de la console Firewall — CSRF / CORS / en-têtes de sécurité
 * / throttle de login (NIST). État activé/désactivé + détails NON sensibles
 * (secrets exclus côté serveur). Données issues de `GET .../api/firewall`.
 */
import type { ReactNode } from "react";
import {
  Card,
  Grid,
  Group,
  Stack,
  Text,
  Code,
  Box,
  ThemeIcon,
  Alert,
  ScrollArea,
} from "@mantine/core";
import {
  IconShieldLock,
  IconWorld,
  IconHeading,
  IconHandStop,
  IconInfoCircle,
} from "@tabler/icons-react";

import { DocHint, type DocSection } from "../../components/ui";
import { FIREWALL_DOC, type FirewallDefenses } from "./firewallModel";
import { OnOffBadge } from "./firewallFormat";

/** Ligne label → valeur (valeur = nœud riche : badge, code, liste…). */
function Field({ k, children }: { k: string; children: ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="md" align="flex-start">
      <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
        {k}
      </Text>
      <Box style={{ textAlign: "right", minWidth: 0 }}>{children}</Box>
    </Group>
  );
}

/** Valeur scalaire parlante (bool → activé/désactivé, vide → « aucun »). */
function Val({ children }: { children: ReactNode }) {
  return (
    <Text size="sm" style={{ wordBreak: "break-word" }}>
      {children}
    </Text>
  );
}

/** Liste d'origines/valeurs, ou « aucune ». */
function List({ items }: { items: string[] }) {
  if (items.length === 0) {
    return (
      <Text size="sm" c="dimmed" fs="italic">
        aucune
      </Text>
    );
  }
  return (
    <Group gap={4} justify="flex-end" wrap="wrap">
      {items.map((i) => (
        <Code key={i}>{i}</Code>
      ))}
    </Group>
  );
}

/** Carte d'une défense : en-tête (icône + titre + on/off + doc) puis détails. */
function DefenseCard({
  icon,
  title,
  enabled,
  doc,
  children,
}: {
  icon: ReactNode;
  title: string;
  enabled: boolean;
  doc: { summary: string; sections: DocSection[] };
  children: ReactNode;
}) {
  return (
    <Grid.Col span={{ base: 12, md: 6 }}>
      <Card withBorder radius="md" p="lg" h="100%">
        <Group justify="space-between" wrap="nowrap" mb="sm">
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon
              variant="light"
              color={enabled ? "teal" : "gray"}
              radius="sm"
            >
              {icon}
            </ThemeIcon>
            <Text fw={700}>{title}</Text>
            <DocHint
              title={title}
              version={FIREWALL_DOC}
              summary={doc.summary}
              sections={doc.sections}
            />
          </Group>
          <OnOffBadge on={enabled} />
        </Group>
        <Stack gap={6} style={{ opacity: enabled ? 1 : 0.55 }}>
          {children}
        </Stack>
      </Card>
    </Grid.Col>
  );
}

export function FirewallDefenses({
  defenses,
}: {
  defenses: FirewallDefenses | null;
}) {
  if (!defenses) {
    return (
      <Alert
        variant="light"
        color="red"
        icon={<IconInfoCircle size={18} />}
        title="Défenses indisponibles"
      >
        La configuration de sécurité est invalide au boot — le firewall est
        fail-closed (toutes les requêtes rejetées). Corrigez la config pour que
        les défenses se résolvent.
      </Alert>
    );
  }

  const { csrf, cors, headers, rateLimit } = defenses;

  return (
    <Grid>
      {/* ── CSRF ── */}
      <DefenseCard
        icon={<IconShieldLock size={18} />}
        title="CSRF"
        enabled={csrf.enabled}
        doc={{
          summary:
            "Protège des requêtes forgées cross-site. Défense primaire = Fetch Metadata (Sec-Fetch-Site, infalsifiable), repli Origin/Referer.",
          sections: [
            {
              label: "Synchronizer token",
              body: "« Armé » = @CsrfProtect dispose d'un secret HMAC (config en prod, éphémère en dev). La VALEUR du secret n'est jamais exposée.",
            },
          ],
        }}
      >
        <Field k="Fetch Metadata">
          <OnOffBadge on={csrf.fetchMetadata} />
        </Field>
        <Field k="Repli Origin/Referer">
          <OnOffBadge on={csrf.checkOrigin} />
        </Field>
        <Field k="Strict same-origin">
          <OnOffBadge
            on={csrf.strictSameSite}
            onLabel="Strict"
            offLabel="Tolérant"
          />
        </Field>
        <Field k="Cookie SameSite">
          <Code>{csrf.sameSite}</Code>
        </Field>
        <Field k="Synchronizer token">
          <OnOffBadge
            on={csrf.synchronizerToken}
            onLabel="Armé"
            offLabel="Inactif"
          />
        </Field>
        <Field k="Origines de confiance">
          <List items={csrf.trustedOrigins} />
        </Field>
      </DefenseCard>

      {/* ── CORS ── */}
      <DefenseCard
        icon={<IconWorld size={18} />}
        title="CORS"
        enabled={cors.enabled}
        doc={{
          summary:
            "Cross-Origin Resource Sharing : quelles origines tierces peuvent lire les réponses. `*` + credentials est interdit au boot (OWASP).",
          sections: [
            {
              label: "Credentials",
              body: "« Activé » = cookies cross-origin autorisés (exige une whitelist d'origines explicite).",
            },
          ],
        }}
      >
        <Field k="Origines autorisées">
          <List items={cors.origins} />
        </Field>
        <Field k="Credentials">
          <OnOffBadge on={cors.credentials} />
        </Field>
        <Field k="Méthodes">
          <Val>{cors.methods.join(", ")}</Val>
        </Field>
        <Field k="En-têtes autorisés">
          <Val>{cors.allowedHeaders.join(", ")}</Val>
        </Field>
        <Field k="Cache préflight">
          <Code>{cors.maxAgeS}s</Code>
        </Field>
      </DefenseCard>

      {/* ── En-têtes de sécurité ── */}
      <DefenseCard
        icon={<IconHeading size={18} />}
        title="En-têtes de sécurité"
        enabled={headers.enabled}
        doc={{
          summary:
            "CSP, Referrer-Policy, isolation cross-origin (COOP/COEP/CORP)… Le socle transport (HSTS/nosniff/frameguard) est posé par @nodefony/http.",
          sections: [
            {
              label: "CSP",
              body: "Politique « secure-but-usable » : seul script-src est strict (self + nonce par requête = défense XSS). Le {{nonce}} est substitué à chaque requête.",
            },
          ],
        }}
      >
        <Field k="HSTS (transport)">
          <OnOffBadge on={headers.hsts} />
        </Field>
        <Field k="Nonce CSP / requête">
          <OnOffBadge on={headers.cspNonces} />
        </Field>
        <Field k="Frameguard">
          <Code>{headers.frameguard}</Code>
        </Field>
        <Field k="nosniff (transport)">
          <OnOffBadge on={headers.noSniff} />
        </Field>
        <Field k="Referrer-Policy">
          <Code>{headers.referrerPolicy}</Code>
        </Field>
        <Box>
          <Text size="sm" c="dimmed" mb={4}>
            Content-Security-Policy
          </Text>
          <ScrollArea.Autosize mah={110}>
            <Code block style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>
              {headers.csp}
            </Code>
          </ScrollArea.Autosize>
        </Box>
      </DefenseCard>

      {/* ── Throttle login (NIST) ── */}
      <DefenseCard
        icon={<IconHandStop size={18} />}
        title="Throttle de login"
        enabled={rateLimit.enabled}
        doc={{
          summary:
            "Backoff progressif par identifiant (NIST SP 800-63B) : pas de verrouillage dur (qui offrirait un déni de service gratuit sur le compte victime). Bloqué → 429 + Retry-After.",
          sections: [],
        }}
      >
        <Field k="Essais libres">
          <Code>{rateLimit.freeAttempts}</Code>
        </Field>
        <Field k="Délai initial">
          <Code>{rateLimit.baseDelayS}s</Code>
        </Field>
        <Field k="Plafond du délai">
          <Code>{rateLimit.capDelayS}s</Code>
        </Field>
      </DefenseCard>
    </Grid>
  );
}
