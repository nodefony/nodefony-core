# gRPC, gRPC-Web, Connect, protobuf — index hors ligne

Copies figées par page (`AMONT.json`, suivies par `check-amont.mjs`). Les RFC du transport ne sont
PAS ici : 9110 (trailers), 9112, 9113 (HTTP/2, h2c par connaissance préalable §3.3) et 7301 (ALPN)
vivent dans le corpus unique, `nodefony-framework-dev/references/rfc/ietf/`.

| Ce qu'on veut savoir                                                        | Fichier                                                         |
| --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Le fil gRPC : en-têtes, `te: trailers`, `grpc-timeout`, cadrage, trailers   | `grpc-PROTOCOL-HTTP2.md`                                        |
| gRPC-Web : trailers DANS le corps (bit de poids fort du 1er octet de trame) | `grpc-PROTOCOL-WEB.md`                                          |
| Codes de statut, et leur correspondance avec HTTP                           | `grpc-statuscodes.md`, `grpc-http-grpc-status-mapping.md`       |
| Compression, keepalive (flux longs), attente de disponibilité               | `grpc-compression.md`, `grpc-keepalive.md`, `grpc-wait-for-ready.md` |
| Santé (sonde k8s) et réflexion (ce que lit `grpcurl` sans `.proto`)         | `grpc-health-checking.md`, `grpc-server-reflection.md`, `grpc-health-v1.proto`, `grpc-reflection-v1.proto` |
| Le statut riche d'erreur                                                    | `google-rpc-status.proto`, `google-rpc-code.proto`              |
| Le protocole Connect (unaire en HTTP/1.1 `POST` ou `GET`, flux)             | `connect-protocol.md`, `connect-multi-protocol.md`              |
| L'adaptateur `(req, res)` pour Node, `fallback`, délais, flux               | `connect-node-*.md`, `connect-node-README.md`                   |
| CORS pour gRPC-Web et Connect depuis un navigateur                          | `connect-cors.md`                                               |
| L'encodage protobuf (varint, longueur préfixée) et proto3, ProtoJSON        | `protobuf-encoding.md`, `protobuf-proto3.md`, `protobuf-json.md` |
| `@bufbuild/protobuf` : code généré, sérialisation, navigateur ET Node       | `protobuf-es-*.md`                                              |
| Proxys : `grpc_pass` (nginx), filtre gRPC-Web (Envoy)                       | `nginx-ngx_http_grpc_module.xml`, `envoy-grpc_web_filter.rst`   |
| Le client de test en ligne de commande                                      | `grpcurl-README.md`                                             |

## Les faits qui décident d'un service gRPC dans le pipeline

1. **Le statut d'un appel est TOUJOURS dans les trailers**, même quand tout va bien
   (`grpc-PROTOCOL-HTTP2.md`, « Status must be sent in Trailers even if the status code is OK »).
   Une erreur immédiate peut partir en _Trailers-Only_ (une seule trame HEADERS). Un statut HTTP
   500 n'est donc pas une erreur gRPC.
2. **Un `content-type` qui ne commence pas par `application/grpc` appelle un `415`**. Sinon un
   client HTTP/2 ordinaire prendrait le `200` d'une erreur gRPC pour un succès.
3. **gRPC-Web n'a pas de trailers HTTP** : il les encode dans le corps, dans une trame dont le bit
   de poids fort du premier octet vaut 1. C'est ce qui le rend jouable en HTTP/1.1 et depuis un
   navigateur.
4. **Connect sert l'unaire en HTTP/1.1 simple**, `application/proto` ou `application/json`, et
   même en `GET` cachable. Seuls les flux exigent HTTP/2.
5. **`connectNodeAdapter` rend un `404` hors de ses routes**, sauf `fallback`. Monté dans le
   pipeline, c'est par `fallback` qu'il rend la main au routeur de Nodefony.
6. **`grpcurl` a besoin de la réflexion ou des `.proto`** ; `-plaintext` pour le h2c (5153).
