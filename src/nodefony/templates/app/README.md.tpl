# {{appName}}

Application [Nodefony](https://github.com/nodefony/nodefony-core) — générée par `nodefony create app`.

## Démarrer

```bash
npm install
npm run build        # bundle rolldown (dist/)
npm run dev          # serveur de développement → http://127.0.0.1:5151
```

```bash
curl http://127.0.0.1:5151/api/hello
```

## Structure

| Fichier                    | Rôle                                                                  |
| -------------------------- | --------------------------------------------------------------------- |
| `nodefony.config.ts`       | LA config de l'app — uniquement les écarts aux défauts du framework   |
| `env.ts`                   | Catalogue typé des variables d'environnement (seul lecteur de `process.env`) |
| `index.ts`                 | Point d'entrée : la classe `App` (module racine) + ses controllers    |
| `nodefony/controllers/`    | Tes controllers (`@controller` + `@route`)                            |
| `rolldown.config.ts`       | Build — délègue tout au socle `nodefony/bundler`                      |

## Production (cloud-native)

```bash
npm run build
npm start            # nodefony production — bind 0.0.0.0, logs stdout, probes /livez /readyz
```

Un process Node = un pod/container ; le scaling horizontal vient de l'orchestrateur.
