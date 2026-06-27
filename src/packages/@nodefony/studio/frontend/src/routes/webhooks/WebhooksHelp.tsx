/**
 * Onglet **Aide & utilisation** de la console Webhooks — explique le modèle
 * (événements d'audit → livraison signée), la vérification de signature
 * (Standard Webhooks v1), les protections (SSRF, retries, auto-désactivation) et
 * le catalogue d'événements. Vitrine pédagogique, 0 secret, texte/Code only.
 */
import { Stack, Title, Text, Code, List, Alert, Table } from "@mantine/core";
import {
  IconShieldCheck,
  IconAlertTriangle,
  IconAsterisk,
} from "@tabler/icons-react";
import { WEBHOOK_EVENT_CATALOGUE } from "./webhooksModel";

export function WebhooksHelp() {
  return (
    <Stack gap="lg" maw={820}>
      <div>
        <Title order={4} mb={4}>
          Qu'est-ce qu'un webhook ?
        </Title>
        <Text size="sm" c="dimmed">
          Un webhook notifie une <strong>URL externe</strong> (votre
          application, un SIEM, un canal Slack…) chaque fois qu'un{" "}
          <strong>événement d'audit</strong> souscrit survient côté serveur.
          Nodefony envoie une requête <Code>POST</Code> signée à la destination
          ; à charge du destinataire de vérifier la signature puis de traiter
          l'événement.
        </Text>
      </div>

      <div>
        <Title order={4} mb={4}>
          Vérifier la signature (Standard Webhooks v1)
        </Title>
        <Text size="sm" c="dimmed" mb="xs">
          Chaque livraison porte trois en-têtes ; le destinataire recalcule la
          signature avec le <strong>secret de l'endpoint</strong> et la compare
          en temps constant :
        </Text>
        <List size="sm" spacing={4}>
          <List.Item>
            <Code>webhook-id</Code> — identifiant unique de la livraison
            (idempotence côté récepteur).
          </List.Item>
          <List.Item>
            <Code>webhook-timestamp</Code> — epoch (s) ; rejeter si trop ancien
            (anti-rejeu).
          </List.Item>
          <List.Item>
            <Code>webhook-signature</Code> —{" "}
            <Code>v1,&lt;base64(HMAC-SHA256)&gt;</Code> de la chaîne{" "}
            <Code>{`{id}.{timestamp}.{payload}`}</Code>.
          </List.Item>
        </List>
        <Alert
          variant="light"
          color="gray"
          icon={<IconShieldCheck size={16} />}
          mt="xs"
        >
          <Text size="xs">
            Format conforme à la spécification{" "}
            <strong>Standard Webhooks</strong> — la plupart des SDK (
            <Code>standardwebhooks</Code>, Svix…) vérifient ces en-têtes
            nativement. Un slot <Code>v1a</Code> (Ed25519) est réservé pour une
            signature asymétrique future.
          </Text>
        </Alert>
      </div>

      <div>
        <Title order={4} mb={4}>
          Protections
        </Title>
        <List size="sm" spacing={4}>
          <List.Item>
            <strong>Anti-SSRF</strong> : l'URL est refusée si elle pointe vers
            une IP privée/interne (RFC 6890) ; les redirections <Code>3xx</Code>{" "}
            ne sont pas suivies ; l'IP résolue est épinglée à la livraison
            (anti-rebinding DNS).
          </List.Item>
          <List.Item>
            <strong>Retries bornés</strong> : un échec déclenche quelques
            tentatives avec backoff ; au-delà d'un seuil d'échecs consécutifs,
            l'endpoint est <strong>auto-désactivé</strong> (un événement d'audit{" "}
            <Code>webhook.disabled</Code> est tracé).
          </List.Item>
          <List.Item>
            <strong>Anti-DoS</strong> : concurrence et file d'attente bornées —
            un destinataire lent ou mort ne met jamais le framework en danger.
          </List.Item>
          <List.Item>
            <strong>Secret chiffré au repos</strong> (AES-256-GCM, réversible
            pour signer) — jamais stocké ni journalisé en clair.
          </List.Item>
        </List>
      </div>

      <div>
        <Title order={4} mb={4}>
          Événements disponibles
        </Title>
        <Text size="sm" c="dimmed" mb="xs">
          Un webhook s'abonne à des <strong>actions d'audit</strong> (
          <Code>{`<sujet>.<verbe>`}</Code>). Cochez <IconAsterisk size={11} />{" "}
          <strong>Tous les événements</strong> pour tout recevoir, ou choisissez
          dans le catalogue ci-dessous (complétable en saisie libre — la liste
          s'enrichit au fil des versions).
        </Text>
        <Table withTableBorder withColumnBorders striped="odd">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Domaine</Table.Th>
              <Table.Th>Action</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {WEBHOOK_EVENT_CATALOGUE.map((g) =>
              g.events.map((ev, i) => (
                <Table.Tr key={ev.value}>
                  {i === 0 && (
                    <Table.Td rowSpan={g.events.length}>
                      <Text size="sm" fw={600}>
                        {g.domain}
                      </Text>
                    </Table.Td>
                  )}
                  <Table.Td>
                    <Code>{ev.value}</Code>{" "}
                    <Text span size="xs" c="dimmed">
                      {ev.label.replace(`${ev.value} — `, "")}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )),
            )}
          </Table.Tbody>
        </Table>
        <Alert
          variant="light"
          color="orange"
          icon={<IconAlertTriangle size={16} />}
          mt="xs"
        >
          <Text size="xs">
            Les événements de la catégorie <Code>webhook.*</Code> ne sont{" "}
            <strong>pas</strong> livrables (garde anti-boucle : un webhook ne
            déclenche pas un webhook).
          </Text>
        </Alert>
      </div>
    </Stack>
  );
}
