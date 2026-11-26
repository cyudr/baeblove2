# Design System & UX Architecture — Sprout & Bloom (BaeLove Portal)

> **Document Scope**: Grounded in the full codebase of **Sprout & Bloom — Fetal & Baby Growth Tracker** (branded in-app as **BaeLove** / **BaeLove Portal**). Documents the visual language, persona-adaptive UX, color & glow token system, layout and navigation patterns, data visualizations, AI interaction flows, and clinical/accessibility conventions.

---

## 1. Product Identity & Dual-Persona Experience

The application pairs **clinical-grade biometric tracking** (WHO 2006 child growth standards, Hadlock/INTERGROWTH-21st fetal ultrasound curves, CDC/AAP developmental milestones) with an intimate **family keepsake experience** (kick sessions, ad hoc notes, milestone cards, and love letters).

### Dual Profile Modes (`ProfileType = 'fetal' | 'baby'`)
Every view, chart, formula catalog, and KPI adapts automatically to the active `ChildProfile.type`:

| Aspect | Pregnancy Mode (`fetal`) | Infant / Toddler Mode (`baby`) |
| :--- | :--- | :--- |
| **Primary Accent** | Warm **Amber / Gold** (`amber-500/600`) | Calm **Emerald / Teal** (`emerald-500/600`) |
| **Core Metric Focus** | Gestational age (weeks + days), Estimated Fetal Weight (EFW), BPD, HC, AC, FL, CRL, maternal weight, fundal height | Weight, length/height, head circumference, body temperature, feeding volume (EBM + Formula), diaper output |
| **Reference Curves** | Hadlock Weeks 12–40 (`5th`, `50th`, `95th` bands) | WHO 2006 0–36 Months (`3rd`, `15th`, `50th`, `85th`, `97th` bands) |
| **Formula Modal Scope** | Fetal EFW equations (`Hadlock IV`, `Hadlock III`, `Shepard`, `INTERGROWTH-21st`, `Custom`) & Gestational Age methods (`Naegele`, `Mittendorf`, `Custom`) | WHO 2006 LMS Z-score / percentile standards & infant feeding/hydration clinical benchmarks |
| **Stages & Milestones Hub** | Pregnancy week-by-week guide (Weeks 4–42), fruit/botanical size analogies, Kick Counter ("Count the Kicks"), maternal recipes, and Keepsake Wishes | 52-week & 0–36 month developmental expectations, CDC/AAP 4-domain milestone checklist, 4-pillar care plans, infant recipes, and Ad Hoc Notes |
| **Lifecycle Transition** | Supports **Fetus → Baby Graduation** (`GraduateFetalModal`), converting a pregnancy profile into a live newborn profile while archiving and linking all prenatal ultrasound scans, kick sessions, and love letters (`attachedFetalProfileId` + `prenatalSnapshot`) | Graduated baby profiles expose an **Attached Prenatal History** viewer (`AttachedPrenatalHistoryModal`) directly from the profile switcher and overview |

---

## 2. Visual Language & Color System

### 2.1 Surface & Neutral Palette
Built on Tailwind CSS v4 (`@import "tailwindcss";`) using warm **Stone** neutrals rather than sterile cool grays, reinforcing warmth while keeping high-contrast clinical legibility:

- **Light Mode (`:root`)**:
  - Page Canvas: `bg-stone-50`
  - Primary Cards & Modals: `bg-white` with `border-stone-200/80`
  - Subtle Nested Containers / Form Inputs: `bg-stone-50` / `bg-stone-100`
  - Primary Text: `text-stone-900`; Secondary Text: `text-stone-600`; Muted/Meta: `text-stone-400` / `text-stone-500`
- **Dark Mode (`:root.dark`, via `@custom-variant dark (&:where(.dark, .dark *));`)**:
  - Page Canvas: `bg-stone-950`
  - Primary Cards & Modals: `bg-stone-900` with `border-stone-800`
  - Subtle Nested Containers / Form Inputs: `bg-stone-800` / `bg-stone-800/60`
  - Primary Text: `text-white` / `text-stone-100`; Secondary Text: `text-stone-300`; Muted/Meta: `text-stone-400`

### 2.2 Automatic Time-Based Theming
The app uses an ambient circadian theme schedule (managed in `AppContext`) designed for late-night feedings and daytime pediatric checkups:
- **Daytime (`06:00–18:59` local time)**: Automatic **Light Mode**.
- **Nighttime (`19:00–05:59` local time)**: Automatic **Dark Mode**.
- Re-evaluated every `60 seconds` as well as on window `focus` and `visibilitychange`.
- **Manual Override**: Clicking the Sun/Moon toggle in the Navbar sets `isThemeOverridden = true` and persists the user's explicit preference via the `entries` settings store.

### 2.3 Clinical & Functional Accent Semantics
Accents are strictly mapped to domain meaning so caregivers can scan dense logs without reading every label:

| Domain / Signal | Color Family | Usage |
| :--- | :--- | :--- |
| **Baby Profile / Healthy Growth / EBM / Normal Temp** | **Emerald** (`emerald-500/600/400`) | Active baby badge, WHO 50th median curve, Expressed Breast Milk (`emb_mL`) bars, normal temperature (`36.0–37.4°C`), Day 6+ milk target met, cognitive milestones |
| **Pregnancy Profile / Hadlock Median / Formulas / Warnings** | **Amber** (`amber-500/600/400`) | Active fetal badge, Hadlock 50th median, formula source indicator, elevated temperature (`37.5–37.9°C`), dirty diapers, movement milestones, keepsake wishes |
| **Formula Milk / Bottle / Low Temp / Notes** | **Sky** (`sky-500/600/400`) | Formula milk (`formula_mL`) bars, bottle feeding method, low temperature (`<36.0°C`), language milestones, ad hoc notes |
| **Fever / Kick Counter / Danger / Latch** | **Rose** (`rose-500/600/400`) | Fever alert (`>=38.0°C`), kick counter active state, delete profile/record confirmations, latch feeding method, social milestones |
| **Mixed Diapers / Cup Feeding / AI Features** | **Purple / Violet / Indigo** (`purple-*`, `violet-*`, `indigo-*`) | Mixed diaper output, cup feeding method, Ask Gemini / Mass Import / Optimize History triggers |

---

## 3. Semantic Text-Glow Token System (Routine & Care Logs)

To keep dense routine tables (`RoutineView`, `HistoryLogsView`) and form selectors (`FeedingMethodSelect`, `DiaperLoadControl`, `StoolSelect`) visually calm and free of heavy boxed pills, categorical care values use **color-coded text with soft semantic text-shadow glow** (`[text-shadow:...]`) and **zero box fills or borders**:

### 3.1 Feeding Method (`getFeedingMethodBadgeClass`)
| Value | Label | Light / Dark Text & Glow Family |
| :--- | :--- | :--- |
| `bottle` | Bottle | **Sky** (`text-sky-600 dark:text-sky-300` + sky glow) |
| `latch` | Latch | **Rose** (`text-rose-600 dark:text-rose-300` + rose glow) |
| `cup` | Cup | **Violet** (`text-violet-600 dark:text-violet-300` + violet glow) |
| `stringe` | Stringe | **Teal** (`text-teal-600 dark:text-teal-300` + teal glow) |
| Custom | *(user string)* | **Indigo** (`text-indigo-600 dark:text-indigo-300` + indigo glow) |

### 3.2 Diaper Type (`getDiaperTypeBadgeClass`)
| Value | Meaning | Light / Dark Text & Glow Family |
| :--- | :--- | :--- |
| `wet` | Wet (urine) | **Blue** (`text-blue-600 dark:text-blue-300` + blue glow) |
| `dirty` | Dirty (stool) | **Amber** (`text-amber-600 dark:text-amber-300` + amber glow) |
| `mixed` | Mixed (wet + stool) | **Purple** (`text-purple-600 dark:text-purple-300` + purple glow) |
| Custom | *(other)* | **Stone** (`text-stone-600 dark:text-stone-300` + stone glow) |

### 3.3 Diaper Load (`getDiaperLoadBadgeClass`)
Escalates visually with intensity across `x1` through `x5+` (rendered in `font-mono font-bold`):
| Load | Color Family | Visual Progression |
| :--- | :--- | :--- |
| `x1` | **Emerald** | Baseline / normal single load |
| `x2` | **Sky** | Moderate double load |
| `x3` | **Amber** | Heavy triple load |
| `x4` | **Orange** | Very heavy quadruple load |
| `x5+` | **Rose** | Peak / high-intensity load |

### 3.4 Stool Color Code (`getStoolBadgeClass`)
| Code | Clinical Label | Light / Dark Text & Glow Family |
| :--- | :--- | :--- |
| `M` | Meconium | **Zinc** (dark neutral glow) |
| `G` | Greenish | **Green** (green glow) |
| `GY` | Greenish Yellow | **Lime** (lime glow) |
| `Y` | Yellow | **Yellow** (warm yellow glow) |
| Custom | *(custom text)* | **Orange** (orange glow) |

### 3.5 Temperature Classification (`classifyTemperature`)
| Range (°C) | Label | Accent |
| :--- | :--- | :--- |
| `< 36.0` | Low | **Sky** |
| `36.0 – 37.4` | Normal | **Emerald** |
| `37.5 – 37.9` | Elevated | **Amber** |
| `>= 38.0` | Fever | **Rose** |

---

## 4. Typography & Numeric Conventions

- **Font Families**: Clean system sans-serif UI typography paired with monospace (`font-mono`) for clinical measurements, dates, timestamps, percentiles, and load counters.
- **Tabular Alignment**: Numeric KPIs, chart readouts, and table columns use `tabular-nums` / `font-mono` to prevent horizontal jitter during chart scrubbing or live updates.
- **Clinical Unit Precision (`UnitConverter`)**:
  - Metric Weight: up to **3 decimal places** (`kg`, e.g., `3.425 kg`) to preserve gram-level newborn tracking; imperial converts cleanly to `lb` / `oz`.
  - Metric Length / Head Circumference: `cm` (`0.1` precision); imperial converts to `in`.
  - Fetal Biometrics: `mm` for CRL/BPD/HC/AC/FL and `g` for EFW.
- **Adaptive Age Formatting (`ageCalculator.ts`)**:
  - Automatically formats age into natural clinical units depending on infant maturity: days (early newborn), weeks + days, months + days, or years + months, computed strictly via timezone-independent UTC calendar arithmetic.

---

## 5. Layout, Navigation & Responsive Shell

### 5.1 Application Shell (`App.tsx`, `Navbar.tsx`, `MobileTabBar.tsx`)
- **Fixed Top Navigation (`Navbar`, `h-14`, `z-40`)**:
  - Glassmorphic translucent surface (`bg-white/85 dark:bg-stone-900/85 backdrop-blur-md border-b`).
  - **Left**: Brand mark (`BaeLove`) + interactive **Profile Switcher Dropdown** listing active profiles (`baby` / `fetal`) with quick actions to Add Profile, Edit Profile, Graduate Pregnancy → Baby, View Attached Prenatal History, or Delete Profile.
  - **Center (Desktop `md+`)**: 5-tab segmented pill bar (`Overview`, `Growth`, `Routine`, `Stages & Milestones`, `History`).
  - **Right**: Compact icon utilities — **Sync/Refresh**, **Theme Toggle**, **Formulas (`FormulaSourceModal`)**, **Export Report (`ExportReportModal`)**, **Lock Portal** (when `baepass_Key=1`), and mobile overflow menu.
- **Fixed Bottom Navigation (`MobileTabBar`, `h-16`, `md:hidden`, `z-40`)**:
  - 5-item mobile tab bar with safe-area padding (`pb-safe`) and `min-h-[44px]` touch targets for one-handed mobile logging during night feeds.
- **Main Content Area**:
  - Constrained centered container (`max-w-6xl` / responsive padding) with top offset for `Navbar` and bottom offset (`pb-24 md:pb-12`) for `MobileTabBar`.

### 5.2 Primary Views & Sub-Navigation
1. **Overview (`GrowthDashboardView`)**:
   - Persona-aware hero banner (Baby age + latest weight/length/HC percentiles + Day 6+ milk & hydration summary; or Fetal gestational age + botanical fruit size analogy + latest EFW/ultrasound scan).
   - Quick KPI cards clickable into `CardDetailPopupModal` (24 specialized clinical drill-down templates including 4-pillar care plans, recipes, and milestone guides).
   - Embedded `GrowthVelocityCard`, `MilestoneRadarProgress`, and preview charts.
2. **Growth (`GrowthTabView`)**:
   - **Collapsible Log Card** (`Add Daily Growth & Vitals`) with **Retrieve Last** and **Edit Last** shortcuts, duplicate `(date, time)` conflict warnings, and quick links to **Ask Gemini**, **Mass Import**, and **Optimize History**.
   - Full-width `InteractiveGrowthChart` (baby) or `FetalBiometricsChart` (fetal) with metric switcher (`Weight`, `Length`, `Head` / `EFW`, `BPD`, `HC`, `AC`, `FL`).
   - Filterable daily growth & vitals ledger with `RemarkTooltipCell` popovers and auth-gated edit/delete actions.
3. **Routine (`RoutineView`)**:
   - **Collapsible Log Card** (`Add Feeding & Diaper Record`) with EBM (`mL`), Formula (`mL`), Feed Duration (`min`), `FeedingMethodSelect`, Diaper Type (`wet`/`dirty`/`mixed`), `DiaperLoadControl` (`x1`, `x2`, `x3`...), `StoolSelect` (`M`/`G`/`GY`/`Y`), and Remark.
   - Configurable weight-based Milk Target bar (default `190 mL/kg/day`, `6.5` feeds/day, **active Day 6 onwards only**).
   - `RoutineTrendCharts` (Daily / Weekly / Monthly milk intake + Diaper hydration trend).
   - Daily grouped routine ledger with semantic text-glow indicators and inline edit/delete triggers.
4. **Stages & Milestones (`StagesAndMilestonesView`)**:
   - 3-segment sub-navigation:
     - **`stages`**: `StagesAndWishesView` — Week-by-week & month-by-month developmental guide, maternal/infant curated recipes, and Keepsake Wishes / Love Notes (`AddLoveNoteModal`).
     - **`milestones`**: Renders `MilestonesView` (CDC/AAP 2–36m 4-domain checklist + custom milestones via `AddMilestoneModal` + red-flag consult guidance) for `baby` profiles, or `FetalHubView` (interactive Kick Counter + prenatal tracker) for `fetal` profiles.
     - **`notes`**: Profile-scoped Ad Hoc Notes journal (`notes` table) with quick composer and search.
5. **History (`HistoryLogsView`)**:
   - Unified chronological archive combining Pediatric Checkups / Ultrasound Scans (`entries`), Daily Growth (`growth`), Daily Routine (`routine`), and Notes (`notes`), with search, category filtering, JSON export/import backup controls, and print report triggers.

---

## 6. Data Visualization Design

All charts are rendered as **custom responsive pure-SVG visualizations** (zero heavy third-party charting dependencies) to guarantee crisp clinical curves, exact display-unit ticks, and touch-friendly scrubbing.

### 6.1 WHO Growth & Fetal Biometrics Charts (`InteractiveGrowthChart`, `FetalBiometricsChart`)
- **Canvas Geometry**: Responsive SVG (`viewBox="0 0 800 450"` for baby, `viewBox="0 0 800 420"` for fetal) with clean gridlines and 1:1 display-unit nice ticks (`computeNiceAxisScale` using `1 / 2 / 2.5 / 5` step progression).
- **200% Auto-Zoom (`computeAutoZoomRange`)**: Automatically zooms the Y-axis around the child's active data range and surrounding reference bands while preserving full-curve toggleability.
- **Reference Band Layering**:
  - **Baby (WHO 2006)**: Soft outer band (`3rd–97th`), inner interquartile band (`15th–85th`), and crisp emerald median curve (`50th`).
  - **Fetal (Hadlock)**: Soft amber reference band (`5th–95th`) and amber median curve (`50th`).
- **Fixed-Height 3-Row Summary Strip (`h-[76px]`)**:
  - Positioned directly above the SVG canvas with a **locked height (`h-[76px]`)** to eliminate vertical layout shift when transitioning between idle (**Latest**) and active pointer/touch (**Scrubber**) states:
    - **Latest Mode (3 rows)**:
      - Row 1: Latest metric value + unit
      - Row 2: Exact age + calculated percentile badge
      - Row 3: Reference `Band:` range (3rd–97th / 5th–95th; concise label without redundant `"Expected"` prefix)
    - **Scrubber Mode (3 rows)**:
      - Row 1: Scrubber age + median/interpolated reference value
      - Row 2: `Logged:` actual recorded value at/near scrubber point (if present)
      - Row 3: Reference `Band:` range at the scrubbed age
- **Interactive Scrubber**: Persistent pointer/touch crosshair with vertical guide line, highlighted active node, and dark floating SVG tooltip card.

### 6.2 Routine Trend Charts (`RoutineTrendCharts`)
- **Milk Intake Visualization (Daily / Weekly / Monthly)**:
  - **Daily View**: Stacked vertical bars (**Emerald** = EBM `emb_mL`, **Sky** = Formula `formula_mL`) overlaid with a **green dotted target line** representing the weight-based daily milk target (`150–200 mL/kg/day`, default `190 mL/kg/day`, default `6.5` feeds/day).
  - **Day 6 Eligibility Rule (`MIN_MILK_TARGET_AGE_DAYS = 6`)**: The recommended milk target dotted line, per-feed target, and red-to-emerald target attainment indicator are **only displayed from Day 6 onwards** (Days 0–5 newborn colostrum/transitional days intentionally omit the target line to avoid misleading parents).
  - **Weekly & Monthly Views**: Custom **SVG Box-and-Whisker Plots** showing `min`, `Q1`, `median`, `Q3`, `max`, and `mean` daily intake per period.
- **Diaper & Hydration Visualization**:
  - Stacked bars displaying `Wet` (blue), `Mixed` (purple), and `Dirty` (amber) counts.
  - **Hydration Benchmark**: Evaluated as **`wet + mixed >= 6/day`** (explicitly counting mixed diapers toward wet output).

### 6.3 Clinical Rate & Progress Cards
- **`GrowthVelocityCard`**: Displays daily weight gain (`g/day`) and monthly length velocity (`cm/mo`) benchmarked against age-appropriate pediatric velocity norms.
- **`MilestoneRadarProgress`**: 4-domain horizontal progress bars color-coded by CDC developmental category (`movement` amber, `language` sky, `cognitive` emerald, `social` rose).

---

## 7. Interaction Patterns, Modals & Micro-UX

### 7.1 Modal Layering & Portal Tooltips
- **Standard Modals (`z-50`)**: Backdrop-blurred overlays (`bg-stone-950/60 backdrop-blur-xs`) with sticky headers, scrollable content bodies, and explicit close controls.
- **Auth Confirmation Modals (`EditAuthModal`, `DeleteProfileModal`, `z-[60]`)**: Stack cleanly above content modals when authorizing edits or deletions.
- **Viewport-Clamped Portal Tooltips (`RemarkTooltipCell`, `z-[70]`)**: Rendered via `createPortal` into `document.body`, dynamically clamped to viewport edges so long caregiver remarks never clip inside horizontally scrolling tables.

### 7.2 Ergonomic Form & Logging Conventions
- **Global Enter-Key Blur (`App.tsx`)**: Pressing `Enter` inside text/number inputs gracefully blurs the field (dismissing mobile keyboards cleanly without unintended form resets).
- **Quick-Fill Helpers**: Daily Growth and Routine forms provide `Retrieve Last` (copies prior values for fast logging) and `Edit Last` (jumps straight into editing the latest record).
- **Duplicate Timestamp Guard**: Inline warning highlights when a new log matches an existing `(date, time)` entry in `GrowthTabView` or `RoutineView`.
- **Celebratory Micro-Feedback (`canvas-confetti`)**: Subtle confetti bursts trigger on portal unlock (`PasswordGate`), reaching the 10th kick in `FetalHubView`, completing a developmental milestone, and saving a Love Note.

### 7.3 AI-Assisted UX Flows
AI tools appear strictly as purposeful, on-demand modal utilities rather than intrusive sidebars:
1. **`AskGeminiModal`**: Contextual pediatric/prenatal Q&A (`focus: 'growth' | 'routine'`) pre-seeded with the active profile's real metrics, WHO percentiles, recent growth/routine logs, and notes. Renders responses via a custom **XSS-safe React inline markdown parser** (headings, lists, bold/italic/code, zero `dangerouslySetInnerHTML`).
2. **`MassImportModal`**: Multimodal batch importer accepting pasted tabular notes, live camera capture, photo uploads, or PDFs/CSVs (up to 12 files). Presents an editable review grid with automatic database duplicate flagging before committing bulk inserts.
3. **`OptimizeHistoryModal`**: Database hygiene auditor that scans routine/growth records in batches of 45 rows, proposing structured column extraction from free-text `remark` fields and presenting a field-by-field `before → after` diff table gated by `EditAuthModal`.

### 7.4 Access Gates, Print & Clinical Disclaimers
- **Site Portal Gate (`PasswordGate`)**: Full-screen warm stone/emerald passkey screen (active when `baepass_Key=1`) with show/hide toggle and 30-day session persistence.
- **Edit & Destructive Safeguards**:
  - Editing historical records triggers `EditAuthModal`.
  - Deleting a profile requires 3-step verification in `DeleteProfileModal`: passkey entry + typing the exact profile name (or `"DELETE"`) + checking an explicit irreversible-action acknowledgement.
- **Print & PDF Reports (`ExportReportModal`, `AttachedPrenatalHistoryModal`)**: Clean print-optimized clinical summaries (`window.print()` with `@media print` utility visibility classes) suitable for pediatrician or OB-GYN visits.
- **Clinical Disclaimer**: Formula and AI modals explicitly communicate that percentiles, milk targets, and AI summaries are educational/informational aids and do not replace medical advice from a pediatrician or OB-GYN.
