// Runtime config loader, mirroring the main site's site-config.js.
//
// This app is published as a static subfolder of the wedding site
// (kennyandmorgan.com/seating-chart/), so it reuses the same
// site.config.json the main site generates at deploy time instead of
// baking Supabase settings into the build. site.config.json only carries
// the public anon key, which is safe to ship client-side by design (every
// table it can touch enforces RLS or is walled off entirely, same as the
// main site).

export interface RuntimeConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

// Tried in order: "../site.config.json" is correct once this app is
// deployed under /seating-chart/ on the main site; "/site.config.json" is
// a fallback for standalone local development against a copy of it.
const CANDIDATE_PATHS = ["../site.config.json", "/site.config.json"];

let configPromise: Promise<RuntimeConfig> | null = null;

async function fetchConfig(path: string): Promise<RuntimeConfig | null> {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const supabaseUrl = data?.supabase?.url;
    const supabaseAnonKey = data?.supabase?.anonKey;
    if (!supabaseUrl || !supabaseAnonKey) {
      return null;
    }
    return { supabaseUrl, supabaseAnonKey };
  } catch {
    return null;
  }
}

export function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (!configPromise) {
    configPromise = (async () => {
      for (const path of CANDIDATE_PATHS) {
        const config = await fetchConfig(path);
        if (config) {
          return config;
        }
      }
      throw new Error(
        "Unable to load site.config.json — Supabase is not configured for the seating chart.",
      );
    })();
  }
  return configPromise;
}
