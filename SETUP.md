# Setting up on a new laptop

Step-by-step setup of **3D Surgical Print Lab — CMS** (the Manufacturing
Management app) on a fresh machine, from this repository. Windows is assumed;
macOS and Linux work the same, with the shell differences noted.

Nothing else is needed: no Docker and no PostgreSQL install. The database runs
from the project itself (`npm run db:start`).

---

## 1. Install the tools

| Tool | Version | Get it from |
|---|---|---|
| Node.js | 22 or newer (24 LTS recommended) | <https://nodejs.org> |
| Git | any recent | <https://git-scm.com> |
| VS Code | optional | <https://code.visualstudio.com> |

Check them in a new terminal:

```bash
node --version    # v22.x or newer
npm --version
git --version
```

## 2. Get the code

```bash
git clone <repository-url> "3dsurgical-print-lab-CMS"
cd "3dsurgical-print-lab-CMS"
```

## 3. Install dependencies

```bash
npm install
npx prisma generate
```

`npx prisma generate` builds the database client from `prisma/schema.prisma`.
`npm install` does not do it on its own, and the app will not start without it.
Run it again whenever `prisma/schema.prisma` changes after a `git pull`.

## 4. Create `.env`

`.env` is never committed — it holds secrets. Make it from the template:

```bash
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
```

Then open `.env` and fill in:

| Setting | What to put |
|---|---|
| `ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CRON_SECRET` | `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` |
| `SUPER_ADMIN_EMAIL` | Your email — the first admin console login |
| `SUPER_ADMIN_PASSWORD` | A password of your choice |

Leave `DATABASE_URL`, `BASE_DOMAIN` and `STORAGE_DIR` as they are.

> **Moving data from another laptop?** Copy that laptop's `.env` instead of
> generating new secrets — see [section 8](#8-bringing-data-from-another-laptop).
> A different `ENCRYPTION_KEY` cannot read the stored platform credentials or
> patient identifiers.

## 5. Start the database

In its **own terminal**, and leave it running (Ctrl+C stops it):

```bash
npm run db:start
```

The first run creates `.pgdata/` in the project folder; later runs reuse it.
It listens on `localhost:5433` only.

## 6. Create the tables and the first admin (first time only)

In a **second terminal**:

```bash
npm run db:deploy     # applies every migration in prisma/migrations
npm run db:seed       # creates the super admin from .env
```

Optional — sample data so every screen has something in it:

```bash
npm run seed:dev          # the "Demo Medical" space (demo)
npm run seed:demo-user    # a second demo user, for QA approval
```

## 7. Run the app

```bash
npm run dev
```

| Open | Sign in as |
|---|---|
| <http://admin.localhost:3100> | `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` from `.env` |
| <http://demo.localhost:3100> | `demo@3dsurgical.example`, same password as the super admin (after `seed:dev`) |

Every `*.localhost` address resolves to your own machine — no hosts-file
changes. Use Chrome, Edge or Firefox.

**Day to day** it is just two terminals: `npm run db:start` and `npm run dev`.

---

## 8. Bringing data from another laptop

The repository holds code only. Data lives in three places that are
deliberately **not** in git, and moves by copying them (USB drive, OneDrive,
etc. — they contain patient data, so keep the copy private):

| Copy | What it is |
|---|---|
| `.env` | Secrets. **Must** come with the data — the `ENCRYPTION_KEY` has to match. |
| `.pgdata/` | The database. Stop `npm run db:start` on the old laptop first. |
| `.storage/` | Uploaded documents, reports and photos. |

Put all three in the project folder on the new laptop, then run steps 3, 5 and
7 (skip 4 and 6). If you only want the database, `backups/` holds any SQL dumps
taken earlier.

## 9. Updating after a `git pull`

```bash
git pull
npm install               # if package.json changed
npx prisma generate       # if prisma/schema.prisma changed
npm run db:deploy         # if new folders appeared in prisma/migrations
```

Then restart `npm run dev`.

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot find module '.prisma/client'` / `PrismaClient did not initialize` | Run `npx prisma generate`. |
| `DATABASE_URL is missing or not a URL` | `.env` is missing — do step 4. |
| `Can't reach database server at localhost:5433` | `npm run db:start` is not running in another terminal. |
| Port 5433 or 3100 already in use | Another copy is running — close it, or find it with `netstat -ano \| findstr :5433` and end that process in Task Manager. |
| `db:start` fails after an unclean shutdown | Delete `.pgdata/postmaster.pid` and start again. |
| Signed in on the old laptop's data but cases show errors decrypting | `.env` is not the old laptop's — copy its `ENCRYPTION_KEY` (section 8). |
| Page looks unstyled | Stop `npm run dev`, delete the `.next/` folder, start it again. |
| Want a clean slate | Stop the database, delete `.pgdata/`, then redo steps 5 and 6. |

## Useful commands

| Command | Does |
|---|---|
| `npm run dev` | The app on port 3100 |
| `npm run db:start` | The development database on port 5433 |
| `npm run db:studio` | Browse the database in the browser |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run build` | Production build |

For how the application works — sign-in, company spaces, the platform sync,
parts, quality forms — see [README.md](README.md).
