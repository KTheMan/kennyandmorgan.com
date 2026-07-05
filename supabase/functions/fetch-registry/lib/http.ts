import { ScraperConfig } from "../types.ts";

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export interface AntiBotHeaders {
  "User-Agent": string;
  Accept: string;
  "Accept-Language": string;
  "Accept-Encoding"?: string;
  DNT?: string;
  Connection?: string;
  "Upgrade-Insecure-Requests"?: string;
  "Sec-Fetch-Dest"?: string;
  "Sec-Fetch-Mode"?: string;
  "Sec-Fetch-Site"?: string;
}

export function buildAntiBotHeaders(
  userAgent = DEFAULT_USER_AGENT,
): AntiBotHeaders {
  return {
    "User-Agent": userAgent,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    DNT: "1",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
  };
}

export class FetchTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = "FetchTimeoutError";
  }
}

export class FetchHttpError extends Error {
  readonly status: number;
  readonly statusText: string;

  constructor(response: Response) {
    super(
      `HTTP ${response.status} ${response.statusText} for ${response.url}`,
    );
    this.name = "FetchHttpError";
    this.status = response.status;
    this.statusText = response.statusText;
  }
}

export function fetchWithTimeout(
  url: string,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { signal: controller.signal }).finally(() => {
    clearTimeout(timeoutId);
  }).catch((error) => {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new FetchTimeoutError(url, timeoutMs);
    }
    throw error;
  });
}

export async function fetchHtmlWithAntiBotHeaders(
  url: string,
  config: ScraperConfig = {},
): Promise<Response> {
  const timeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const response = await fetchWithTimeout(url, timeoutMs);

  if (!response.ok) {
    throw new FetchHttpError(response);
  }

  return response;
}

export async function fetchTextWithAntiBotHeaders(
  url: string,
  config: ScraperConfig = {},
): Promise<{ text: string; responseUrl: string }> {
  const timeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const headers = buildAntiBotHeaders(config.userAgent ?? DEFAULT_USER_AGENT);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: "follow",
    });

    if (!response.ok) {
      throw new FetchHttpError(response);
    }

    const text = await response.text();
    return { text, responseUrl: response.url || url };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new FetchTimeoutError(url, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
