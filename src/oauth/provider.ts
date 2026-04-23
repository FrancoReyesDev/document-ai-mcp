import Provider, { Configuration } from "oidc-provider";
import type { Firestore } from "@google-cloud/firestore";
import { makeFirestoreAdapter } from "./firestore-adapter.js";
import { getUserById } from "../storage/index.js";

export interface ProviderDeps {
  db: Firestore;
  issuer: string;
  webClientId: string;
  webClientSecret: string;
  webRedirectUri: string;
  cookieKeys: string[];
  jwks: Configuration["jwks"];
}

export function createOidcProvider(deps: ProviderDeps): Provider {
  const Adapter = makeFirestoreAdapter(deps.db);

  const configuration: Configuration = {
    adapter: Adapter,
    clients: [
      {
        client_id: deps.webClientId,
        client_secret: deps.webClientSecret,
        redirect_uris: [deps.webRedirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
        application_type: "web",
      },
    ],
    jwks: deps.jwks,
    cookies: {
      keys: deps.cookieKeys,
      long: { signed: true, secure: true, sameSite: "lax", httpOnly: true },
      short: { signed: true, secure: true, sameSite: "lax", httpOnly: true },
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: true, initialAccessToken: false, idFactory: () => crypto.randomUUID() },
      revocation: { enabled: true },
      rpInitiatedLogout: { enabled: true },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => deps.issuer,
        getResourceServerInfo: () => ({
          scope: "openid profile email",
          audience: deps.issuer,
          accessTokenTTL: 7 * 24 * 60 * 60,
          accessTokenFormat: "opaque",
        }),
        useGrantedResource: () => true,
      },
    },
    pkce: { required: () => true },
    scopes: ["openid", "profile", "email", "offline_access"],
    enabledJWA: {
      idTokenSigningAlgValues: ["ES256"],
      userinfoSigningAlgValues: ["ES256"],
      requestObjectSigningAlgValues: ["ES256"],
    },
    clientDefaults: {
      grant_types: ["authorization_code", "refresh_token"],
      id_token_signed_response_alg: "ES256",
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    claims: {
      openid: ["sub"],
      email: ["email", "email_verified"],
      profile: ["name", "picture"],
    },
    interactions: {
      url: (_ctx, interaction) => `/oauth/interaction/${interaction.uid}`,
    },
    ttl: {
      AccessToken: 7 * 24 * 60 * 60,      // 7 days
      RefreshToken: 30 * 24 * 60 * 60,    // 30 days
      AuthorizationCode: 10 * 60,         // 10 min
      IdToken: 7 * 24 * 60 * 60,          // 7 days
      Interaction: 60 * 60,               // 1 hour
      Session: 14 * 24 * 60 * 60,         // 14 days
      Grant: 14 * 24 * 60 * 60,
    },
    async findAccount(_ctx, sub) {
      const user = await getUserById(sub);
      if (!user) return undefined;
      return {
        accountId: user.userId,
        async claims() {
          return {
            sub: user.userId,
            email: user.email,
            email_verified: true,
            name: user.name ?? undefined,
            picture: user.avatarUrl ?? undefined,
          };
        },
      };
    },
  };

  const provider = new Provider(deps.issuer, configuration);
  provider.proxy = true;
  return provider;
}
