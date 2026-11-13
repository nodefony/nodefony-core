edition = "2024";

package demo.telemetry.v1;

import "google/protobuf/timestamp.proto";

// Une machine pousse ses mesures ; la page les suit par la socket de la démo.
service TelemetryService {
  // Flux client : la machine envoie tant qu'elle mesure, une seule réponse à la fin.
  rpc Push(stream PushRequest) returns (PushResponse);
  // Unaire, sans effet de bord : servi aussi en GET, qu'un cache et curl savent lire.
  rpc Latest(LatestRequest) returns (LatestResponse) {
    option idempotency_level = NO_SIDE_EFFECTS;
  }
}

// Une mesure, datée par la machine qui l'a prise.
message Reading {
  string machine = 1;
  double celsius = 2;
  google.protobuf.Timestamp measured_at = 3;
}

message PushRequest {
  Reading reading = 1;
}

message PushResponse {
  // Mesures retenues par le serveur, sur toute la durée du flux.
  uint32 accepted = 1;
}

message LatestRequest {
  string machine = 1;
}

message LatestResponse {
  // Absente tant que la machine n'a rien envoyé.
  Reading reading = 1;
}
