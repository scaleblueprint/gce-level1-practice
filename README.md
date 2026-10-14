# Google Certified Educator Level 1 Practice App

A proper full-stack practice app with persistent user sessions and server-stored attempts.

## What changed from the single HTML prototype

- Account registration and login
- Signed login session cookie
- Persistent attempts in a database
- Every MCQ answer is saved immediately
- Lab state is saved server-side
- 3-hour timer is based on the server start time, so refreshing or closing the browser does not reset it
- Resume the same active attempt after signing back in
- Resume from another device using the same account
- Attempt history and post-exam review are stored in the database
- Single-user mode by default: after the first account is created, further registration is blocked
- 80 original exam-style questions, 3 mock sets, and 6 simulated labs
- Full mock uses 37 questions + 3 labs

This app does NOT reproduce confidential live Google certification questions.

## Local run

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

export SESSION_SECRET="replace-with-a-long-random-secret"
uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000

By default it uses SQLite (`gce_practice.db`) for local development.

## Persistent hosting (recommended)

For Render or another cloud host, use a persistent PostgreSQL database (Neon works well).

Set:

- `DATABASE_URL` = PostgreSQL connection string
- `SESSION_SECRET` = long random secret
- `SINGLE_USER=true`
- `HTTPS_ONLY=true`

Start command:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Important: Do not rely on SQLite on an ephemeral hosting filesystem if you want attempts to survive deploys/restarts. Use PostgreSQL.

## Render

A `render.yaml` is included. Add `DATABASE_URL` in the Render dashboard using your PostgreSQL/Neon URL, and set a strong `SESSION_SECRET`.

## Notes about scoring

The "practice composite" is intentionally a local readiness metric:
70% question score + 30% lab score.

It is NOT claimed to be Google's official passing formula.
