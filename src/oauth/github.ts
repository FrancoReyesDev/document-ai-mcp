import { logger } from "../logger.js";

export interface GitHubProfile {
  githubId: string;
  email: string;
  name: string;
  avatarUrl: string;
}

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

const USER_AGENT = "document-ai-mcp";

export async function exchangeCodeForAccessToken(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw new Error(`GitHub token exchange failed: ${res.status}`);
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!body.access_token) throw new Error(`GitHub token exchange: ${body.error ?? "no access_token"}`);
  return body.access_token;
}

export async function fetchGitHubProfile(accessToken: string): Promise<GitHubProfile> {
  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": USER_AGENT, Accept: "application/vnd.github+json" },
  });
  if (!userRes.ok) throw new Error(`GitHub /user failed: ${userRes.status}`);
  const user = (await userRes.json()) as GitHubUser;

  let email = user.email;
  if (!email) {
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": USER_AGENT, Accept: "application/vnd.github+json" },
    });
    if (!emailsRes.ok) throw new Error(`GitHub /user/emails failed: ${emailsRes.status}`);
    const emails = (await emailsRes.json()) as GitHubEmail[];
    email = emails.find((e) => e.primary && e.verified)?.email ?? emails.find((e) => e.verified)?.email ?? null;
  }
  if (!email) throw new Error("GitHub profile has no verified email");

  logger.info("Resolved GitHub profile", { githubId: String(user.id), email });

  return {
    githubId: String(user.id),
    email,
    name: user.name ?? user.login,
    avatarUrl: user.avatar_url,
  };
}

export function githubAuthorizeUrl(clientId: string, redirectUri: string, state: string, scopes = "user:email"): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state,
    allow_signup: "true",
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}
