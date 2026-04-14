# Public repository security checklist

This repository can be public, but only if runtime configuration and passwords are handled outside the repo and the deployed Pages artifact is limited to the static site files.

## What changed in this repo

- `site.config.json` is no longer tracked in Git.
- GitHub Pages now deploys a curated `dist/` artifact instead of the entire repository.
- The deploy workflow generates `site.config.json` from GitHub repository variables and secrets.

## Secrets and sensitive values to migrate out of the repository

Move these values out of committed files before making the repository public:

| Value | Where it may appear today | Action |
| --- | --- | --- |
| Real access passwords for `family`, `party`, and `admin` | `supabase/seed.example.sql` if you replaced placeholders locally | Never commit real passwords or hashes derived from them; keep them only in your private Supabase setup workflow |
| Local fallback passwords | `site.config.json` under `localFallbackAccess.*` | Keep them local only; never commit them and never deploy them to GitHub Pages |
| Any Supabase service role key, database password, personal access token, or SMTP/API credential | Any ad hoc local notes/scripts | Do not put them in this repo; use GitHub Secrets or your hosting provider’s secret storage only |

## GitHub repository variables and secrets

Configure these before deploying from a public repo:

### Repository variables

Set these in **Settings → Secrets and variables → Actions → Variables**:

| Name | Example | Notes |
| --- | --- | --- |
| `SITE_REGISTRY_PAGE_URL` | `https://www.myregistry.com/giftlist/morganandkenny` | Public URL |
| `SITE_SUPABASE_URL` | `https://YOUR_PROJECT.supabase.co` | Public Supabase project URL |
| `SITE_SUPABASE_SESSION_TTL_MS` | `3600000` | Session lifetime in milliseconds |

### Repository secrets

Set these in **Settings → Secrets and variables → Actions → Secrets**:

| Name | Notes |
| --- | --- |
| `SITE_SUPABASE_ANON_KEY` | Publishable/browser key used to generate `site.config.json` during deploy |

> `SITE_SUPABASE_ANON_KEY` is not a true server secret once deployed because it is sent to the browser in `site.config.json`. Treat it as a publishable key and rely on Supabase RLS, RPC authorization, and password/session controls for real protection.

## Step-by-step public repo hardening

1. **Rotate anything that may already be exposed**
   - Change all wedding site access passwords in Supabase.
   - Replace any locally used fallback passwords.
   - Rotate any service-role, database, SMTP, or API credentials if they were ever stored in the repo or shared insecurely.
2. **Keep `site.config.json` local only**
   - Copy `site.config.example.json` to `site.config.json` for local work.
   - Do not commit `site.config.json`.
3. **Add GitHub Actions variables and secrets**
   - Add the three variables and one secret listed above.
4. **Verify Supabase is safe for browser traffic**
   - Keep Row Level Security enabled on every table.
   - Keep privileged operations behind RPCs that validate access/session tokens.
   - Never use a service-role key in browser code or in `site.config.json`.
5. **Limit what GitHub Pages publishes**
   - The workflow now copies only site assets into `dist/`.
   - Tests, SQL files, and project metadata are no longer deployed as website files.
6. **Enable GitHub repository protections**
   - Turn on secret scanning and push protection if available for the account.
   - Turn on Dependabot security alerts and security update PRs.
   - Protect `main` with pull-request review before merge.
   - Restrict who can edit Actions secrets and Pages settings.
7. **Do a dry run**
   - Run the Pages workflow manually from **Actions**.
   - Open the deployed `site.config.json` and confirm it contains only public runtime values and blank `localFallbackAccess` fields.

## Local development workflow

1. Copy the example file:

   ```bash
   cp site.config.example.json site.config.json
   ```

2. Fill in local values as needed.
3. If you want localhost-only fallback passwords for preview/testing, set them in your local `site.config.json` only.
4. Run the site locally and test as usual.

## How to apply the GitHub settings

1. Open the repository on GitHub.
2. Go to **Settings**.
3. Open **Secrets and variables → Actions**.
4. Create the repository variables:
   - `SITE_REGISTRY_PAGE_URL`
   - `SITE_SUPABASE_URL`
   - `SITE_SUPABASE_SESSION_TTL_MS`
5. Create the repository secret:
   - `SITE_SUPABASE_ANON_KEY`
6. Go to **Settings → Pages** and keep **GitHub Actions** as the source.
7. Run the **Deploy GitHub Pages** workflow.
8. After deployment, confirm the site works and that no local fallback passwords are present in the deployed config.
