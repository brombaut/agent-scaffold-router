export interface ClientOptions {
  baseURL: string;
  /** Request timeout in milliseconds. */
  timeoutMs: number;
  retries: number;
}

export const DEFAULTS: Omit<ClientOptions, "baseURL"> = {
  timeoutMs: 5000,
  retries: 3,
};

export function clientOptions(opts: Partial<ClientOptions> & { baseURL: string }): ClientOptions {
  return { ...DEFAULTS, ...opts };
}
