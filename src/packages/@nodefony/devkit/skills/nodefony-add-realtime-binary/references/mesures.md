# Les mesures du binaire — de quoi décider, avec leurs conditions

> Chargé depuis `SKILL.md` §2 quand une décision de codec ou de représentation se discute. Toutes
> les valeurs viennent des bancs du framework (Node 26) ; une valeur sans ses conditions ne vaut
> rien — elles sont donc écrites à côté. Les pages installées qui portent une partie de ces
> chiffres : `nodefony/docs/cbor.md` (« Performance & mémoire »), `nodefony/docs/client.md`
> (« Choisir le codec de trame »). **Une mesure de ce tableau ne remplace pas la tienne** : ta
> donnée a sa forme, mesure-la (`SKILL.md` §10).

## 1. Codec : JSON (octets en base64) contre CBOR — trames réelles, médiane de 7 séries

| Charge                                  | Taille JSON → CBOR                | Décodage JSON → CBOR | Lecture                                |
| --------------------------------------- | --------------------------------- | -------------------- | -------------------------------------- |
| 64 Ko d'octets                          | 87 452 o → 65 582 o (−25 %)       | 541 µs → 0,9 µs      | CBOR écrase JSON                       |
| 1 Mo d'octets                           | 1 398 174 o → 1 048 622 o (−25 %) | 9 488 µs → 1 µs      | CBOR écrase JSON                       |
| 4 Ko d'octets, réception navigateur     | −25 % d'octets                    | 26 454 ns → 792 ns   | ≈ 33× plus rapide                      |
| objet de supervision (nombres, statuts) | 1 541 o → 1 172 o (−24 %)         | 7,9 µs → 11,1 µs     | CBOR plus court, mais plus lent à lire |
| objet de santé d'une socket             | 1 526 o → 1 256 o (−18 %)         | 9,5 µs → 18,2 µs     | CBOR plus court, mais plus lent à lire |
| message de chat (salon)                 | 115 o → 89 o                      | —                    | gain de taille faible sur du texte     |
| notification privée de chat             | 183 o → 150 o                     | —                    | idem                                   |

Le codec CBOR pèse environ 5,5 Ko compressés côté navigateur (sous-chemin `nodefony/cbor`, chargé
seulement par les pages qui l'importent). Un accélérateur natif de décodage CBOR a été essayé : il
n'apportait rien face à `JSON.parse` natif sur les objets, et CBOR pur suffit sur les octets.

## 2. Représentation de la donnée — la forme compte plus que le codec

| Donnée                                         | Comparaison                          | Lecture                                                                      |
| ---------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------- |
| spectre de compteurs en `Uint32Array`          | 4 114 o (CBOR) contre 3 128 o (JSON) | **le binaire PERD** : petits entiers courts en texte, `u32` = 4 octets fixes |
| 1 000 tirs d'une mesure, bits tassés           | 142 o contre 2 025 o (JSON)          | tasser gagne d'un ordre de grandeur                                          |
| comptes agrégés d'une mesure                   | 30 o                                 | publier l'agrégat, pas la matière brute                                      |
| fenêtre de capteur réduite (min, max, moyenne) | 176 o (CBOR) contre 307 o (JSON)     | réduire côté serveur, publier à la cadence du serveur                        |
| historique de 600 points en `Float64Array`     | 28,9 Ko (CBOR) contre 38,6 Ko (JSON) | colonnes typées : gain de taille ET de décodage                              |

## 3. Le bus entre serveurs

| Bus                                      | Condition                 | CBOR contre JSON + base64                                                                                                                  |
| ---------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Redis scellé                             | charge de 16 Ko, médianes | −25 % d'octets, +30 % de débit, −11 % de latence médiane, +15 à 30 % de CPU par message (ramasse-miettes : un tampon hors tas par message) |
| IPC de `nodefony cluster` (« advanced ») | maître + ouvriers         | −23 % de débit à 64 o, ×2,2 à 64 Ko ; ~1 µs par saut — retenu partout, sans écart développement / production                               |

## 4. Le coût du binaire pour qui ne s'en sert pas

- Le chemin binaire n'est armé QUE si un codec binaire est configuré : un parcours armé en
  permanence coûtait +20 à +35 % sur le chemin texte, il a été écarté.
- Une application qui ne publie pas d'octets ne paie rien de plus (contrôle au premier niveau
  seulement, sans codec).

## 5. Bornes en vigueur

| Borne                                             | Valeur           | Effet au dépassement                       |
| ------------------------------------------------- | ---------------- | ------------------------------------------ |
| `websocket.maxPayload` (`@nodefony/http`)         | 1 Mio par défaut | fermeture `1009` de la socket              |
| `maxFramesPerSecond` (`@nodefony/http`)           | `0` = désactivé  | refus comptés, puis fermeture sur un solde |
| `backpressureCloseAfterDrops` (serveur et client) | 1 000            | fermeture (`1013` serveur, `4007` client)  |
| `maxBufferedAmount` (navigateur)                  | `0` = désactivé  | envois en trop jetés, comptés              |
