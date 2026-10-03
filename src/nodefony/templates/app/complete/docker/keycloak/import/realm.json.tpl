{
  "realm": "<%= it.appName %>",
  "displayName": "<%= it.appName %>",
  "enabled": true,
  "sslRequired": "external",
  "registrationAllowed": false,
  "loginWithEmailAllowed": true,
  "internationalizationEnabled": true,
  "supportedLocales": ["fr", "en"],
  "defaultLocale": "fr",
  "clients": [
    {
      "clientId": "<%= it.appName %>",
      "name": "<%= it.appName %> (dev)",
      "description": "Client confidentiel de l'application en développement — secret PUBLIC, jamais en production.",
      "enabled": true,
      "protocol": "openid-connect",
      "publicClient": false,
      "clientAuthenticatorType": "client-secret",
      "secret": "<%= it.keycloak.clientSecret %>",
      "standardFlowEnabled": true,
      "implicitFlowEnabled": false,
      "directAccessGrantsEnabled": false,
      "serviceAccountsEnabled": false,
      "frontchannelLogout": false,
      "redirectUris": [
        "https://localhost:5152/nodefony/security/api/oauth2/keycloak/callback",
        "http://localhost:5151/nodefony/security/api/oauth2/keycloak/callback"
      ],
      "webOrigins": ["+"],
      "attributes": {
        "pkce.code.challenge.method": "S256",
        "post.logout.redirect.uris": "https://localhost:5152/*##http://localhost:5151/*"
      },
      "protocolMappers": [
        {
          "name": "audience-<%= it.appName %>-api",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-audience-mapper",
          "config": {
            "included.custom.audience": "https://localhost:5152",
            "access.token.claim": "true",
            "id.token.claim": "false",
            "introspection.token.claim": "true"
          }
        }
      ]
    },
    {
      "clientId": "<%= it.appName %>-machine",
      "name": "<%= it.appName %> — appelant machine (compte de service)",
      "description": "Appelant machine : obtient un jeton d'accès par client_credentials, sans utilisateur. Secret PUBLIC, jamais en production.",
      "enabled": true,
      "protocol": "openid-connect",
      "publicClient": false,
      "clientAuthenticatorType": "client-secret",
      "secret": "<%= it.keycloak.machineSecret %>",
      "standardFlowEnabled": false,
      "implicitFlowEnabled": false,
      "directAccessGrantsEnabled": false,
      "serviceAccountsEnabled": true,
      "protocolMappers": [
        {
          "name": "audience-<%= it.appName %>-api",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-audience-mapper",
          "config": {
            "included.custom.audience": "https://localhost:5152",
            "access.token.claim": "true",
            "id.token.claim": "false",
            "introspection.token.claim": "true"
          }
        }
      ]
    }
  ],
  "users": [
    {
      "id": "<%= it.keycloak.userId %>",
      "username": "alice",
      "enabled": true,
      "email": "alice@<%= it.appName %>.test",
      "emailVerified": true,
      "firstName": "Alice",
      "lastName": "Keycloak",
      "credentials": [
        {
          "type": "password",
          "value": "alice-dev",
          "temporary": false
        }
      ]
    }
  ],
  "rememberMe": true
}
