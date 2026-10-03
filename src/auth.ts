import type { Config } from "./config.ts";

/**
 * Resolves the upstream API key without ever logging it.
 * Order: the configured env var, then OpenCode's stored "opencode" credential
 * (read in-process via `opencode auth export`).
 */
export async function resolveApiKey(cfg: Config): Promise<string | null> {
  const fromEnv = process.env[cfg.upstream.apiKeyEnv];
  if (fromEnv) return fromEnv;
  return readOpenCodeCredential();
}

interface ExportedCredential {
  integrationID: string;
  active: boolean;
  value: { type: string; key?: string };
}

export async function readOpenCodeCredential(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["opencode", "auth", "export"], { stdout: "pipe", stderr: "ignore", cwd: "/tmp" });
    const text = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) return null;
    const creds = JSON.parse(text) as ExportedCredential[];
    const match = creds.find((c) => c.integrationID === "opencode" && c.active && c.value.type === "key");
    return match?.value.key ?? null;
  } catch {
    return null;
  }
}

/** Builds the Authorization header to send upstream. */
export function upstreamAuthorization(cfg: Config, clientHeader: string | null, key: string | null): string | null {
  if (cfg.upstream.auth === "forward" && clientHeader) return clientHeader;
  return key ? `Bearer ${key}` : clientHeader;
}
