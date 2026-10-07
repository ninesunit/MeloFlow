# MeloFlow

A single-user web app for running a shared house: split rent and utility bills with housemates, track who has paid, carry over under- and over-payments automatically, watch electricity and water usage, and keep your own budget separate from house money.

Built for one main tenant (Alia) sharing with two housemates (Nana and Alisa). Names, phone numbers and the number of housemates are all editable in **Settings**. Housemates never sign in; one or more **admin accounts** (e.g. Alia's, plus a maintainer's for troubleshooting) share the same data.

**Runs entirely on free tiers:** Firebase **Spark** plan (Auth + Firestore only — no Cloud Functions, no Cloud Storage) and **Vercel Hobby** for the Next.js app and its one API route.

## Features

| Area | What it does |
| --- | --- |
| **Dashboard** | Who owes what right now, bills due in the next two weeks, this month's cash flow, spike warnings, and a FullCalendar month view coloured by status (red pending, amber partly paid, green settled). Upcoming recurring bills show as outlines. |
| **Bill upload + AI reading** | Upload a photo or PDF of a TNB, Air Selangor, Unifi or any bill. Gemini reads the vendor, total, due date, billing period and kWh / m³ and fills the form for you to check. |
| **Smart split** | Split equally, by percentage, or with fixed amounts for housemates (the main tenant covers the rest). Splits are exact to the sen. |
| **Running balances** | If a housemate pays too little and the rest is carried forward, or pays too much, the difference is stored and added to / taken off their next bill automatically. Every change is logged. |
| **Settle up** | Per housemate: open bills, *Paid in full*, *Part payment*, *Carry rest to next bill*, manual balance adjustments, and history. |
| **WhatsApp** | One tap opens WhatsApp with a ready message: breakdown, carried-over amount, amount to pay, due date, receipt link, bank details and DuitNow QR link. Optional Gemini rewrite (friendly / formal / short; English, BM or rojak) keeps every number intact. |
| **Recurring bills** | Mark rent or Wi-Fi as monthly/yearly. When you open the dashboard, any copies that are due — this month's, plus months you missed — are created with running balances applied. |
| **Utilities** | Monthly cost chart, comparison against the trailing 3-month average with a >20% spike flag, AI explanation of the spike, statistical forecast for the next bill plus an AI forecast, and monthly caps. |
| **Bill estimator** | Add appliances (wattage or air-con horsepower, hours a day, duty cycle) and water uses (litres × times a week) to estimate the TNB and Air Selangor bills, using the tariffs below. |
| **Personal budget** | Personal income and expenses by month, your share of house bills, and budget caps overall and per category. |
| **Import & export** | Import bank statements (.xlsx / .csv) with column mapping, keyword + AI categorisation and duplicate skipping. Export one workbook with sheets *Personal Finances*, *House Bills*, *Receivables Ledger* and *Running Balances*. |

## How it fits the free plans

| Need | Blaze-only Firebase feature | What MeloFlow uses instead |
| --- | --- | --- |
| Server code for Gemini | Cloud Functions | One Next.js API route, `src/app/api/gemini/route.ts`, on Vercel. `GEMINI_API_KEY` is a server-only environment variable and never reaches the browser. The route checks the caller's Firebase ID token with Google's public keys, then asks Firestore — using that same token — whether the security rules let the account in. So the Firestore rules are the one admin list; no service account needed. |
| Monthly recurring bills | Scheduled Cloud Function | Generated in the browser when the dashboard opens (`src/lib/recurring.ts`). Each copy has a fixed id (`<templateId>_<YYYY-MM>`) and is written in a Firestore transaction that first checks the id is free, so two tabs can't create it twice. Missed months (up to 12) are filled in too. |
| Receipts and DuitNow QR | Cloud Storage (requires Blaze since February 2026) | Photos are compressed in the browser (≤ 600 KB) and stored as base64 in the Firestore `files` collection. PDFs are kept if they're under 600 KB; larger PDFs are still read by the AI but not attached. Share links look like `https://your-app/f/<id>/`. |
| Hosting a Next.js app with an API route | Firebase App Hosting / frameworks hosting | Vercel Hobby (free). |

Spark limits to keep in mind: 1 GiB Firestore storage and 50,000 reads / 20,000 writes a day — far more than one household uses. Vercel Hobby is for personal, non-commercial projects.

## Tech stack

- **Next.js 16** (App Router) + React 19 + **Tailwind CSS 4**, deployed on **Vercel**
- **Firebase Spark**: Auth (admin accounts only) and Firestore
- **Gemini API** (`@google/genai`, default model `gemini-3.8-flash`) — called only from the API route
- **FullCalendar 7**, **SheetJS** (`xlsx`), **jose** (ID-token checks)
- **Vitest** for the money logic

## Project layout

```
src/
  app/
    api/gemini/route.ts   the only server code: bill reading, message rewrite, spike notes,
                          forecasts and statement categorising
    f/[id]/               public viewer for a shared receipt / QR link
    …                     pages: dashboard, bills, settle, personal, utilities, estimator, data, settings, login
  components/             UI kit, app shell, entry form, bill detail, WhatsApp dialog, calendar, chart, hooks
  lib/
    shared/               pure TypeScript: split engine, running balances, tariffs, estimator,
                          utilities analysis, recurring schedule, WhatsApp messages,
                          statement parsing (+ tests)
    server/               server-only: Gemini client, prompts, ID-token check
    db.ts                 Firestore access; every money movement runs in a Firestore transaction
    files.ts              image compression and the Firestore `files` store
    recurring.ts          client-side recurring bill generator
    ai.ts                 browser side of /api/gemini
    excel.ts              SheetJS import/export
firestore.rules.template  security rules; admin-only access (plus get-by-id for shared files)
scripts/set-admin.mjs     saves ADMIN_EMAILS in .env.local and generates firestore.rules
scripts/build-rules.mjs   generates firestore.rules (git-ignored) from the template + ADMIN_EMAILS
```

## Data model (Firestore)

| Collection | Key fields |
| --- | --- |
| `transactions` | `date`, `category` (House Bill / Personal Expense / Income), `subCategory`, `vendor`, `totalAmount`, `consumptionUnits`, `receiptFileId`, `dueDate`, `isRecurring`, `frequency`, `recurrenceDay`, `status`, `split` (mode, participants, ratios / fixed amounts), `shares`, `receivableIds`, `recurringSourceId`, `importHash` |
| `receivables` | `transactionId`, `debtorName`, `baseShare`, `carryIn`, `amountOwed`, `amountPaid`, `status` (Pending / Partial / Settled), `carriedForward`, `creditFromOverpayment`, `payments[]`, `updatedAt` |
| `balances` | doc id = housemate name: `runningBalance` (positive = owes, negative = credit) |
| `balanceEvents` | append-only log of every running-balance change |
| `userSettings/main` | `adminUid` (who set the app up), `adminName`, `housemates[]` (name, WhatsApp), `duitNowQrFileId`, `bankAccountDetails`, `monthlyUtilityCaps`, `personalBudgetCaps`, `monthlyPersonalBudget`, `tariffs` |
| `appliances` | `name`, `type`, `quantity`, `powerRatingWatts`, `horsepower`, `estimatedDailyHours`, `dutyCyclePercent`, `waterVolumeCubicMeters`, `usesPerWeek` |
| `files` | doc id = random 32-character key: `kind` (receipt / payment), `name`, `mimeType`, `size`, `data` (base64) |

### How running balances work

1. A shared bill is split into shares. For each housemate, their running balance is applied: debt is added in full; credit is used up to the size of the share (any extra credit waits for the next bill).
2. **Part payment** keeps the bill open (Partial). **Paid in full** settles it. Paying more than owed settles it and stores the extra as credit.
3. **Carry rest to next bill** closes a partly paid bill and moves the unpaid remainder to the running balance.
4. Deleting a bill reverses everything it did to the balance. A bill's amount or split can't be changed once someone has paid towards it (edit other details, or delete and re-enter).

## Setup — what you need to do

You'll need a Google account, a GitHub account, and Node.js 22+.

### 1. Firebase (Spark plan)

1. <https://console.firebase.google.com> → **Add project** (stay on the free Spark plan).
2. **Authentication** → Get started → enable **Email/Password**. Then **Users → Add user** once for each admin (e.g. Alia and you), each with a strong password. Only these accounts can use the app.
3. Authentication → **Settings → User actions** → untick **Enable create (sign-up)** so nobody else can register.
4. **Firestore Database** → Create database → Production mode → location `asia-southeast1 (Singapore)`.
5. **Project settings → Your apps** → add a **Web app** and copy its config values.
6. You don't need Storage, Functions or Hosting.

### 2. Configure and run locally

```bash
git clone https://github.com/ninesunit/MeloFlow.git
cd MeloFlow
npm install
cp .env.example .env.local           # paste the Firebase web config and your GEMINI_API_KEY
npm run set-admin -- alia@example.com you@example.com   # every admin, in one go
npx firebase login
npx firebase use --add               # pick your project
npm run deploy:rules                 # publish the Firestore security rules (free on Spark)
npm run dev                          # http://localhost:3000
```

Get the Gemini key at <https://aistudio.google.com/apikey>. Keep it in `.env.local` (git-ignored) — never in a `NEXT_PUBLIC_` variable.

### 3. Deploy to Vercel (free)

1. Sign in at <https://vercel.com> with GitHub → **Add New → Project** → import `MeloFlow`. The defaults for Next.js are correct.
2. Before deploying, open **Environment Variables** and add every variable from `.env.local`: the six `NEXT_PUBLIC_FIREBASE_…` values, `GEMINI_API_KEY` and `GEMINI_MODEL`. `ADMIN_EMAILS` is optional there (it only skips one Firestore check per sign-in).
3. Deploy. Every push to `main` redeploys automatically.
4. In Firebase → **Authentication → Settings → Authorized domains**, add your Vercel domain (e.g. `meloflow.vercel.app`) so sign-in works there.

### Day to day

```bash
npm run dev          # local app + API route
npm test             # unit tests for splitting, balances, tariffs, forecasts, recurring, import parsing
npm run lint
npm run typecheck
npm run check        # all of the above plus a production build
npm run deploy:rules # regenerates firestore.rules from the template + ADMIN_EMAILS, then publishes it
```

## Tariffs used by the estimator

- **TNB domestic (Peninsular), from 1 July 2025**: energy 27.03 sen/kWh up to 1,500 kWh and 37.03 sen above; capacity 4.55 sen/kWh; network 12.85 sen/kWh; retail RM10/month (waived at 600 kWh and below); Energy Efficiency Incentive rebate for usage up to 1,000 kWh; KWTBB 1.6% above 300 kWh; service tax 8% on usage above 600 kWh. The monthly fuel adjustment (AFA) is set in Settings.
- **Air Selangor domestic, from 1 September 2025**: RM0.65/m³ for 0–20 m³, RM1.62/m³ for 20–35 m³, RM3.51/m³ above 35 m³, minimum charge RM6.50.

Rates live in `src/lib/shared/tariffs.ts` — update them there if they change. The estimator is a guide, not a bill.

## Security notes

- The Firestore rules are the admin list for everything: the database, and `/api/gemini` (which asks Firestore whether the caller's account is allowed). To add or remove an admin: create/delete the user in Firebase Authentication, run `npm run set-admin -- <full list>`, then `npm run deploy:rules` (or paste the generated `firestore.rules` into the Firebase console). Nothing needs changing on Vercel.
- Admin emails live only in `.env.local` and Vercel, never in the repo: `firestore.rules` is generated from `firestore.rules.template` and git-ignored, because this repository is public.
- Receipt and DuitNow QR links in WhatsApp messages work for anyone who has the link (the random id is the key), the same way a cloud-storage share link does. Don't upload anything you wouldn't send to your housemates.
- Recurring bills are created when you open the dashboard, not at a fixed time — if nobody opens the app on the 1st, rent appears the next time it's opened (with the correct date).
- SheetJS is installed from npm at 0.18.5, the last version published there. Newer versions (with fixes for crafted-file parsing issues) are distributed from `https://cdn.sheetjs.com`; to switch, run `npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. Only import statements from your own bank.
