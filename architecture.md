# Software & System Architecture — Sprout & Bloom (BaeLove Portal)

> **Document Scope**: Full technical architecture of **Sprout & Bloom — Fetal & Baby Growth Tracker** (`BaeLove Portal`), derived directly from all 53 source, schema, server, and configuration files in the repository.

---

## 1. System Overview & High-Level Topology

The application is a **full-stack TypeScript single-page application (SPA)** built with React 19, Vite 8, Tailwind CSS v4, and an Express 4 runtime server (`server.ts`). Caregiver data persists directly to **Supabase PostgreSQL** with real-time `postgres_changes` synchronization across devices, while **Google Gemini AI** capabilities are isolated behind a server-side Express/Vercel-compatible proxy (`/api/gemini`).

```text
+-------------------------------------------------------------------------+
|                       Browser Client (React 19 SPA)                     |
|                                                                         |
|  PasswordGate (Cookie Auth) --> AppContext (Central State + Sync)       |
|       |                                                                 |
|       +--> Views: Overview | Growth | Routine | Stages/Milestones | Log |
|       +--> SVG Charts: WHO LMS | Hadlock Fetal | Routine Bars & BoxPlot |
|       +--> Engines: ageCalculator | growthStandards | fetalStandards    |
|       |             careInterpreter | chartZoom | geminiContextBuilder  |
|       +--> Modals: AskGemini | MassImport | OptimizeHistory | Reports   |
+-------------------+---------------------------------+-------------------+
                    | HTTPS (REST + Realtime WS)      | HTTPS (/api/*)
                    v                                 v
+-----------------------------------+   +---------------------------------+
|      Supabase (PostgreSQL)        |   |   Express Server (server.ts)    |
|  - public.entries (JSON envelope) |   |   - Port 3000 (15mb JSON limit) |
|  - public.growth  (daily vitals)  |   |   - Dev: Vite 8 middlewareMode  |
|  - public.routine (feed/diaper)   |   |   - Prod: static dist/ SPA      |
|  - public.notes   (ad hoc notes)  |   |   - /api/health -> api/health   |
|  - Realtime: supabase_realtime    |   |   - /api/gemini -> api/gemini   |
+-----------------------------------+   +----------------+----------------+
                                                         | @google/genai
                                                         v
                                        +---------------------------------+
                                        |        Google Gemini API        |
                                        | Primary: gemini-4-hydrogen      |
                                        | Fallback: gemini-3.1-flash-lite |
                                        +---------------------------------+
```

---

## 2. Technology Stack & Runtime Server

### 2.1 Core Dependencies (`package.json`)
| Layer | Technology / Version | Purpose |
| :--- | :--- | :--- |
| **UI Framework** | `react@19.0.1`, `react-dom@19.0.1` | Component architecture and hooks |
| **Language** | `typescript@7.0.2` | End-to-end static typing |
| **Bundler / Dev** | `vite@8.3.0`, `@vitejs/plugin-react` | Fast ESM dev server & production bundling |
| **Styling** | `tailwindcss@4`, `@tailwindcss/vite@4.3.3` | Utility-first CSS with class-based dark mode |
| **Backend Server** | `express@4`, `tsx` | Unified dev/prod HTTP server & `/api/*` routing |
| **Database & Sync** | `@supabase/supabase-js@2.119.2` | Postgres CRUD & WebSocket Realtime subscriptions |
| **AI SDK** | `@google/genai@3.6.1` | Server-side multimodal & structured JSON Gemini calls |
| **UI Utilities** | `lucide-react`, `motion`, `canvas-confetti` | Icons, transitions, celebratory feedback |

### 2.2 Express & Vite Server Architecture (`server.ts`, `vite.config.ts`)
- **Unified Entry Point**: Runs via `npm run dev` (`tsx server.ts`) in development and `npm start` (`node server.ts`) in production.
- **Port & Proxy Safety**:
  - Defaults to `PORT=3000` (accepts CLI `--port` / `--host` overrides).
  - Explicitly guards against `NGINX_PORT=8080` collisions so the Node app always binds cleanly to port `3000`.
  - Configures `express.json({ limit: '15mb' })` to support multimodal base64 image/PDF payloads sent to `/api/gemini`.
- **Non-Blocking Dev Boot**:
  - Calls `server.listen()` immediately before Vite finishes initializing so health checks respond without delay.
  - Non-API requests wait cleanly on a `viteReady` promise until `vite.middlewares` (`middlewareMode: true`) is mounted.
  - Respects `DISABLE_HMR=true` by disabling Vite HMR, WebSockets (`ws: false`), and file watching (`watch: null`).
- **Vercel-Compatible API Handlers**:
  - `/api/health` and `/api/gemini` lazily import `./api/health.ts` and `./api/gemini.ts`, adhering to portable `ApiRequest` / `ApiResponse` contracts so the same handlers work under Express or serverless deployment.
- **Production Serving**: Serves compiled assets from `dist/` with SPA fallback (`index.html`) for client routes.

---

## 3. Repository & Module Structure

```text
/
├── api/
│   ├── gemini.ts                 # Server-side Gemini proxy (primary + fallback, multimodal, schema)
│   └── health.ts                 # Live Gemini connectivity & latency check endpoint
├── supabase/
│   └── schema.sql                # Idempotent Postgres DDL, indexes, replica identity, RLS, Realtime
├── src/
│   ├── App.tsx                   # Root shell, PasswordGate wrapper, global Enter-blur, tab routing
│   ├── main.tsx                  # React root mount
│   ├── index.css                 # Tailwind v4 import + dark variant + color-scheme rules
│   ├── types/
│   │   └── index.ts              # All domain & Supabase table TypeScript interfaces
│   ├── context/
│   │   └── AppContext.tsx        # Central state store, Supabase sync, graduation, JSON backup
│   ├── lib/
│   │   ├── supabase.ts           # Singleton Supabase client with URL normalization
│   │   ├── entriesStorage.ts     # Polymorphic `entries` CRUD + 52-bit ID hash + 428C9 fallback
│   │   └── careTablesStorage.ts  # Typed CRUD & Realtime for `growth`, `routine`, `notes`
│   ├── hooks/
│   │   └── useViewportArea.ts    # Responsive viewport area/size hook
│   ├── utils/
│   │   ├── ageCalculator.ts      # Timezone-independent UTC calendar age arithmetic & formatting
│   │   ├── authConfig.ts         # Build-injected passkey verification (`baepass_Key`, `bae_Key*`)
│   │   ├── careInterpreter.ts    # Milk Day 6+ targets, hydration, weight interp, box plots, merging
│   │   ├── chartZoom.ts          # 200% auto-zoom range & nice 1-2-2.5-5 tick generation
│   │   ├── cookieUtils.ts        # 30-day `SameSite=Lax` cookie helpers
│   │   └── geminiContextBuilder.ts # Compact clinical system prompt serializer for AskGeminiModal
│   ├── data/
│   │   ├── fetalStandards.ts     # Hadlock weeks 12–40 curves, dynamic EFW equations, fruit guide
│   │   ├── formulaSources.ts     # Clinical citations & profile-scoped formula definitions
│   │   ├── growthStandards.ts    # WHO 2006 0–36m LMS tables, Box-Cox Z-score, normal CDF, units
│   │   ├── milestonesData.ts     # CDC/AAP 2–36m 4-domain milestones, tips, consult red flags
│   │   ├── recipeData.ts         # Curated infant and maternal-fetal recipes
│   │   └── stagesExpectationsData.ts # 52-week/0–36m baby & weeks 4–42 fetal stage guides
│   └── components/
│       ├── auth/                 # PasswordGate
│       ├── layout/               # Navbar, MobileTabBar
│       ├── common/               # DiaperLoadControl, FeedingMethodSelect, StoolSelect, RemarkTooltipCell
│       ├── charts/               # InteractiveGrowthChart, FetalBiometricsChart, RoutineTrendCharts,
│       │                         # GrowthVelocityCard, MilestoneRadarProgress
│       ├── views/                # GrowthDashboardView, GrowthTabView, RoutineView, FetalHubView,
│       │                         # MilestonesView, StagesAndMilestonesView, StagesAndWishesView, HistoryLogsView
│       └── modals/               # 15 modals (AskGemini, MassImport, OptimizeHistory, FormulaSource,
│                                 # LogMeasurement, EditCareRecord, ExportReport, Profile, GraduateFetal,
│                                 # AttachedPrenatalHistory, CardDetailPopup, EditAuth, DeleteProfile,
│                                 # AddMilestone, AddLoveNote)
├── server.ts                     # Express + Vite middleware + /api/* router
├── vite.config.ts                # Vite 8 config, Tailwind plugin, build-time auth defines
├── index.html                    # HTML entry point & OG/Twitter metadata
├── metadata.json                 # App identity & capability metadata
├── .env.example                  # Required environment variable template
└── package.json                  # Scripts & dependency manifest
```

---

## 4. Data Architecture & Supabase Persistence

### 4.1 Database Schema (`supabase/schema.sql`)
All 4 tables enable Row Level Security (RLS), `replica identity full` (so `DELETE` events include complete row payloads), and membership in the `supabase_realtime` publication.

| Table | Primary Key | Profile Linkage | Columns & Purpose |
| :--- | :--- | :--- | :--- |
| **`public.entries`** | `id` (`bigint`) | `profile_id` (`text`) | Polymorphic JSON envelope storing `"profile name"`, `name` (loggedBy), `remark`, `payload` (`{ __entry_key, __entry_type, data }`), `created_at`, `updated_at`. |
| **`public.growth`** | `id` (`bigint`) | `profile_id` (`bigint`) | Daily weight (`daily_weight` real), length (`daily_length` real), `temperature` (real), `date`, `time`, `remark`, `name` (loggedBy). |
| **`public.routine`** | `id` (`bigint`) | `profile_id` (`bigint`) | Feeding & diaper events: `"emb_mL"` (int), `"formula_mL"` (int), `feed_duration_min` (int), `feeding_method` (text), `diaper` (varchar), `"diaper load"` (smallint), `stool` (varchar), `date`, `time`, `name`, `remark`. |
| **`public.notes`** | `id` (`bigint`) | `profile_id` (`bigint`) | Ad hoc caregiver notes: `notes` (text), `remark` (text), `name` (loggedBy), `created_at`. |

### 4.2 Polymorphic `entries` Envelope (`src/lib/entriesStorage.ts`)
`public.entries` stores 7 typed entity kinds inside `payload`:
- `profile` (`ChildProfile`)
- `baby_measurement` (`BabyMeasurement` — pediatric checkups)
- `fetal_measurement` (`FetalMeasurement` — ultrasound scans)
- `completed_milestone` (`CompletedMilestone`)
- `kick_session` (`KickSession`)
- `love_note` (`LoveNote`)
- `setting` (`units`, `formula_settings`, `theme`, `active_profile`)

**Deterministic 52-bit Keying & Identity Resilience**:
- Each entry's canonical key `${entry_type}:${itemId}` is deterministically hashed into a safe JavaScript 52-bit positive integer (`id`) for idempotent upserts.
- If the remote Postgres table defines `id` as `GENERATED ALWAYS AS IDENTITY` (raising Postgres error `428C9` on explicit ID insert), `entriesStorage.ts` automatically retries using key-lookup update/insert without passing `id`.

### 4.3 Profile ID Bridging & Care Table Resilience (`src/lib/careTablesStorage.ts`)
- **String ↔ BigInt Bridging**: String `ChildProfile.id` values map deterministically to `bigint` `profile_id` columns in `growth`, `routine`, and `notes` via `getProfileNumericId(profile.id)`. Matching helpers (`doesRecordMatchProfile`, `doesNoteMatchProfile`) support exact string matches, hashed numeric IDs, `profile-` prefix normalization, and legacy name-based fallback for pre-migration rows.
- **Write Resilience**:
  - Strictly normalizes `date` (`YYYY-MM-DD`) and `time` (`HH:MM`) before write.
  - Handles `23502` (`NOT NULL` constraint) responses by retrying with safe default placeholders when legacy column constraints differ.
  - Bulk inserts (`MassImportModal`) gracefully fall back to row-by-row insertion if a batch statement encounters a constraint violation, returning granular per-row outcomes.
- **URL Normalization (`src/lib/supabase.ts`)**: Sanitizes `VITE_SUPABASE_URL` (trimming trailing slashes/paths) to prevent PostgREST `PGRST125` errors.

### 4.4 Real-Time Multi-Device Sync
`AppContext` subscribes to Supabase Realtime channels (`postgres_changes` for `INSERT`, `UPDATE`, `DELETE`) across all 4 tables (`entries`, `growth`, `routine`, `notes`), merging live updates into React state automatically alongside a manual Navbar refresh trigger.

---

## 5. State Management & Core Workflows (`src/context/AppContext.tsx`)

`AppContext` serves as the single client-side orchestrator exposing profiles, measurements, care records, notes, theme/unit/formula settings, and mutations:

1. **Hydration & Bootstrap**: Loads `entries`, `growth`, `routine`, and `notes` concurrently from Supabase, reconstructs typed collections from `entries.payload`, restores persisted settings (`units`, `formulaSettings`, `theme`, `activeProfileId`), and falls back cleanly if a fresh database is empty.
2. **Fetus → Baby Graduation Transaction (`progressFetusToBaby`)**:
   - Creates a new `baby` `ChildProfile` populated with birth date, birth weight/length/HC, and an immutable `PrenatalSnapshot` (scan count, kick count, last GA, last EFW).
   - Links the new baby profile via `attachedFetalProfileId` and marks the original pregnancy profile with `attachedToBabyId`, `isArchivedFetus: true`, and `graduatedAt`.
   - Automatically logs the Day 0 birth measurement so WHO charts begin at birth while preserving all historical prenatal scans, kick sessions, and love notes under the linked archive.
3. **Cascading Birth-Date Age Recalculation**: Updating a baby profile's `dateOfEvent` (birth date) automatically recalculates `ageInDays`, `ageInWeeks`, and `ageInMonths` across associated `BabyMeasurement` records via `computeExactAgeFromBirth`.
4. **JSON Backup & Restore**: Supports full client-side export of all profiles, measurements, milestones, kicks, love notes, and care tables to JSON, and structured import/restore back into Supabase.

---

## 6. Clinical, Mathematical & Analytical Engines

### 6.1 UTC Calendar Age Engine (`src/utils/ageCalculator.ts`)
- Performs all date diffs in UTC midnight timestamps (`parseCalendarDateUTC`) to avoid Daylight Saving Time or local timezone off-by-one errors.
- Constants: `DAYS_PER_WEEK = 7`, `DAYS_PER_MONTH = 30.4375`, `WEEKS_PER_MONTH = 30.4375 / 7`.
- Exposes `selectAutoAgeUnit` to automatically choose `days`, `weeks`, or `months` for growth chart X-axes based on the child's age span.

### 6.2 WHO 2006 Child Growth Standards (`src/data/growthStandards.ts`)
- Embeds WHO 2006 0–36 month reference tables for boys and girls across **Weight (kg)**, **Length/Height (cm)**, and **Head Circumference (cm)** with LMS (`L`, `M`, `S`) parameters and `p3`, `p15`, `p50`, `p85`, `p97` curves.
- Linearly interpolates `L`, `M`, `S` between monthly grid points for exact continuous age lookup.
- Computes Box-Cox Z-score:
  - $Z = \frac{(X / M)^L - 1}{L \cdot S}$ when $L \neq 0$, or $Z = \frac{\ln(X / M)}{S}$ when $L = 0$.
- Converts Z-score to exact percentile ($0.1\%$–$99.9\%$) using the Abramowitz & Stegun normal CDF approximation.

### 6.3 Fetal Biometrics & Dynamic EFW Engine (`src/data/fetalStandards.ts`, `src/data/formulaSources.ts`)
- Embeds Hadlock reference bands (`p5`, `p50`, `p95`) for Weeks 12–40 covering `EFW`, `BPD`, `HC`, `AC`, and `FL`.
- Supports 5 selectable EFW equations (with automatic Hadlock 2 fallback when partial biometrics are supplied):
  1. **Hadlock IV (1985)** — BPD, HC, AC, FL (clinical gold standard default)
  2. **Hadlock III (1984)** — HC, AC, FL
  3. **Shepard (1982)** — BPD, AC
  4. **INTERGROWTH-21st (2014)** — HC, AC
  5. **Custom Formula** — User-parameterized polynomial (`baseIntercept`, `acCoeff`, `flCoeff`, `hcCoeff`, `bpdCoeff`, `acFlInteractionCoeff`)
- Supports 3 gestational age methods: **Naegele's Rule (`280 days`)**, **Mittendorf (`288 days`)**, and **Custom Cycle Length**.
- `formulaSources.ts` scopes displayed equations by profile type so fetal EFW/GA equations appear exclusively in `fetal` profiles and WHO/feeding standards appear exclusively in `baby` profiles.

### 6.4 Care & Routine Interpreter (`src/utils/careInterpreter.ts`)
- **Unified Growth Merging (`mergeProfileGrowthMeasurements`)**: Combines `BabyMeasurement` pediatric checkups (`entries`) with `GrowthRecord` daily weight/length logs (`growth`), deduplicating matching date/value pairs and recalculating exact ages so WHO charts plot a single continuous curve.
- **Weight-Based Milk Intake Target**:
  - Formula: `150–200 mL/kg/day` clinical band; default target `190 mL/kg/day` (configurable) divided by `DEFAULT_MILK_FORMULA.feedsPerDay = 6.5` (adjustable with `min="0.5" step="0.5"`).
  - **Day 6 Eligibility Gate**: `MIN_MILK_TARGET_AGE_DAYS = 6` (`isMilkTargetEligibleOnDate`). Returns ineligible for Days 0–5 so newborn colostrum/transitional days are never benchmarked against full-volume targets.
  - **Daily Weight Interpolation**: Resolves historical weight for any date by linearly interpolating between the nearest preceding and succeeding weight entries (or falling back to birth weight).
- **Hydration Benchmark**: Aggregates daily wet output as **`wet + mixed`** and evaluates against the **`>= 6/day`** newborn/infant hydration threshold.
- **Statistical Aggregation**: Computes Daily totals, Weekly/Monthly **box-plot quantiles (`min`, `Q1`, `median`, `Q3`, `max`, `mean`)**, feeding volume splits (`EBM` vs `Formula`), and `(date, time)` duplicate conflict detection.

### 6.5 Chart Scaling & Auto-Zoom (`src/utils/chartZoom.ts`)
- `computeAutoZoomRange`: Calculates a tight 200%-focused Y-axis viewport around logged data plus adjacent reference curves.
- `computeNiceAxisScale` & `buildNiceTicksWithStep`: Produces clean `1 / 2 / 2.5 / 5 × 10^n` tick intervals directly in the active display unit (`metric` or `imperial`) so labels never show awkward decimal conversion artifacts.

---

## 7. AI Integration Architecture

### 7.1 Server-Side Proxy (`/api/gemini.ts` & `/api/health.ts`)
- **Strict Key Isolation**: Reads `VITE_GEMINI_KEY` or `GEMINI_API_KEY` solely on the server; API keys are never exposed in client bundles or UI inputs.
- **Model Resilience & Fallback**:
  - Primary model: `gemini-4-hydrogen`
  - Automatic retry & fallback to `gemini-3.1-flash-lite` on `503`, `404`, or `UNAVAILABLE` upstream errors.
- **Supported Capabilities**:
  - Single-turn `prompt`, multi-turn `messages`, raw `parts`, `systemInstruction`, `thinkingLevel` (`LOW` | `MEDIUM` | `HIGH`).
  - Up to **12 binary attachments** (`image/*`, `application/pdf`, `text/plain`, `text/csv`, `audio/*`).
  - Strict structured output via `responseMimeType: "application/json"` + `responseSchema`.
- **Health Check (`/api/health.ts`)**: Executes a lightweight probe and returns service status, active key source name, model identifier, and latency (`latencyMs`).

### 7.2 Client AI Workflows
| Module | Purpose | Pattern |
| :--- | :--- | :--- |
| **`geminiContextBuilder.ts`** | Builds bounded clinical context for Q&A | Serializes active profile, exact age, latest WHO percentiles, up to 40 growth rows, 25 checkups/ultrasounds, 60 routine rows, daily milk/hydration totals (`wet + mixed`, Day 6+ targets), and 10 recent notes. |
| **`AskGeminiModal.tsx`** | Multi-turn pediatric/prenatal Q&A | Sends conversation history + `systemInstruction` to `/api/gemini`; renders Markdown safely as React elements (no `dangerouslySetInnerHTML`). |
| **`MassImportModal.tsx`** | Multimodal log extraction | Accepts text tables, camera captures, images, or PDFs/CSVs; requests strict JSON via `MASS_IMPORT_ROUTINE_ITEM_SCHEMA` / `MASS_IMPORT_GROWTH_ITEM_SCHEMA`; flags duplicates against live DB rows before bulk insert. |
| **`OptimizeHistoryModal.tsx`** | Automated data cleanup | Sends batches of 45 rows with `OPTIMIZE_RESPONSE_SCHEMA` to parse structured values trapped in `remark` fields; previews per-field diffs and requires `EditAuthModal` authorization before updating Supabase. |

---

## 8. Security, Authentication & Privacy Model

1. **Optional Portal Passkey Gate (`src/utils/authConfig.ts`, `PasswordGate.tsx`)**:
   - Controlled via environment variable `baepass_Key=1` and one or more `bae_Key*` passkeys injected at build time via Vite `define` (`__BAEPASS_KEY__`, `__BAE_KEYS__`).
   - Verified passkeys set a 30-day `SameSite=Lax` browser cookie (`bae_site_authenticated`) via `cookieUtils.ts`.
   - Navbar exposes an instant **Lock Portal** action to clear the session cookie.
2. **Mutation Safeguards**:
   - **Record Edits & AI Optimization Writes**: Gated behind `EditAuthModal` (`verifyEditPassword`).
   - **Profile Deletion**: Gated behind a 3-step confirmation in `DeleteProfileModal` (passkey verification + exact profile name or `"DELETE"` match + explicit confirmation checkbox).
3. **XSS & Injection Safety**:
   - All Supabase writes use parameterized `@supabase/supabase-js` query builders.
   - AI Markdown output in `AskGeminiModal` is tokenized into React nodes rather than raw HTML.
4. **Operational Security Note**:
   - `supabase/schema.sql` ships with permissive RLS policies (`using (true)`) tailored for single-family passkey-gated deployments; multi-tenant deployments should tighten RLS policies to match authenticated user claims.

---

## 9. Environment Variables & Build/Deploy Pipeline

### 9.1 Environment Variables (`.env.example`)
| Variable | Scope | Purpose |
| :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | Client | Supabase project URL (normalized by `src/lib/supabase.ts`) |
| `VITE_SUPABASE_ANON_KEY` | Client | Supabase public anonymous key |
| `GEMINI_API_KEY` / `VITE_GEMINI_KEY` | Server (`/api/gemini`) | Google Gemini API key (read server-side only) |
| `baepass_Key` | Build (`vite.config.ts`) | Set to `1` to enforce the `PasswordGate` portal lock |
| `bae_Key` / `bae_Key*` | Build (`vite.config.ts`) | Allowed portal & edit passkeys |
| `PORT` | Server (`server.ts`) | HTTP listen port (defaults to `3000`) |
| `DISABLE_HMR` | Server (`server.ts`) | Set to `true` in proxied/iframe environments to disable Vite HMR/WS |

### 9.2 NPM Scripts (`package.json`)
- `npm run dev` — Starts `tsx server.ts` (Express + Vite middleware on port `3000`).
- `npm run build` — Compiles the production Vite SPA bundle to `dist/`.
- `npm start` — Runs `node server.ts` serving static `dist/` and `/api/*` endpoints.
- `npm run lint` — Runs TypeScript type-checking (`tsc --noEmit`) across the project.
