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
      "frontchannelLogout": true,
      "redirectUris": [
        "https://localhost:5152/nodefony/security/api/oauth2/keycloak/callback",
        "http://localhost:5151/nodefony/security/api/oauth2/keycloak/callback"
      ],
      "webOrigins": ["+"],
      "attributes": {
        "pkce.code.challenge.method": "S256",
        "post.logout.redirect.uris": "https://localhost:5152/*##http://localhost:5151/*"
      }
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
