# MightyCringe — Application Overview

**Document:** Application Overview / Product Requirements
**Version:** v0.2.8
**Status:** Draft
**Date:** 2026-07-13
**Owner:** R
**Supersedes:** v0.2.7 (and v0.2.6, v0.2.5, v0.2.4, v0.2.1, v0.2.0, v0.1.0). All prior versions are kept on disk — files are immutable, see §0.
**Paired mockups:** `MightyCringe_Mockups_v0.2.8.html` (the Overview and the mockups share the same version number).

---

## 0. About this document and versioning

This is the founding document for **MightyCringe**, a strength-training web app. It defines *what* the app is, *who* it is for, and *what it must do*, plus a proposed technical architecture. It is the shared reference for the interactive mockups and for the implementation in Claude Code.

**Versioning rule (applies to every file in this project):**

- Files use semantic versioning `vX.Y.Z`: **X** = super-major (new direction), **Y** = major (significant addition/restructuring), **Z** = minor (small edits/clarifications/decisions).
- **Files are immutable.** We never edit an old file in place. Every change creates a **new file** with a bumped version, so the full history is preserved on disk.
- **The Overview tracks the mockup version.** Every time the mockups are updated, this document is reviewed for consistency and a matching-version Overview file is produced.

### 0.1 Changelog

**v0.2.8 (this file) — synced with mockups v0.2.8.** The central tab is renamed **«Пояснить»** with a **mic + pencil** icon (🎙️✏️) and **opens in the last-used input mode** (voice or text) — comfortable both for those who dictate and those who type (§5.0, §5.2).

**v0.2.7 — synced with mockups v0.2.7.** On the current-exercise screen the **main technique video is embedded** — an inline 16:9 player you tap ▶ to watch **in-app**, with an **"open on YouTube"** link; alternative videos remain as list links (§5.3, §5.6).

**v0.2.6 — synced with mockups v0.2.6.** Added an **in-workout current-exercise screen**: during an active session, tapping an exercise opens a view with **sets logged today**, **previous results**, and **technique video**, plus **＋ Подход** / **↻ Replace** and a **back-to-workout** action (§5.3). Also: while a workout is running, the **Тренировка** tab opens the live session instead of the start screen (§5.0).

**v0.2.5 — synced with mockups v0.2.5.** Set logging made explicit: on the live workout screen each exercise has a clear **«＋ Подход»** button that opens a *Новый подход* sheet offering **🎙️ voice** or **manual entry** (weight × reps × RIR) — no more relying on an unlabeled mic icon. Replace-exercise alternatives now include machine variants (e.g., chest → «Жим от груди в тренажёре»).

**v0.2.4 — synced with mockups v0.2.4.** Captures the decisions made across the interactive-mockup rounds:

1. **Muscle-group taxonomy refined.** Shoulders are split into **front / middle / rear delts**; legs into **quadriceps and hamstrings**. These are distinct groups for the catalog, supersets, and progress.
2. **Superset rule — no synergist overlap.** Don't pair a muscle with one already worked as a synergist by its partner: a chest press already loads **triceps and front delt**; a back pull already loads **biceps and rear delt**. The example scheme became **Back + Middle-delt · Chest + Biceps · Quads + Triceps** (lagging groups still first).
3. **Information architecture / tabs.** Bottom tabs are **Тренировка · Прогресс · Сказать · Каталог · Настройки**, with **Сказать** (voice/text) as a raised **central** tab available on every screen (replaced an overlapping floating button).
4. **Body measurements live inside Progress** (calendar → strength-by-group → body trends → full history), not a separate tab.
5. **Progress is group/exercise-selectable** — pick a muscle group or exercise and the strength chart rebuilds (not one hardcoded lift). Calendar shown first.
6. **All-workouts history + per-workout detail**, plus an explicit **replace-exercise** flow (alternatives filtered by the same muscle group, or the full catalog).
7. **"Profile" renamed "Settings" (Настройки)**; the RU/EN language toggle lives only there (removed from the header).
8. **UI style:** dark "energetic" theme (lime accent) chosen; mobile-first, each key screen fits one viewport without scrolling.

**v0.2.1 — resolved the six open questions:** trainer = read-only athlete view (no notes); transcription + understanding in the cloud via **OpenRouter** (no self-hosted Whisper); small cheap VPS; Flash-class model + fallback; one active trainer per athlete; audio retained long-term; superadmin sees all directly (no impersonation), audit logging minimal.

**v0.2.0 — earlier major changes:** multi-user instead of single-user; Google OAuth; three-role model with superadmin/trainer consoles, invites and trainer↔athlete links; conversational LLM voice; full i18n (EN/RU + extensible); SQLite (migration-friendly to Postgres); Epley + RIR for estimated 1RM.

---

## 1. What is "MightyCringe"?

The name comes from a personal joke: every exercise gets sorted into one of three buckets.

| Tag | RU | Meaning |
| --- | --- | --- |
| **Mighty** | Эпичные | The heroic lifts — the ones that make you feel strong and look cool. |
| **Normal** | Обычные | The regular working exercises — the honest volume that builds the body. |
| **Cringe** | Унизительные | The humbling, slightly-embarrassing-but-necessary movements that fix your weak points. |

Every exercise in the catalog carries one of these three tags. It's a lightweight, fun classification (not training science), and the app leans into it with tone and small visual cues. A short in-app **"Почему MightyCringe?"** screen tells the joke plainly (it does **not** pre-assign specific exercises to the buckets — the owner tags them himself).

---

## 2. Vision and goals

**Vision.** A voice-first workout companion you can *talk to like a person* — walk into the gym, train full-body by feel, say whatever you're doing in plain language, and have it understood and logged *without touching buttons* — while never losing a single number, and cheering you on rather than nagging you.

**Primary goals.**

1. **Log a full workout hands-free, in natural language.** Speaking is the main input; tapping is the fallback.
2. **Zero data loss, ever.** Once confirmed, data survives dropped connections, closed tabs, reloads, and dead batteries. Even raw utterances (audio + transcript) are kept.
3. **Instant recall.** The moment an exercise is recognized, show what you did last time so you know what to beat.
4. **Freedom, not a rigid program.** Suggest a sensible workout, let you change anything on the fly.
5. **Encouragement, not discipline.** Praise, celebrate, gently remind — never scold.
6. **Shareable with a coach.** A trainer can follow their athletes' progress (read-only); the owner oversees everything.

**Non-goals for now.** Not a social network, not an automated coaching/programming engine (trainer-assigned programs are a future idea), not a nutrition tracker.

---

## 3. Training style it must fit

The app is designed around exactly how the owner (R) trains, and other athletes get the same freeform model:

- **Frequency:** strength training 2–7×/week; trying to go every day.
- **Every session is full-body** — all major muscle groups each time.
- **5–8 exercises per session**, **superset-based** (two exercises paired back-to-back).
- **Freeform, not program-locked.** Show up, train to the scheme, pick exercises you enjoy in the moment, avoid waiting for busy equipment.

### 3.1 Muscle groups (taxonomy)
Chest · Back · **Front delt** · **Middle delt** · **Rear delt** · Biceps · Triceps · **Quadriceps** · **Hamstrings** · Calves (+ core/abs as needed). Shoulders and legs are intentionally split because their sub-heads are trained and progressed separately.

### 3.2 Superset pairing rule — avoid synergist overlap
Supersets pair muscle groups that **don't share load**, so each gets a fresh effort:

- A **chest press** already recruits **triceps** and **front delt** → don't superset chest with triceps or front delt.
- A **back pull** already recruits **biceps** and **rear delt** → don't superset back with biceps or rear delt.
- Middle delt (lateral raises), quads, hamstrings, calves are relatively independent and pair freely.

**Current scheme** (lagging groups — back & shoulders — worked first, freshest):

1. **Back + Middle delt** (e.g., Lat pulldown + Seated DB press)
2. **Chest + Biceps** (e.g., Bench press + Biceps curl)
3. **Quadriceps + Triceps** (e.g., Squat + Skull crusher)

*(The owner historically paired Chest–Triceps / Back–Biceps / Legs–Shoulders; this was refined to remove the double-loading.)* The scheme is data-driven (see `SchemeConfig`) so pairings and ordering are easy to change.

---

## 4. Core principles

1. **Voice-first & conversational.** Every core action is doable by natural speech (or text) via the central **«Пояснить»** button (🎙️+✏️, on every screen). The app understands intent, not just keywords. Buttons are the fallback and the editor.
2. **Local-first / offline-first for your data.** Works offline for logging and viewing; confirmed data is written locally instantly, then synced. (Voice *understanding* needs connectivity — see §4a.)
3. **Confirm before commit.** The app shows what it understood and waits for a quick confirmation before saving.
4. **Mobile-first, information-dense.** Designed for a phone held one-handed in a gym; each key screen fits one viewport without scrolling. Fully responsive for desktop.
5. **Installable (PWA).** Opens in a browser, adds to the iOS Home Screen, launches full-screen.
6. **Encouraging by default.** Warm, motivating copy and celebrations; never scolding.
7. **Self-hosted core, cloud AI.** App + database run on your own small VPS. The AI (transcription + understanding) runs in the cloud via OpenRouter, behind a swappable abstraction.
8. **Multi-user with clear boundaries.** Every athlete's data is private to them and their linked trainer; roles enforced server-side; superadmin sees everything.

### 4a. What "offline" does and doesn't cover
- **Works offline:** starting/editing a workout, typing sets, viewing history/progress/calendar, and **capturing voice** (audio stored locally and queued).
- **Needs connectivity:** turning captured audio into a confirmed set (cloud transcription + understanding). When offline, the audio/transcript is saved and processed on reconnect, or you enter the set by tap. Nothing captured is ever lost.

---

## 5. Feature requirements

### 5.0 Navigation / information architecture
Bottom tab bar (**athlete**), left→right:

1. **Тренировка** — home, streak/stats, today's suggested session, start workout, recent workouts, catalog shortcut. **While a workout is running, this tab opens the live session** (not the start screen).
2. **Прогресс** — workout calendar, strength-by-group chart, and **body measurements** (trends + full history).
3. **Пояснить** — a raised, highlighted **central** tab (mic + pencil icon 🎙️✏️) that opens the voice/text assistant from any screen (context-aware). It **opens in your last-used input mode** (voice or text), so it fits both people who dictate and people who type. Primary input entry; replaced an overlapping floating button.
4. **Каталог** — the exercise library.
5. **Настройки** — account (Google), language (RU/EN), units, reminders, trainer link, "About the name."

**Trainer** and **Superadmin** have their own console tab sets (see §5.11). Body-measurement tracking is **not** a separate tab — it lives inside Прогресс.

### 5.1 Workout mode
- A prominent **Start workout** action begins a live session.
- On start, the app **proposes a logical full-body workout** (5–8 exercises) from the current superset scheme (§3.2), recent history, and rotation.
- Supersets are shown as **separate exercise cards linked by a bracket** (not merged into one line).
- The proposed session is fully **editable on the fly**: add, remove, replace, reorder, re-pair — by voice or tap.
- The **whole session fits one screen** (compact cards); the live workout and the setup screen both avoid scrolling.
- Ending a workout saves it to the calendar and history with date, time, and duration.

### 5.2 Conversational voice logging (the heart of the app)
Talk to the app in natural language; it figures out intent. Two kinds of utterance, often mixed:
- **Set logging:** exercise + weight + reps + RIR + free-text comment.
- **Workout commands:** swap / add / remove / reorder exercises, re-pair supersets, "same as last set," "next exercise," etc.

**Example.** *"Слушай, штанга занята, я делаю бабочку на грудь."* → understood as **substituting** the chest movement with a **pec fly**, mapped to the catalog. Then *"Сорок на двенадцать, один в запасе, грудь хорошо тянет"* → logs **40 kg × 12, RIR 1**, comment *"грудь хорошо тянет."*

Requirements: voice **or** text interchangeably; messy phrasing tolerated; exercise recognized (RU/EN + aliases); weight/reps/**RIR**/comment extracted; **playback + confirm before save**; **raw audio + transcript stored immediately** (nothing lost even offline / on misread); multiple sets & superset flow supported; units default to **kg**.

**Adding a set (explicit affordance).** Each exercise on the live workout screen shows a clear **«＋ Подход»** button that opens a *Новый подход* sheet with two ways to log: **🎙️ «Сказать голосом»** (opens the voice/text assistant, pre-scoped to that exercise) or **manual entry** (weight × reps × RIR fields). The central **«Пояснить»** tab (opens in your last-used mode — voice or text) and free speech ("сто на шесть, один в запасе") remain equivalent ways to add a set. A separate **«↻»** control on the exercise opens the replace flow (§5.4).

### 5.3 Exercise recognition + in-workout exercise screen
- As soon as an exercise is recognized, its **previous results** (weight, reps, RIR, comment, date & time — most recent first) are surfaced so you know what to beat.
- **In-workout current-exercise screen.** During an active session, tapping an exercise opens its own view with: (a) **sets logged today** in this session, (b) **previous results** (past sessions), (c) **technique video** — the **main clip is embedded** (inline 16:9 player; tap ▶ to watch in-app) with an **"open on YouTube"** link, and alternative videos as list links — plus **＋ Подход** and **↻ Replace** actions and a **‹ back to workout** control. This is the in-session detail — distinct from the standalone all-history screen (§5.12) and the catalog card (§5.6).

### 5.4 Editable current workout & replace flow
- Freely **add, remove, replace, reorder** exercises and re-pair supersets during the session — by voice or tap.
- **Replace ("Заменить")** opens a sheet of **alternatives for the same muscle group**, plus search and a link to the full catalog. Choosing one swaps it in place.

### 5.5 Suggested workout on start
- Built from the current superset scheme (§3.2, **synergist-avoiding**) + lagging-group-first ordering + recent sessions (rotation) + known equipment preferences. Always a starting point, never a lock.

### 5.6 Exercise catalog
A catalog of exercises, each with:
- **Names in Russian and English** + aliases/colloquial variants (help voice matching, e.g., "бабочка" → pec fly).
- **Mighty / Normal / Cringe** tag.
- **Primary & secondary muscle groups** from the §3.1 taxonomy (drives suggestions and superset validity).
- **Equipment** (barbell, dumbbell, machine, cable, bodyweight, …).
- **Technique video links (YouTube)**, including **alternatives**.
- Optional cues/notes.

Filterable by muscle group and tag; searchable RU/EN. A **shared global catalog** (superadmin-maintained) plus **per-user custom exercises**. Reachable via the **Каталог** tab and from "+ Exercise" / "Replace" in a workout.

### 5.7 Body measurements (inside Progress)
Tracked over time; surfaced within the **Прогресс** tab. Measurement set (from the owner's existing sheet):

| Measurement | How it's measured |
| --- | --- |
| **Height** | Standing height. |
| **Weight** | Bodyweight (kg). |
| **Neck** | Narrowest point, below the Adam's apple. |
| **Chest** | At the armpits, relaxed, arms hanging relaxed. |
| **Biceps** | Forearm bent at 90°, widest point, biceps **not** flexed. |
| **Thigh (Left / Right)** | Standing, relaxed, tape at mid-thigh; recorded per leg (L / R). |
| **Calf** | Standing, relaxed, largest point. |
| **Belly / Waist** | Widest point below the navel. |
| **Body fat %** | Entered explicitly or estimated with RFM from height and waist after the athlete selects the formula variant; the source remains visible. |

- **Trend sparklines** per key measurement in Progress; **"Вся история замеров"** opens the full dated list; tapping a date opens a **detail** with all values and **deltas vs the previous entry**.
- Per-entry **"self-measured" flag** (the sheet marks some columns *самозамер*).
- Body-fat values always show whether they were **entered manually** or **calculated as an estimate**.
- **"+ Замер"** adds a new measurement session.
- **Importable** historical data so the timeline is continuous (existing dates: 23.03.2025, 13.06.2025, 06.08.2025, 11.09.2025, 22.01.2026).

### 5.8 Progress (calendar + strength + body)
The **Прогресс** tab, top→bottom:
1. **Workout calendar** — days trained, streaks, frequency (shown first).
2. **Strength by group** — a selector of muscle groups / exercises; the **estimated-1RM** chart (§5.10) rebuilds for the chosen one; shows the personal record.
3. **Body** — measurement trends + full history (§5.7).

Everything links back to the underlying session/set data.

### 5.9 Motivation & reminders
- Warm, **encouraging tone** — praise for showing up, celebrating PRs and streaks; **never** scolding a missed day.
- **Workout nudges** ("Ready when you are 💪").
- **Quarterly measurement reminder** (~every 3 months).
- Milestone celebrations (PRs, streaks, "epic" lifts).
- Delivered via **Web Push** to the installed home-screen PWA (iOS 16.4+), with in-app banners as fallback.

### 5.10 Strength progress: estimated 1RM
- Strength chart uses **estimated one-rep max (1RM)** so sessions with different weights/reps compare on one number.
- **Formula: Epley** — `1RM = weight × (1 + reps / 30)`.
- **RIR-aware:** reps-to-failure = `reps + RIR` feeds the formula (more honest than trackers that ignore RIR). E.g., 80 kg × 8 @ RIR 2 → uses 10 reps → ≈ 107 kg.

### 5.11 Roles, sharing & admin (multi-user)
Three roles, enforced server-side.

**Athlete (default)** — logs own workouts/measurements; sees own progress, calendar, history. May be linked to **one active trainer** (reassignable). Data private to the athlete, their trainer, and the superadmin.

**Trainer** — sees a roster of linked **athletes**; **read-only view** of each athlete's workouts, progress, measurements *(no notes/programming for now)*; **sends invites** (link/email); is also an athlete for their own training.

**Superadmin (owner, R)** — **sees everything directly**; creates/changes/removes **trainer↔athlete links**; manages the **global catalog**; has all lower capabilities *(no "view-as" impersonation)*.

**Invites & linking** — trainer generates an invite; invitee signs in with Google and is **linked to that trainer**; superadmin can also create/reassign. **Audit logging minimal/optional.**

Consoles: a **Superadmin console** (users, links, global catalog) and a **Trainer console** (roster, invites, athlete detail). **Настройки** replaces the old "Profile" for the athlete (account, language, units, reminders, trainer link).

### 5.12 Workout history
- **All past workouts** as a dated list (muscle summary + volume per session).
- Tap any to open a **workout detail**: every superset, exercise, and set (**sets shown inline**, e.g. `65×10 RIR2 · 65×9 RIR1`), comments, duration — fitting one screen.
- Reachable from the Тренировка home ("Все ›") and referenced from Progress.

---

## 6. Data model (conceptual)

- **User:** id, google_id, email, name, avatar, role (superadmin | trainer | athlete), locale, created_at.
- **TrainerAthleteLink:** id, trainer_id, athlete_id, status (active | pending), created_at. (One active trainer per athlete.)
- **Invite:** id, trainer_id, email (optional), token, status, expires_at.
- **Exercise (catalog):** id, scope (global | user), owner_id (if user), name_ru, name_en, aliases[], tag (mighty | normal | cringe), primary_muscles[], secondary_muscles[] (from the §3.1 taxonomy), equipment, video_links[], notes.
- **Workout (session):** id, **user_id**, date, start_time, end_time, notes; performed exercises with superset grouping/order.
- **Set:** id, workout_id, exercise_id, superset_group, order, weight, reps, rir, comment, timestamp.
- **VoiceEntry (raw):** id, workout_id, audio_ref (retained long-term), transcript, parsed_result, status (confirmed | pending | failed), timestamp.
- **MeasurementEntry:** id, **user_id**, date, is_self_measured, values (height, weight, neck, chest, biceps, thigh_left, thigh_right, calf, waist).
- **SchemeConfig:** per-user active superset scheme + ordering logic, encoding the **synergist-avoidance** rule (§3.2) so suggestions never pair overlapping groups.

Every record carries timestamps, a `user_id` owner where applicable, and a sync state. Access is always checked against the requester's role and links.

---

## 7. Non-functional requirements

- **Data durability (top priority).** Confirmed data persisted locally *immediately*; background sync queue with retries. Raw audio + transcript saved before parsing and **retained long-term**. Reload / offline / crash never lose data; conflicts favor "never drop a user-entered value."
- **Offline capability.** Logging (tap), viewing, and voice *capture* work offline; voice *understanding* processed on reconnect (§4a).
- **Multi-tenant isolation.** Server-side permission checks on every request; trainers see only linked athletes (read-only); superadmin sees all.
- **Performance.** Live workout feels instant; voice round-trip (upload → transcribe + understand → confirm) targeted at a few seconds.
- **PWA / iOS.** Add-to-Home-Screen, full-screen standalone, offline via service worker, Web Push.
- **Responsive.** One mobile-first codebase that also lays out cleanly on desktop.
- **Internationalization.** All UI strings externalized; ships EN + RU; new locale = new file; toggle in **Настройки** only. Catalog bilingual+ from day one.
- **Privacy note.** With cloud transcription, **both audio and text are sent to the AI provider(s) via OpenRouter**; accepted for cost/reliability, behind a swappable abstraction. Documented so it's never a surprise.
- **Gym usability & accessibility.** Large tap targets, high-contrast, readable at arm's length, one-thumb operation.

---

## 8. Proposed architecture & tech stack

**Self-hosted app on a small VPS**, **cloud transcription + understanding via OpenRouter**, **multi-user with Google auth**, **full i18n**, **never-lose-data**.

### 8.1 Shape
A **local-first client–server** app. The client is the source of truth for the live session and writes confirmed values locally first; the server is the durable store, sync hub, and permission authority. AI (speech → text → structured meaning) is a cloud service the server calls.

### 8.2 Frontend
- **React + TypeScript + Vite**, **Tailwind CSS**; dark energetic theme.
- **PWA** (service worker via `vite-plugin-pwa` / Workbox) for installability, offline, Web Push.
- **Local-first storage** with **IndexedDB** (**Dexie.js**) + background **sync queue** (optimistic UI, retry). Captured audio buffered here when offline.
- **i18n** via `i18next` / `react-i18next`.

### 8.3 Backend
- **Node.js + TypeScript** API (Fastify or Express).
- **SQLite** now, via a **migration-friendly data layer (Drizzle ORM)** so a later move to **PostgreSQL** is low-friction. Automated DB-file backups (e.g., Litestream).
- **Auth:** **Google OAuth / OpenID Connect**; server-issued session tokens; **RBAC** on every endpoint.
- **AI provider client** (see §8.4) behind a swappable interface.
- **Docker Compose** (API + reverse proxy). No GPU / no Whisper container needed.

### 8.4 Voice pipeline (cloud, via OpenRouter)
1. **Capture** audio in-browser (works on iOS); store locally immediately.
2. **Transcribe + understand** via **OpenRouter**. Preferred: an **audio-capable multimodal model** (e.g., Gemini Flash-class) returning transcript + structured action in one call. Fallback: a **dedicated cloud STT** (Whisper via OpenAI/Groq) → OpenRouter text model. Both behind one **provider abstraction** (swappable, later local-capable).
3. **Recall + confirm + commit.** Show previous results, read back interpretation, save to IndexedDB on confirm, then sync.

**Model choice:** cheap/fast/multilingual default + fallback, finalized at build time. A few $/month even with daily use.

### 8.5 Hosting (ps.kz — user wrote "1ps.kz")
- Transcription is cloud, so the VPS only runs API + SQLite + static PWA + reverse proxy — very light.
- **Recommended: a small/entry VPS**, ~**3,600–7,050 KZT/mo (~$8–15)** (e.g., Basic-1/Basic-2 tier; confirm specs in their configurator). ~1–2 vCPU / 1–2 GB RAM / ~20–40 GB SSD.
- No GPU. Scale VPS and/or migrate SQLite → PostgreSQL if usage grows.
- *(Reference: PS Cloud VPS tariffs eff. Oct 2025 — Basic-1 3,600 / Basic-2 7,050 / Basic-3 13,950 / Basic-4 27,750 / Basic-5 41,550 KZT/mo. Exchange ≈ 472 KZT/$.)*

---

## 9. Voice interaction flow (detail)
1. Tap the central **«Пояснить»** (or a per-exercise **＋ Подход**) to start; it opens in your last-used mode (voice or text).
2. **Capture & store raw:** record audio; save locally immediately — nothing lost, even offline.
3. **Send to cloud (OpenRouter):** transcribe + understand → intent + data, exercise mapped to catalog. (Deferred until reconnect if offline.)
4. **Recall:** the recognized exercise's previous results appear.
5. **Confirm:** app reads back / shows its interpretation; confirm or correct (voice or tap).
6. **Commit:** written to IndexedDB, queued for sync. Repeat; swap exercises freely.

---

## 10. Resolved decisions & remaining build-time details

**Resolved:** IA/tabs (§5.0); body under Progress; synergist-avoiding supersets (§3.2); split muscle taxonomy (§3.1); central «Пояснить» voice/text entry (remembers last mode); Settings (was Profile); dark theme; cloud AI via OpenRouter; small VPS; one trainer per athlete; audio retained; superadmin sees all.

**To finalize during build (not blocking):**
1. Exact OpenRouter model(s) — primary + fallback — and audio-in multimodal vs dedicated STT + text.
2. Audio storage location on the VPS (local disk vs object storage) and a graceful full-disk policy — low priority (tiny clips).
3. Whether the trainer role later gains notes / programming (deferred).

---

## 11. Glossary
- **RIR — Reps In Reserve.** Reps you could still have done before failure. RIR 0 = to failure.
- **1RM / estimated 1RM.** One-rep max; estimated from a normal set to track strength on one number.
- **Epley formula.** `1RM = weight × (1 + reps/30)`; fed reps-to-failure = reps + RIR.
- **Superset.** Two exercises back-to-back with little rest.
- **Synergist.** A muscle that assists a primary lift (triceps/front-delt in presses; biceps/rear-delt in pulls). Supersets avoid pairing a muscle with a lift that already uses it (§3.2).
- **Delts (front / middle / rear).** The three heads of the shoulder, tracked separately.
- **Quadriceps / Hamstrings.** Front and back of the thigh, tracked separately.
- **Full-body.** A session training all major muscle groups.
- **PWA — Progressive Web App.** Installable, offline-capable website.
- **PR — Personal Record.**
- **RBAC — Role-Based Access Control.**
- **OpenRouter.** A gateway to many AI models via one API; used here for transcription + understanding.
- **STT — Speech-to-Text.**
- **Mighty / Normal / Cringe.** The playful three-way exercise tagging (Эпичные / Обычные / Унизительные). See §1.

---

*Next step: continue refining the interactive mockups (`MightyCringe_Mockups_v0.2.4.html`), then implement in Claude Code from this Overview + the mockups.*
