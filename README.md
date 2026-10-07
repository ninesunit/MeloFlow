# MeloFlow

A single-user web app for running a shared house: split rent and utility bills with housemates, track who has paid, carry over under- and over-payments automatically, watch electricity and water usage, and keep your own budget separate from house money.

Built for one main tenant (Alia) sharing with two housemates (Nana and Alisa). Names, phone numbers and the number of housemates are all editable in **Settings**.

## Features

| Area | What it does |
| --- | --- |
| **Dashboard** | Who owes what right now, bills due in the next two weeks, this month's cash flow, spike warnings, and a FullCalendar month view coloured by status (red pending, amber partly paid, green settled). Upcoming recurring bills show as outlines. |
| **Bill upload + AI reading** | Upload a photo or PDF of a TNB, Air Selangor, Unifi or any bill. Gemini reads the vendor, total, due date, billing period and kWh / m³ and fills the form for you to check. |
| **Smart split** | Split equally, by percentage, or with fixed amounts for housemates (the main tenant covers the rest). Splits are exact to the sen. |
| **Running balances** | If a housemate pays too little and the rest is carried forward, or pays too much, the difference is stored and added to / taken off their next bill automatically. Every change is logged. |
| **Settle up** | Per housemate: open bills, *Paid in full*, *Part payment*, *Carry rest to next bill*, manual balance adjustments, and history. |
| **WhatsApp** | One tap opens WhatsApp with a ready message: breakdown, carried-over amount, amount to pay, due date, receipt link, bank details and DuitNow QR link. Optional Gemini rewrite (friendly / formal / short; English, BM or rojak) keeps every number intact. |
| **Recurring bills** | Mark rent or Wi-Fi as monthly/yearly. A scheduled Cloud Function creates each month's copy (with running balances applied) just after midnight Malaysia time. |
| **Utilities** | Monthly cost chart, comparison against the trailing 3-month average with a >20% spike flag, AI explanation of the spike, statistical forecast for the next bill plus an AI forecast, and monthly caps. |
| **Bill estimator** | Add appliances (wattage or air-con horsepower, hours a day, duty cycle) and water uses (litres × times a week) to estimate the TNB and Air Selangor bills, using the tariffs below. |
| **Personal budget** | Personal income and expenses by month, your share of house bills, and budget caps overall and per category. |
| **Import & export** | Import bank statements (.xlsx / .csv) with column mapping, keyword + AI categorisation and duplicate skipping. Export one workbook with sheets *Personal Finances*, *House Bills*, *Receivables Ledger* and *Running Balances*. |

## Tech stack

- **Next.js 16** (App Router, static export) + React 19 + **Tailwind CSS 4**
- **Firebase**: Auth (one admin account), Firestore, Storage, Hosting, Cloud Functions (Node 22, `asia-southeast1`)
- **Gemini API** (`@google/genai`, default model `gemini-3.8-flash`) — only ever called from Cloud Functions, so the key never reaches the browser
- **FullCalendar 7**, **SheetJS** (`xlsx`)
- **Vitest** for the money logic

## Project layout

```
src/
  app/                    pages: dashboard, bills, settle, personal, utilities, estimator, data, settings, login
  components/             UI kit, app shell, entry form, bill detail, WhatsApp dialog, calendar, chart
  lib/
    shared/               pure TypeScript shared with Cloud Functions:
                          split engine, running balances, tariffs, estimator, utilities analysis,
                          recurring schedule, WhatsApp messages, statement parsing (+ tests)
    db.ts                 Firestore/Storage access; every money movement runs in a Firestore transaction
    ai.ts                 calls to the Gemini Cloud Functions
    excel.ts              SheetJS import/export
functions/src/            Cloud Functions: parseBill, composeMessage, analyzeUtilities,
                          forecastUtilities, categorizeTransactions, generateRecurringBills, runRecurringNow
firestore.rules, storage.rules   admin-only access
scripts/set-admin.mjs     writes your admin email into the rules and functions/.env
```

`functions/scripts/sync-shared.mjs` copies `src/lib/shared` into the functions build, so both sides use the same split and balance code.

## Data model (Firestore)

| Collection | Key fields |
| --- | --- |
| `transactions` | `date`, `category` (House Bill / Personal Expense / Income), `subCategory`, `vendor`, `totalAmount`, `consumptionUnits`, `receiptUrl`, `dueDate`, `isRecurring`, `frequency`, `recurrenceDay`, `status`, `split` (mode, participants, ratios / fixed amounts), `shares`, `receivableIds`, `recurringSourceId`, `importHash` |
| `receivables` | `transactionId`, `debtorName`, `baseShare`, `carryIn`, `amountOwed`, `amountPaid`, `status` (Pending / Partial / Settled), `carriedForward`, `creditFromOverpayment`, `payments[]`, `updatedAt` |
| `balances` | doc id = housemate name: `runningBalance` (positive = owes, negative = credit) |
| `balanceEvents` | append-only log of every running-balance change |
| `userSettings/main` | `adminUid`, `adminName`, `housemates[]` (name, WhatsApp), `duitNowQrUrl`, `bankAccountDetails`, `monthlyUtilityCaps`, `personalBudgetCaps`, `monthlyPersonalBudget`, `tariffs` |
| `appliances` | `name`, `type`, `quantity`, `powerRatingWatts`, `horsepower`, `estimatedDailyHours`, `dutyCyclePercent`, `waterVolumeCubicMeters`, `usesPerWeek` |

### How running balances work

1. A shared bill is split into shares. For each housemate, their running balance is applied: debt is added in full; credit is used up to the size of the share (any extra credit waits for the next bill).
2. **Part payment** keeps the bill open (Partial). **Paid in full** settles it. Paying more than owed settles it and stores the extra as credit.
3. **Carry rest to next bill** closes a partly paid bill and moves the unpaid remainder to the running balance.
4. Deleting a bill reverses everything it did to the balance. A bill's amount or split can't be changed once someone has paid towards it (edit other details, or delete and re-enter).

## Setup — what you need to do

You'll need a Google account and Node.js 22+.

### 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> → **Add project**.
2. Upgrade to the **Blaze (pay-as-you-go)** plan. Cloud Functions and the daily schedule require it; a household app like this normally stays inside the free allowance. Set a budget alert to be safe.
3. **Authentication** → Get started → enable **Email/Password**. Then **Users → Add user** with your email and a strong password. This is the only account the app accepts.
4. Authentication → **Settings → User actions** → untick **Enable create (sign-up)** so nobody else can register.
5. **Firestore Database** → Create database → Production mode → location `asia-southeast1 (Singapore)`.
6. **Storage** → Get started → same location.
7. **Project settings → Your apps** → add a **Web app**. Copy its config values.

### 2. Configure this repo

```bash
git clone https://github.com/ninesunit/MeloFlow.git
cd MeloFlow
npm install
npm --prefix functions install

cp .env.example .env.local          # paste the web app config values
npm run set-admin -- you@example.com # your admin email → rules + functions/.env
npx firebase login
npx firebase use --add              # pick your project (updates .firebaserc)
```

### 3. Add the Gemini API key

Create a key at <https://aistudio.google.com/apikey>, then store it as a Cloud Functions secret (it is never put in the code or the browser):

```bash
npx firebase functions:secrets:set GEMINI_API_KEY
```

To use a different model, change `GEMINI_MODEL` in `functions/.env`.

### 4. Deploy

```bash
npx firebase deploy
```

This builds the site, deploys hosting, the Cloud Functions (including the daily recurring-bill schedule), and the Firestore/Storage rules. Your app is then at `https://<project-id>.web.app`.

Later updates: `npm run deploy:hosting`, `npm run deploy:functions` or `npm run deploy:rules`.

### Local development

```bash
npm run dev      # http://localhost:3000, uses your real Firebase project
npm test         # unit tests for splitting, balances, tariffs, forecasts, import parsing
npm run lint
npm run typecheck
```

AI features call the deployed functions, so deploy them once before trying OCR or messages locally.

## Tariffs used by the estimator

- **TNB domestic (Peninsular), from 1 July 2025**: energy 27.03 sen/kWh up to 1,500 kWh and 37.03 sen above; capacity 4.55 sen/kWh; network 12.85 sen/kWh; retail RM10/month (waived at 600 kWh and below); Energy Efficiency Incentive rebate for usage up to 1,000 kWh; KWTBB 1.6% above 300 kWh; service tax 8% on usage above 600 kWh. The monthly fuel adjustment (AFA) is set in Settings.
- **Air Selangor domestic, from 1 September 2025**: RM0.65/m³ for 0–20 m³, RM1.62/m³ for 20–35 m³, RM3.51/m³ above 35 m³, minimum charge RM6.50.

Rates live in `src/lib/shared/tariffs.ts` — update them there if they change. The estimator is a guide, not a bill.

## Security notes

- Firestore and Storage rules only allow the admin email. Run `npm run set-admin` whenever you change it, then `npm run deploy:rules`.
- Receipt and DuitNow QR links in WhatsApp messages are Firebase download links containing an access token: anyone with the link can open that one file. Don't upload anything you wouldn't send to your housemates.
- SheetJS is installed from npm at 0.18.5, the last version published there. Newer versions (with fixes for crafted-file parsing issues) are distributed from `https://cdn.sheetjs.com`; to switch, run `npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. Only import statements from your own bank.
