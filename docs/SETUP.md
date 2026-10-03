# One-time setup

All services below are free. Do the steps in order.

## 1. Supabase (database + login)
1. Create a project at https://supabase.com (region: closest to Paris, e.g. `eu-west`). Save the database password.
2. **Project Settings → Database → Connection string**:
   - *Transaction pooler* (port 6543) → `DATABASE_URL` for Vercel. Change the scheme to `postgresql+psycopg://`.
   - *Session pooler* (port 5432) → use for migrations from your laptop.
3. **Project Settings → API**: copy the Project URL (`SUPABASE_URL` / `VITE_SUPABASE_URL`) and the publishable (or anon) key (`VITE_SUPABASE_KEY`).
4. Make sure **JWT signing keys** are asymmetric (default for new projects): Project Settings → JWT Keys shows an ECC/RSA current key.

## 2. Google login
1. https://console.cloud.google.com → new project → **APIs & Services → OAuth consent screen**: External, add your Gmail as a test user.
2. **Credentials → Create OAuth client ID → Web application**. Authorized redirect URI: `https://<ref>.supabase.co/auth/v1/callback`.
3. Supabase → **Authentication → Providers → Google**: enable, paste client ID + secret.
4. Supabase → **Authentication → Providers**: enable ONLY Google. Disable the **Email** provider and turn off email signups (and leave every other provider disabled). The backend trusts the `email` claim against the `ALLOWED_EMAILS` allowlist, so no other sign-in method may be enabled.
5. Supabase → **Authentication → URL Configuration**: Site URL = `https://<project>.vercel.app`; add `http://localhost:5173` to redirect URLs.

## 3. Database schema
```bash
cd backend
DATABASE_URL="postgresql+psycopg://<session-pooler-url>" uv run alembic upgrade head
DATABASE_URL="postgresql+psycopg://<session-pooler-url>" uv run python -m app.seed
```
Then in Supabase **Table Editor** confirm every table shows "RLS enabled".

## 4. Secrets
```bash
cd backend
uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"   # TOKEN_ENCRYPTION_KEY
uv run python -c "import secrets; print(secrets.token_urlsafe(32))"                                 # CRON_SECRET
```

## 5. Vercel
1. https://vercel.com → Add New Project → import `hnaul491/timetable-app` (Hobby plan). Framework preset: Other.
2. Environment variables (Production + Preview):
   `DATABASE_URL`, `SUPABASE_URL`, `ALLOWED_EMAILS` (your Google email), `CRON_SECRET`, `TOKEN_ENCRYPTION_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY`.
3. Deploy. If the deploy rejects `maxDuration: 60`, lower it to the value the error message allows and note it in the spec's open items.

## 6. GitHub Actions secrets
Repo → Settings → Secrets and variables → Actions: `APP_URL` = `https://<project>.vercel.app`, `CRON_SECRET` = same value as Vercel.

## 7. First run
1. Open the app, sign in with Google.
2. Settings → paste the Zeus ICS link → Save → **Sync now**.
3. Settings → My groups → choose your G / GR groups.
4. GitHub → Actions → "Daily Zeus sync" → Run workflow → it must finish green.

## Local development
```bash
cd backend && cp .env.example .env    # fill SUPABASE_URL, ALLOWED_EMAILS, TOKEN_ENCRYPTION_KEY
uv run alembic upgrade head && uv run python -m app.seed
uv run uvicorn app.main:app --reload --port 8000
cd ../frontend && cp .env.example .env  # fill VITE_ values
npm run dev                              # http://localhost:5173
```
