import { useMemo, useState } from "react";
import {
  Card,
  Stack,
  Group,
  Title,
  TextInput,
  Button,
  ThemeIcon,
  Divider,
} from "@mantine/core";
import { IconUser, IconDeviceFloppy } from "@tabler/icons-react";
import { AvatarUpload } from "./AvatarUpload";
import { PROFILE_FIELD_DEFS, type UserProfileData } from "./userAdminModel";

/**
 * Carte d'édition du **profil d'affichage** (avatar + claims OIDC :
 * prénom/nom/displayName/email/langue). Agnostique du mode : le parent fournit
 * `onSubmit(profile)` qui sait l'envoyer (admin → `PATCH users/{id}` `{profile}` ;
 * self → `POST me/profile`). Un champ vidé = effacement (géré côté serveur).
 */
export function ProfileFields({
  profile,
  identifier,
  onSubmit,
  saving,
  disabled,
}: {
  profile: UserProfileData;
  identifier: string;
  onSubmit: (next: UserProfileData) => void | Promise<void>;
  saving?: boolean;
  disabled?: boolean;
}) {
  // `profile` = valeur INITIALE (pas de resync auto : on garde l'édition en cours
  // cohérente après save ; un rechargement de page remonte le composant).
  const [draft, setDraft] = useState<UserProfileData>(profile);
  const initial = useMemo(() => JSON.stringify(profile), [profile]);
  const dirty = JSON.stringify(draft) !== initial;

  const setField = (key: keyof UserProfileData, value: string): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <Card withBorder padding="lg" radius="md">
      <Group gap="xs" mb="md">
        <ThemeIcon variant="light" size="md">
          <IconUser size={18} />
        </ThemeIcon>
        <Title order={4}>Profil</Title>
      </Group>

      <Stack gap="md">
        <AvatarUpload
          profile={draft}
          identifier={identifier}
          onChange={(picture) => setField("picture", picture)}
          disabled={disabled || saving}
        />

        <Divider />

        <Group grow align="flex-start" wrap="wrap">
          {PROFILE_FIELD_DEFS.map((f) => (
            <TextInput
              key={f.key}
              label={f.label}
              placeholder={f.placeholder}
              value={draft[f.key] ?? ""}
              onChange={(e) => setField(f.key, e.currentTarget.value)}
              disabled={disabled || saving}
              type={f.key === "email" ? "email" : "text"}
              autoComplete="off"
            />
          ))}
        </Group>

        <Group justify="flex-end">
          <Button
            leftSection={<IconDeviceFloppy size={16} />}
            loading={saving}
            disabled={disabled || !dirty}
            onClick={() => onSubmit(draft)}
          >
            Enregistrer le profil
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

export default ProfileFields;
