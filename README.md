# Fit Check

A personal AI stylist: color-season profile, photo closet, inspiration board, outfit builder and gap-based shopping list.
Static front end (`index.html`), two Vercel functions (`api/`), Supabase for sign-in and data. No build step.

## Setup (about 15 minutes)

1. **Supabase** – create a project. In the SQL editor run `supabase/schema.sql`, then:
   ```sql
   insert into public.owners (email) values ('the-email-you-will-sign-in-with');
   ```
   Under Authentication → Sign In / Providers → Email, either turn off "Confirm email" (simplest for a
   small friends test) or keep it on and configure custom SMTP; the built-in mailer only sends a few emails per hour.
2. **Anthropic** – create an API key at console.anthropic.com and set a monthly spend limit there.
3. **Vercel** – import this repo (framework preset: Other, no build command) and add environment variables:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | Project URL |
   | `SUPABASE_ANON_KEY` | anon / publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service role / secret key (server only, never in the browser) |
   | `ANTHROPIC_API_KEY` | your key |
   | `AI_DAILY_CAP` | optional, AI calls per user per UTC day (default 40) |
   | `ALLOWED_EMAILS` | optional, comma-separated; when set, only these accounts can use AI |
   | `MODEL_QUICK` / `MODEL_DEFAULT` | optional model overrides |

4. In Supabase → Authentication → URL Configuration, set Site URL to your Vercel URL.
5. Open the site, create your account with the owner email, and the Feedback tab appears for you.

## How it fits together

- `docs` table: one row per document (`profile`, `insights`, `closet/<item_id>`, `inspo/<id>`, `outfits/<id>`),
  keyed by `(user_id, path)`. Row-level security limits every query to the signed-in user's rows.
  Photos are downscaled in the browser (600 px, JPEG 0.7, ~100 KB) and stored as data URLs inside the row.
- `feedback` table: any signed-in user inserts; only emails in `owners` can read.
- `api/claude.js`: validates the caller's Supabase token, enforces the allowlist and daily cap
  (`ai_usage` + `bump_ai_usage`), then calls the Anthropic Messages API. Prompts are built in the browser.
- `api/config.js`: hands the browser the public Supabase URL and anon key from env.

## Known limits

- Prompts come from the client, so a signed-in user could send their own prompt through your key. The daily cap,
  size caps and `ALLOWED_EMAILS` bound the cost; set `ALLOWED_EMAILS` before sharing the link widely.
- Anyone with the URL can create an account and store data. For a wider launch add a per-user row limit.
- As database admin you can read every row from the Supabase dashboard. Tell your friends.
- CSV import/export columns: `item_id,name,category,subcategory,primary_color,secondary_color,palette_fit,material,formality,season,brand,size,notes`.
