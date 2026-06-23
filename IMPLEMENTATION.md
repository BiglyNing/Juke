# Juke — Implementation Phases

A phased build plan for Juke, a webcam-game arcade (flagship: **Hole-in-the-Wall**, plus **Hand Simon-Says** and **Dodge**).

## Guiding principle

**Build the risky, foundational, and testable parts first; defer game logic and polish.**

The single biggest unknown in this project is *"does in-browser webcam perception actually run well enough on a normal laptop?"* — not *"is the wall fun?"*. So we prove the perception pipeline and build a **debug/test harness** before writing a line of real gameplay. Every phase ends with a concrete **exit criteria** you can verify by looking at the screen, so you never build on an unproven layer.

Ordering rules:
1. **De-risk before you invest.** Anything that could force a redesign (perception, performance, collision feasibility) comes first.
2. **Tooling before content.** The debug overlay and tuning sliders exist before the first game, so every later phase is measurable.
3. **One vertical slice before breadth.** Get *one* crude-but-complete game loop working end-to-end before adding juice, more games, or backend.
4. **Hedge the submission risk early.** This is an *online* hackathon: a low-friction, seated mode and a shareable demo artifact are load-bearing, not polish — so they come **before** the third game and the final coat of paint, not after.
5. **Polish last.** Particles, mascot, share cards, and the third game only after the core is proven and tunable.

Legend for each phase: **Goal** · **Why here** · **Tasks** · **Exit criteria** (how you verify) · **Risks**.

> **Note on ordering (changed from the first draft):** the seated **Hand Simon-Says** moved from last to right after the shell, and **Dodge** moved to second-to-last. Rationale: for an online reviewer who won't stand up, the seated mode is the one they're most likely to actually try, so it must be de-risked and shippable *early*. If time runs out, we cut the third game (Dodge), never the low-friction second mode or the demo artifact. See the dependency summary at the bottom.

---

## Build status (living)

Phases are checked off as their exit criteria are met. **P0–P6 are in and verified** (production build + 34 unit tests green); the live-webcam parts of each exit criterion are validated by hand, not in CI.

| Phase | Status | Notes |
| --- | --- | --- |
| P0 — skeleton & dev loop | ✅ done | Vanilla TS + Vite, GitHub Pages deploy wired |
| P1 — perception foundation | ✅ done | Pose Landmarker + segmentation mask; live FPS/inference readout |
| P2 — debug harness & utilities | ✅ done | Overlay + sliders, tested mask/pose math, fixture record + headless replay |
| P3 — engine contract & loop | ✅ done | `JukeGame` + registry + fixed-timestep loop + `Producer` seam |
| P4 — minimal Hole-in-the-Wall | ✅ done | Profile-fitted walls, `maskOverlap` judging, leniency dials |
| P5 — game shell | ✅ done | CRT-vaporwave design system, menu, calibration, countdown, HUD, game-over, model-load screen |
| P6 — Hand Simon-Says | ✅ done | Seated gesture game on the Gesture Recognizer |
| P7 — juice layer | ⬜ next | Audio + crush-moment stack + GIF capture path |
| P8 — share card & leaderboard | ⬜ | Client-side, no backend |
| P9 — submission artifacts | ⬜ | README GIF, demo video, attract mode |
| P10 — Dodge (3rd mode) | ⬜ | Cuttable |
| P11 — visual identity & ship | ⬜ | Art-direction pass, mascot, refreshed artifact |

**Contract evolution so far (vs the Phase 3 sketch).** The seam held: two games and a whole shell were added with only two small, deliberate extensions —
- **P5** added `JukeGame.configure?(CalibrationResult)` (the shell hands a game its calibration output at the moment play begins) and `Engine.clearActiveGame()`.
- **P6** added `PerceptionFrame.gestures` (the Gesture Recognizer's top built-in label per hand) so Simon-Says can match by label. Everything else about the second game was *one new file + registration*, exactly as the contract intended.

See **Appendix — Architecture as built** for the realized layering and the "add a new game" checklist.

---

## Phase 0 — Project skeleton & dev loop

**Goal:** A running dev environment that serves a blank page over HTTPS-capable localhost, deployable as a static site.

**Why here:** You can't test anything without a build/serve loop. Webcam (`getUserMedia`) requires a secure context, so the dev server must work on `localhost` (which is exempt from the HTTPS requirement).

**Tasks:**
- `npm create vite@latest` → TypeScript template. No framework (vanilla TS).
- Establish folder layout (`src/engine`, `src/juice`, `src/shell`, `src/games`, `src/render`).
- Add a single full-window `<canvas>` and a basic render loop stub (`requestAnimationFrame`).
- Configure static deploy target — **decided: GitHub Pages** (free, no extra accounts, fits the Hack Club GitHub flow; deploy via a GitHub Action on push). Wire it now so deploy is never a late surprise. Confirm one deploy of the blank page succeeds. Note: Vite needs `base` set to the repo name for Pages (`base: '/Juke/'`) so asset paths resolve. Note: GitHub Pages must be enabled with **Source: GitHub Actions** in repo settings, and the repo public (or Pages enabled for private), or the deploy step 404s.
- `.gitignore`, basic `README`.

**Exit criteria:**
- `npm run dev` serves a page at `localhost` with a visible canvas clearing each frame.
- The blank page is live on the chosen static host over HTTPS.

**Risks:** Low. Don't over-engineer config; this phase should be ~30 min.

---

## Phase 1 — Perception foundation (HIGHEST RISK FIRST)

**Goal:** Webcam feed + MediaPipe running, with the **segmentation mask** and **pose landmarks** visibly drawn on screen.

**Why here:** This is the project's central technical bet. If MediaPipe segmentation is too slow, too jittery, or unavailable on the target laptop, *the whole design changes*. Prove it before anything depends on it. Everything downstream consumes this layer.

**Tasks:**
- Request the camera with `getUserMedia`, draw the video to canvas.
- Load **MediaPipe Pose Landmarker** (Tasks Vision) with `outputSegmentationMasks: true`, GPU delegate.
- Per frame: draw the raw silhouette mask (e.g. as a colored overlay) and draw the 33 pose landmarks as dots + skeleton lines.
- Handle the obvious failure states: no camera permission, no camera present, model load failure — show a clear message, don't crash.
- Show live **FPS + inference-time** in a corner from the very first frame (it becomes the budget readout the rest of the project tunes against).

**Performance budget (set the number now, not by vibes):** target **inference < 33 ms** and **total frame < ~16 ms of non-inference work** on the *actual target laptop*. Treat **inference ≤ ~33 ms (≈30 fps end to end)** as the floor of "acceptable"; below that, act in Phase 1 — don't build on it. First dials if you miss: WebGPU delegate, lower camera resolution (640×480 → 320×240), `lite` model.

**Exit criteria:**
- You can see your own silhouette mask and skeleton tracking your movement in real time.
- It meets the budget above on the **actual target laptop** (not just your dev machine) — read it off the live counter, not by eye.
- Denying camera permission shows a graceful message.

**Risks:** High — this is the de-risking phase. If perf is bad, try the WebGPU delegate, lower the camera resolution, or reduce model complexity *now*, before building on it.

---

## Phase 2 — Debug/test harness & perception utilities

**Goal:** A developer overlay and a set of tested utility functions that make every later phase measurable. **This is the "testing features first" phase.**

**Why here:** Before any gameplay, you want instruments. You'll be tuning resolution, leniency thresholds, and smoothing constantly — you need numbers on screen, not guesses. Building this now pays off in every subsequent phase.

**Tasks:**
- **Debug overlay** (toggle with a key), showing live:
  - FPS / frame time, and perception inference time. **Flash the readout red when it breaches the Phase 1 budget** — so a perf regression announces itself the moment it appears, not three phases later under a pile of particles.
  - The downsampled collision mask, rendered as a visible grid.
  - Landmark visibility scores.
  - Any current "overlap ratio" once collision exists.
- **Tuning sliders** (dat.GUI or plain DOM): mask resolution, EMA smoothing factor, erosion amount, leniency threshold `TOL`. Wire them to live variables.
- **Perception utilities** (`engine/mask.ts`, `engine/pose.ts`):
  - `downsample(mask, w, h)` → low-res `Uint8Array`.
  - `smoothEMA(prev, next, alpha)` → temporal smoothing.
  - `erode(mask, px)` → shrink for edge tolerance.
  - `maskOverlap(a, b)` → `{ hit, ratio }`.
  - `limbAngle(a, b)`, `jointAngle(a, b, c)`, `fingerStates(hand)`.
- **Perception fixture + headless replay** (cheap insurance on the riskiest layer): add a dev key that records ~2–3 s of live `PerceptionFrame`s (mask + landmarks + dt) to a JSON fixture, and a tiny harness that replays a saved fixture through the pipeline **without a webcam**. This lets you refactor the engine (Phase 3+) and verify collision/scoring changes *deterministically* — no standing up to re-check that nothing broke.
- Lightweight unit tests for the pure math functions (`maskOverlap`, angles) — these are deterministic and worth pinning down. Run them against the recorded fixture too, so the test suite exercises real perception shapes, not just synthetic inputs.

**Exit criteria:**
- Pressing the debug key shows FPS + the downsampled mask grid overlaid on the video, and the FPS readout turns red when you force the frame over budget.
- Moving a slider visibly changes the mask resolution / smoothing in real time.
- `maskOverlap` and the angle helpers pass their unit tests.
- A recorded fixture replays through the pipeline headless and produces the same overlap numbers on every run.

**Risks:** Low, but resist the urge to skip this — it's the difference between tuning by measurement and tuning by vibes. The fixture/replay is the one piece people skip and regret the first time perception silently regresses.

---

## Phase 3 — Engine core: the game contract & loop

**Goal:** The `JukeGame` interface, a registry, and a loop that drives whichever game is active using a normalized `PerceptionFrame`.

**Why here:** This is the seam that lets all three games share one engine and lets you build/cut games independently. It must exist before the first game so the first game is written *to the contract*, not around it.

**Tasks:**
- Define `PerceptionFrame` (`silhouetteMask`, `maskW/H`, `pose`, `hands`, `video`, `dt`). This is the same shape the Phase 2 fixture records/replays.
- Define `JukeGame` (`id`, `title`, `needs`, `intensity`, `init`, `update`, `render`, `score`, `isOver`, `reset`).
- Build the perception layer into a producer that emits one `PerceptionFrame` per tick (lazy-loading hand model only when a game `needs` it).
- Fixed-timestep update + render loop; a simple "active game" slot.
- A `registry` and `register()`.

**Exit criteria:**
- A trivial throwaway "test game" (e.g. draws the mask and prints `dt`) implements `JukeGame`, is registered, and runs through the loop.
- Swapping the active game is a one-line change.
- The loop can be driven by a replayed fixture instead of a live camera (reuses Phase 2).

**Risks:** Medium — getting the contract right matters. Keep it minimal; add fields only when a real game needs them.

---

## Phase 4 — Vertical slice: minimal Hole-in-the-Wall (no polish)

**Goal:** One complete, ugly, *playable* loop: a wall with a gap approaches, your silhouette is judged against it, you pass or fail, score increments.

**Why here:** This is the first moment the core idea is *proven fun (or not)*. Deliberately crude — flat rectangles, no particles — so you learn whether the mechanic and the leniency model feel right before investing in polish. Uses the harness from Phase 2 to tune live.

**Tasks:**
- Generate a wall: solid rectangle minus a gap (start with a simple shape — a centered rectangle gap, then arm-raise shapes).
- Animate it approaching the player plane (scale up for fake depth).
- At the crossing window, run `maskOverlap` (low-res, eroded, best-frame-over-window) and compare `ratio` to `TOL`.
- Pass → score++ and spawn next wall. Fail → game over screen (just text).
- Show live overlap ratio via the debug overlay while tuning.
- **Crude framing gate (pulled forward from calibration):** a one-line "are all four limbs visible above a visibility threshold?" check, shown as a corner indicator. You don't need the full calibration UI yet — but you *do* need to tune leniency under realistic framing (whole body in frame, not you sitting close), or your defaults will be wrong. This is the seed of the Phase 5 calibration.
- Find usable default values for **resolution**, **erosion**, **TOL**, and **crossing window** using the sliders.

**Exit criteria:**
- You can physically pass several walls in a row and see the score climb.
- Failing (not fitting) ends the run.
- You've recorded sensible default leniency values that feel fair on the target laptop, tuned with your whole body in frame.

**Risks:** Medium — this is where "is it actually fun / fair?" gets answered. Budget time to tune, not just build.

---

## Phase 5 — Game shell: menu, calibration, lifecycle

**Goal:** The wrapper around games — an arcade menu, a calibration step, a HUD, clean state transitions, and a model-load screen that doesn't look broken.

**Why here:** Once one game works, you need the frame that holds games. Calibration in particular is a *real-world reliability* feature (the laptop judge being too close / poorly lit is a top failure mode), so it ranks above polish. The shell also has to exist before the second game (Phase 6) can appear in a menu.

**Tasks:**
- **Arcade menu**: cards auto-built from the registry; selecting one starts it.
- **Calibration** adapts to `intensity`: standing → "step back until your feet show, plain background, face the light," with a live silhouette preview and a green check when all four limbs are visible (gate on landmark visibility — promote the Phase 4 crude gate into this). Seated → "show your hand."
- **HUD**: score, combo, the crack/health meter.
- **State machine**: Menu → Calibration → Countdown → Play → GameOver → (Retry / Menu).
- **Model-load screen with personality (required, not polish):** the 2–3 s MediaPipe load is the worst first impression in the whole app — a stranger sees a frozen page. Cover it with a branded loading state (rotating tips / animated logo). This is load-bearing for online judging, so it lives in the shell, not the polish backlog.
- **Visual-identity foundation (set the look once, here):** before building the menu/HUD/calibration screens, commit to a small design system — type scale + a real display/web font, an owned color palette (move off the default cyan-on-black), spacing rhythm, one button/card component style, and shared motion tokens (easing + durations). Everything built after inherits it, so the "obviously vibe-coded" look never accretes in the first place. This is *foundation*, not polish — the heavy art-direction pass is still P11. See **Appendix — Visual identity & web-craft**.

**Exit criteria:**
- From a cold load you can: open the menu, pick Hole-in-the-Wall, pass calibration, play, die, and return to the menu — without a reload.
- Calibration refuses to start until the body is properly framed.
- The model load never shows a dead/frozen screen — there's always something moving.
- The shell uses the design tokens (font, palette, button/card, easing) — not framework/browser defaults.

**Risks:** Low–medium. Keep the state machine simple and explicit.

---

## Phase 6 — Game #2: Hand Simon-Says (the low-friction mode)

**Goal:** The seated, laptop-friendly hand-mimic game — a complete second mode, reusing the entire engine and shell.

**Why here (moved up from last):** This is the **lowest-friction mode for an online reviewer** — no standing, no clearing space, just a hand at the laptop. For a peer-voted online gallery it may be the only mode a judge actually tries, so it must be a *complete, shippable second mode early*, not a stretch goal at the end. It also introduces the **hand** perception path; by now the body pipeline is fully proven (Phases 1–4), so taking on the hand-model integration risk here — with plenty of runway left — is exactly right.

**Tasks:**
- Lazy-load **MediaPipe Gesture Recognizer** (triggered by `needs: ['hands']` — the contract already supports this).
- **Easy tier only for now:** targets are the ~7 built-in gesture labels; match by label. Get the full loop working on this before anything fancier.
- Loop: flash target sign → short timer → score match → streak combos → tempo ramps.
- Reuse the shell (menu card, calibration's seated branch, HUD, state machine).
- Confirm the hand model loads **only** when this game is selected — the body games must never pay for it.

**Exit criteria:**
- Hand Simon-Says appears in the arcade menu and plays a full loop using the built-in gestures, seated, with no standing calibration — added with **no engine changes**, only a new game file (plus registration). If it forces an engine change, note it: that's feedback on the Phase 3 contract.
- The hand model loads only when this game is selected (verify the body games never pay for it).

**Risks:** Low–medium. Keep to the easy tier for the first working version; the rich tier (arbitrary poses via landmark comparison) is an explicit stretch deferred to the final polish phase. Watch hand-model load time against the Phase 1 budget.

---

## Phase 7 — Juice layer (the north star)

**Goal:** Make it *feel* like a real game — the project's #1 quality bar — across **both** existing modes.

**Why here:** Polish only pays off once the mechanic underneath is proven (Phase 4) and framed (Phase 5), and once you have the two modes it decorates (Phase 6). Doing it earlier means polishing something you might redesign.

**Tasks:**
- Reusable juice services (`juice/`): `particles.burst()`, `camera.shake(mag)`, `time.freeze(ms)`, `time.slowmo(scale, ms)`, `fx.flash(color)`, chromatic aberration.
- **Audio subsystem (`juice/audio.ts`)** — Web Audio API:
  - **Background music**: looping track that starts on the menu and carries into gameplay. Optionally layer/ramp it with difficulty (raise tempo or add a layer as speed climbs) so the music tracks tension.
  - **SFX** wired to the same events as the visual juice: clean-pass *whoosh*, near-miss *crack*, crush *thud*, UI clicks, countdown beeps, new-high-score sting.
  - **"Duck on death"**: music briefly dips/filters when you're crushed so the freeze-frame lands.
  - A **mute toggle** + respect autoplay rules (audio context must start on a user gesture — kick it off from the first menu click/play press).
  - Source free, license-clear assets (e.g. CC0 from freesound / opengameart) — keep files small.
- Silhouette rendering upgrade (`render/silhouette.ts`): neon outline + soft fill + trailing afterimage on fast motion.
- Wire feedback into Hole-in-the-Wall: proximity heat (overlap pixels glow orange→red as the wall nears), clean-pass shockwave + brief slow-mo, **freeze-frame on crush**, near-miss screen shake.
- Soft-fail crack meter (overlap drains health) replacing instant death where desired.
- **Build the GIF/clip capture path here** (not at the end): a ring buffer of the last ~2 s of canvas frames you can dump to a GIF/WebM on game-over. You already need the freeze-frame, so the capture mechanism falls out of this work — and it's the raw material for the Phase 9 submission artifacts. Don't leave it as an end-of-project scramble.

**Exit criteria:**
- A clean pass and a crush both produce distinct, satisfying **audio + visual** feedback.
- Background music plays from the menu through gameplay, and a mute toggle works.
- The silhouette looks polished (glow + trail) on the menu and in-game.
- You can trigger a capture and get a short clip/GIF of the last couple of seconds out of the app.
- Particle/effect counts are capped so weak laptops stay smooth (verify FPS via the overlay — it should never flash red).

**Risks:** Medium — easy to overspend here. Cap effort; juice is high-leverage but has diminishing returns.

---

## Phase 8 — Result/share card & local leaderboard

**Goal:** The shareability + retention layer for the death moment, all client-side (no backend).

**Why here:** These depend on a complete play loop and a death moment (freeze-frame from Phase 7). They're high-value for a hackathon submission but not load-bearing, so they come after the core feels good — and they feed the Phase 9 artifacts.

**Tasks:**
- **Share card** (`shell/shareCard.ts`): render the freeze-frame to a canvas — desaturated background, glowing silhouette, score + shape name + caption. Download as PNG / copy to clipboard.
- **Leaderboard** (`shell/leaderboard.ts`): localStorage daily-best + all-time best, persisted across reloads.
- **Daily challenge (demoted to optional/stretch)** (`shell/dailySeed.ts`): seed RNG from `YYYY-MM-DD` so the wall sequence is identical for everyone that day. Pure local. *Note:* this only pays off with a shared/social loop (a global board, friends comparing runs). For a peer-voted gallery where each reviewer plays once, it's near-invisible — keep it behind the share card and local best, and skip it under time pressure.

**Exit criteria:**
- Dying produces a downloadable PNG result card.
- Your best score persists across reloads.
- *(If the optional daily is built)* replaying the daily gives the same wall sequence; a new date gives a new one.

**Risks:** Low. The optional global leaderboard is the only thing that touches a network; keep it optional and behind the local version.

---

## Phase 9 — Submission artifacts: README, demo video/GIF, attract mode

**Goal:** Lock in a *submittable* package — the artifacts an online reviewer sees **before or instead of** the live app — so you always have a strong submission on hand, not a last-minute scramble.

**Why here:** For an *online* hackathon (Hack Club Horizons), the demo video, README, and a scroll-stopping GIF are first-class deliverables — often the *only* thing a peer voter sees. By now you have two polished modes (one seated/low-friction), a juiced death moment, a share card, and the capture path from Phase 7. That's enough to produce a great artifact. Doing it *now* (not in the final polish phase you're most likely to compress) means the submission is safe even if you cut Dodge.

**Tasks:**
- **Demo GIF/clip** (15–30 s): a great run + the crush moment, plus a few seconds of the seated Hand Simon-Says so a non-stander sees something playable. Built from the Phase 7 capture path.
- **README**: an embedded GIF and a one-line hook *above the fold*, the live HTTPS link, and a setup tip ("stand back ~6 ft, face a window"). This is the front door of the submission.
- **In-app attract / idle loop** on the menu: a looping silhouette demo or auto-playing ghost so the very first frame of the live link is already moving — never a dead title card for someone who won't stand up.
- **Smoke-test the live link on a fresh browser/machine** you've never granted camera on — first-try success on a stranger's machine *is* the submission for online judging.

**Exit criteria:**
- The README renders with a moving GIF and a working live link above the fold.
- The menu is never a static screen — attract mode is always moving.
- The deployed link works first-try on a machine that has never seen it.

> **Standing discipline:** treat this as the point where you *always have a shippable submission*. Refresh the GIF/video at ship (Phase 11) after Dodge and final polish — but never let the project sit without a current artifact again.

**Risks:** Low — but the failure mode is *running out of time and having no artifact*, which this phase exists to prevent.

---

## Phase 10 — Game #3: Dodge the Objects

**Goal:** The third game, reusing the entire engine — variety, if time allows.

**Why here (moved down from #2):** It's the most cuttable item with the lowest marginal value — a third body-mode that asks the reviewer to stand up, when you already have a standing mode and a seated one. It's cheap *because* the earlier phases did the shared work, so it's a great use of leftover time — but it comes *after* the submission is locked (Phase 9) so it's never load-bearing.

**Tasks:**
- New `JukeGame` in `games/dodge.ts`: objects fly in (2–3 types), `maskOverlap` against object pixels = hit.
- Difficulty curve via spawn rate + speed.
- Reuse juice (trails, shatter on near-miss, hit flash) and the shell/share/leaderboard systems.

**Exit criteria:**
- Dodge appears in the arcade menu and plays a full loop (calibration → play → death → share) with **no engine changes** — only a new game file (plus registration).

**Risks:** Low. If anything here forces engine changes, note it — it's feedback on the contract. If time is short, **cut it** — the submission is already complete.

---

## Phase 11 — Visual identity, web-craft polish & ship

**Goal:** Make the whole site look *intentionally designed* — not vibe-coded — then a refreshed demo artifact and a confident public deploy.

**Why here:** The mechanic, modes, and juice are proven; now is when investing in art direction pays off instead of getting redesigned. This is the dedicated pass that turns "a webcam demo that works" into "a product someone built on purpose." It builds on the visual-identity *foundation* set in P5 and pushes it to a finished, cohesive look.

**Tasks:**
- **Visual-identity / web-craft pass (the headline of this phase):** walk **Appendix — Visual identity & web-craft** top to bottom and fix every tell of a generic AI-generated site — real type, an owned palette, a proper **Juke** wordmark, intentional layout/composition (not everything dead-center), custom components, texture/depth, real icons instead of emoji, favicon + social/OG preview. Aim for a screenshot that reads as "designed."
- **Mascot**: fill the reserved layout slot — a simple 2-frame character that reacts (cheers on pass, winces on crush). First thing to cut without regret.
- Visual cohesion pass: one consistent identity across menu, games, cards, share image, loading, and error states.
- First-run UX: a quick "how to play" and the camera-permission ask framed nicely.
- Cross-laptop sanity check (different webcam, lighting, lower-end machine) — confirm the FPS readout never flashes red on the low end.
- **Refresh the Phase 9 GIF/video** now that all modes + mascot + the visual pass are in.
- *(Stretch, if everything else is done)* the rich Hand Simon-Says tier: arbitrary poses via normalized landmark comparison (finger-states + in-plane rotation; never grade on palm-facing depth).
- Final deploy + verify the live HTTPS link works end-to-end on a fresh machine.

**Exit criteria:**
- A designer-minded stranger glancing at a screenshot would call it "designed," not "an AI demo" — the checklist in the visual-identity appendix is satisfied.
- A stranger can open the live link, grant camera access, understand what to do, and play all available games without help.
- The mascot reacts in at least one game.
- Runs acceptably (no red FPS) on a low-end laptop.
- The submission artifacts reflect the final build.

**Risks:** Low. Time-box polish; protect the "it works on a fresh machine" check above cosmetic extras. Note: the *cheap, high-signal* identity wins (web font, wordmark, palette, favicon, OG meta, easing) are low-risk — pull them forward whenever the current build's vibe-coded look bothers you; you don't have to wait for this phase.

---

## Dependency summary

```
P0 setup
  └─ P1 perception (HIGH RISK — prove first; set perf budget)
       └─ P2 debug harness + utilities + fixture replay (test tooling first)
            └─ P3 engine contract + loop
                 └─ P4 minimal Hole-in-the-Wall (vertical slice)
                      └─ P5 shell: menu / calibration / lifecycle / load screen
                           └─ P6 Hand Simon-Says (seated, low-friction 2nd mode)
                                └─ P7 juice (north star) + GIF-capture path
                                     └─ P8 share card / local leaderboard
                                          └─ P9 submission artifacts (README / GIF / attract) ← lock the submission
                                               ├─ P10 Dodge (3rd mode — cuttable)
                                               └─ P11 visual identity + web-craft polish + mascot + ship
```

## What is deliberately deferred and why

- **Game logic beyond the first slice** waits until perception + harness + contract are proven (P1–P3). Building games on an unproven pipeline risks throwing them away.
- **Polish/juice** waits until the mechanic is proven fun and fair (P4), framed (P5), and present in both modes (P6).
- **The third game (Dodge)** waits until *after* the submission is locked (P9) — it's the lowest-value, most-cuttable item, so it must never be on the critical path to a shippable submission.
- **Backend / global leaderboard** is optional and last — the design is fully playable and shareable with zero server, so a backend never blocks shipping.
- **The mascot, the daily challenge, and rich hand-grading** are explicitly stretch items, safe to cut without affecting the core.

---

## Appendix — Polish backlog (pull from this in P7 / P11)

A menu of cheap-but-loud polish, roughly ordered by **leverage ÷ effort**. None are load-bearing; cherry-pick. (Note: "no audio" in the original brief meant audio *input* — music and SFX *output* are in scope and high-value.)

**Audio (highest leverage for the effort)**
- Looping **background music** that ramps with difficulty (tempo/layers rise with speed).
- Event **SFX**: whoosh / crack / thud / UI clicks / countdown beeps / high-score sting.
- **Music ducking** on death so the freeze-frame hits.
- Optional: walls arrive *on the beat* — let the background pulse to the music for rhythm flavor (keep it cosmetic, not timing-critical, so it never fights the fit-timing).

**Visual / post-processing**
- **Bloom + vignette** for the neon-arcade glow.
- Subtle **CRT / scanline** filter for retro-arcade identity (toggleable; can hurt readability if heavy).
- **Difficulty-reactive world**: background color-shifts, speeds up, or intensifies as the run gets faster.
- **Parallax / reactive background grid** that pulses (to the beat or to events).
- Per-game **color grading** so each mode has its own identity.

**Feel / game-juice**
- **Everything eases** — no UI element snaps; menus and cards tween in/out.
- **Score count-up** + number-pop on the results screen; floating **"+1 / Perfect!"** popups during play.
- **Combo / streak callouts** ("3 clean passes!").
- **Anticipation countdown** (3-2-1 with a scale punch) before a run.
- **New-high-score celebration**: confetti burst + sting + card flair.

**Onboarding / shell**
- **Attract / idle mode** on the menu: a looping silhouette demo so the screen is never static. *(Promoted to a real task in P9 — it's load-bearing for online judging.)*
- **Loading screen with personality** (rotating tips while the model loads). *(Promoted to a required task in P5.)*
- Nicely framed **camera-permission prompt** ("Juke needs your camera to see you move").

**Shareability (beyond the static card)**
- **Replay GIF/clip capture** of the last few seconds before death — far more shareable than a static image. *(Capture path built in P7; surfaced in P9.)*
- **Themed result cards** per shape ("Squashed by: The Pretzel" with matching art).

**Mascot**
- 2-frame reactive character that rides the wall / corner of the screen — cheers on a clean pass, winces on a crush, idle-bobs on the menu.

**Accessibility (cheap, broadens appeal)**
- Color-blind-safe danger colors (don't rely on red/green alone — add shape/brightness cues).
- A toggle to reduce screen shake / flashes (photosensitivity + motion-sensitivity friendly).

---

## Appendix — Hackathon demo polish (prioritized)

**Context: Hack Club Horizons — an *online* hackathon.** The reviewer isn't in a room watching you present; they open a deployed link (or a demo video / README) on their *own* machine, and Hack Club submissions skew peer-voted / gallery-style. That reframes the whole polish strategy:

- **Your demo video, README, and a scroll-stopping GIF are first-class artifacts** — often seen *before* or *instead of* the live app. A webcam game that looks incredible in a 15s clip beats one that only shines when you stand up. *(This is why they get their own phase, P9 — not a late-polish afterthought.)*
- **Webcam friction is the #1 online enemy.** The reviewer has to grant camera permission *and physically stand up and move* — many won't. So the app must be **appreciable without standing**: attract-mode, an auto-playing demo loop, and the GIF carry it. The **seated Hand Simon-Says is your lowest-friction mode for an online reviewer** — which is exactly why it moved up to P6, ahead of the third game.
- **The deployed HTTPS link must work first-try on a stranger's machine** (P9 + P11 exit criteria) — for online judging this isn't polish, it's the whole submission. Test on a fresh browser/machine you've never granted camera on.

With that framing, every remaining polish dollar goes toward *the screen looking and sounding alive instantly* and *the death moment being a spectacle*. Pull these in during P7/P11, roughly in this order.

**Submission artifacts (online-specific — treat as load-bearing; these are P9):**
- **A 15–30s demo video / GIF** of a great run + the crush moment — the single highest-leverage thing for a peer-voted online gallery.
- **A README with an embedded GIF and a one-line hook** above the fold, plus the live link and "stand back ~6ft, face a window" setup tip.
- **An in-app attract loop** so the very first frame of the live link is already moving (no dead title card for someone who won't stand up).

**The 3 that win the demo (do these first, in P7):**
1. **Crush-moment stack** — on a wall crush, fire one tightly-tuned event: freeze-frame + *thud* SFX + a ~0.3s music duck/lowpass + screen shake. Build this *one* moment to perfection before anything else; it's what makes a death feel cinematic.
2. **Bloom on the silhouette** — bloom + vignette so the neon silhouette *photographs* like a real arcade game, not a webcam blob. Highest visual-wow per hour.
3. **Attract / idle mode on the menu** — a looping silhouette demo or auto-playing ghost so a judge walking by sees motion, never a dead title card.

**Audio (highest leverage — it carries straight into the demo video):**
- **Music ramps with speed** — raise `playbackRate` on the loop as wall speed climbs (tempo + pitch rise together = audible tension). If the pitch shift bothers, crossfade in a faster-tempo stem instead.
- **Near-miss *crack* + clean-pass *whoosh*** — the two events that fire constantly; get them crisp and they carry the whole demo's feel.
- **Countdown beeps (3-2-1) with rising pitch**, then a downbeat when play starts — frames every run and directs the judge's attention.
- **New-high-score sting** — a half-second triumphant flourish; pure dopamine, trivial to add.
- **Kick the AudioContext on the first Play click** (autoplay rules) so you never get a silent demo.

**Visual polish that reads in one glance:**
- Silhouette **glow + motion trail** on in the *menu*, so the screen looks alive before anyone plays.
- **Proximity heat** — overlap pixels glow orange→red as the wall nears, turning the core mechanic into a legible threat.
- **Clean-pass shockwave + brief slow-mo** — rewards success with spectacle.
- **Reactive background grid that pulses to the beat** — cheap, fills dead space, makes the frame feel intentional.

**"Never static screen" discipline:**
- **Loading screen with rotating tips** while MediaPipe loads — turns the awkward 2–3s model-load (the worst first-impression moment) into personality. *(Now a required P5 task.)*
- **Everything eases** — menus, cards, score count-up; nothing snaps. Reads as "polished" subconsciously.

**Demo-day safety (don't skip):**
- **Mute toggle** — a reviewer opening your link mid-task may want it off instantly. One key.
- **Reduce-shake/flash toggle** — photosensitivity safety *and* a craft signal to judges.
- **Replay GIF of the last ~2s before death** — for a webcam game this is the most shareable artifact and a killer beat to end a live demo on.

---

## Appendix — Visual identity & web-craft ("designed, not vibe-coded")

The single biggest tell of an AI-generated / "vibe-coded" site is that it wears the *defaults*: system font, dead-center single column, glowing pill button, and the stock cyan-on-near-black neon palette (which the current build has). None of these are wrong individually — the problem is that nobody *chose* them. This appendix is the checklist for making it look chosen. **Foundation** is set in P5; the full pass is **P11**; the cheap wins can be pulled forward anytime.

**Read the room — what currently screams "vibe-coded" (fix these first):**
- `font-family: system-ui` everywhere — no real typeface, no type pairing.
- The default `#00e6ff` / `#ff2e88` cyan+magenta neon — the most-generated palette there is.
- Everything centered in one column over a radial-gradient backdrop.
- A single glowing pill `<button>` with uniform border-radius as the only component.
- A wordmark that's just text with `letter-spacing` + `text-shadow`, no actual logo.
- Emoji standing in for icons (e.g. the `⚠` in the HUD).
- No favicon, no social/OG preview, generic `<title>`.
- Flat — no texture, grain, depth, or considered shadow; states snap with no easing.

**Typography (highest signal-per-hour):**
- Pick a **characterful display face** for the Juke wordmark + headings and a clean **grotesk or mono** for UI/numbers. Self-host or use one webfont pair; don't ship five.
- Set a real **type scale** (e.g. 1.25 ratio) and consistent line-heights — deliberate hierarchy, not three random sizes.
- Tabular/mono figures for score, FPS, timers so numbers don't jitter.

**Color & palette:**
- Commit to an **owned palette** with intent: one primary, one *restrained* accent, and a real neutral ramp (5–6 steps), not pure black `#000`/near-black. If you keep neon, make it *your* neon (shift the hues, add a warm or off tone) so it doesn't read as the default.
- Decide a **mood/reference** and let choices follow it (arcade cabinet? CRT vaporwave? clean brutalist neon?). One direction, applied everywhere.

**Layout & composition:**
- Break the dead-center reflex — use an intentional **grid**, off-center compositions, and real negative space. Anchor things (corner HUD, a baseline, a sidebar) so the frame feels authored.
- Consistent spacing rhythm from a spacing scale, not eyeballed gaps.

**Components & brand:**
- A real **Juke wordmark / logo** (even simple custom lettering or an SVG mark), reused on the menu, the share card, the loading screen, and the **favicon**.
- One owned **button** and **card** style with consistent radius/border/hover — not the stock glowing pill.
- Replace emoji with **real SVG icons** (mute, settings, warning, share).

**Depth, texture, motion (turns "flat web page" into "product"):**
- Subtle **grain/noise**, a tasteful **scanline/CRT** option, and *layered* glow done with restraint give it material identity.
- A shared **motion language**: tokens for easing + duration so menus, cards, and overlays all ease in/out the same way. Nothing snaps.

**The submission-link details (cheap, and the reviewer sees them first):**
- **Favicon** + **OG/Twitter meta** (title, description, preview image) so the shared link renders a real card, not a bare URL — this directly affects an online, link-first submission.
- A proper `<title>` and description; a themed `theme-color`.
- Designed **empty / loading / error** states — the loading screen (P5) and camera-error screens are part of the brand, not afterthoughts.

**A 30-minute "kill the vibe-coded look" starter** (pull forward anytime): swap in one webfont pair, shift the palette off the defaults, drop in a real wordmark + favicon, add OG meta, and give every state-change a shared easing. That alone moves the needle more than any single game feature.

---

## Appendix — Architecture as built (the seam, and how to extend it)

How the layers actually turned out after P0–P6, and where to plug new work in.

**The data path — one direction, one frame at a time:**

```
camera (getUserMedia)             engine/camera.ts
  └─ perception (MediaPipe)       engine/perception.ts   (pose always; hands lazy)
       └─ producer                engine/producer.ts     (→ one PerceptionFrame / tick)
            └─ Engine loop         engine/loop.ts         (fixed-timestep update + render)
                 └─ JukeGame       games/*.ts             (the single active game)
                      └─ Shell     shell/app.ts           (lifecycle + DOM screens, via the overlay hook)
```

- **`PerceptionFrame`** (`engine/frame.ts`) is the *only* thing games consume: `silhouetteMask` (+ `maskW/H`), `pose`, `hands`, `gestures`, `video`, `dt`. It's the same shape the fixture recorder stores, so any frame round-trips through headless replay. Keep it minimal — add a field only when a shipping game needs it (precedent: `gestures`, P6). New fields should be nullable so body games and fixture replay are unaffected.
- **`Producer`** (`engine/producer.ts`) hides whether frames come from the live camera or a replayed fixture; the loop is identical either way. It lazy-loads the hand model only when a game declares `needs: ['hands']`, so body games never pay for it.
- **`Engine`** (`engine/loop.ts`) owns the RAF loop, one active-game slot, and a per-frame `overlay` hook. It knows nothing about menus or lifecycle.
- **`JukeGame`** (`engine/game.ts`) is the seam every game implements: `id/title/needs/intensity`, `reset/init/update/render/score/isOver`, and optional `configure(CalibrationResult)`. Games are *written to this contract*, fed a `PerceptionFrame` each tick — never reaching around the engine.
- **`Shell`** (`shell/app.ts`) is layered *on top of* the engine via its overlay hook. It owns the state machine, calibration, and the DOM screens (`shell/screens.ts`), all built from the design tokens (`shell/theme.ts` + `style.css`). The engine has no dependency on the shell — you could drive a game headless without it.

**To add a new game — the whole checklist (P6 proved it):**
1. Create `games/yourGame.ts` implementing `JukeGame`; end with `register(new YourGame())`.
2. Declare `needs` (`'pose'` / `'hands'`) and `intensity` (`'standing'` / `'seated'`) — these drive lazy model loading and which calibration branch the shell shows.
3. Render a `waiting`-phase preview (it shows behind the shell's calibration + countdown). Begin the run from `configure()` — the shell's "play starts now" signal. Report progress via `score()` and end via `isOver()`.
4. Add a side-effect `import './games/yourGame'` in `main.ts` and a menu blurb in `shell/app.ts`. It now appears in the menu, calibrates, counts down, scores, and dies — for free.

**Lifecycle states** (`shell/app.ts`): `title → menu → calibrate → countdown → play → gameover`, plus a dev-only `replay`. **Escape** backs out to the menu from any in-game state (so a player is never trapped on a calibration screen they can't satisfy); **Enter** retries on game-over. A model-load failure (e.g. the lazy hand model offline) surfaces as an error overlay and returns to the menu rather than stalling.

---

## Appendix — Future directions (expanded ideas beyond the plan)

Concrete notes so the next phase doesn't start from a blank page. Grouped by the seam they touch; none are committed scope.

**Engine / contract**
- **Gate inference by `needs`.** Today the producer always runs the pose model, even during seated Simon-Says (which only needs hands). Running *only* the models the active game declares would be measurably cheaper on a laptop and cut wasted latency — verify the win on the live FPS readout. This is the highest-value cleanup left in the engine.
- **WebGPU delegate + adaptive resolution.** The Phase 1 budget readout already exists; close the loop by auto-dropping camera/mask resolution when it flashes red (the dials are already in the debug panel) instead of tuning by hand.
- **Keep `PerceptionFrame` minimal.** `gestures` is the model to follow: add a nullable field only when a real game needs it, so replay and other games stay untouched.

**HUD / shell**
- **Combo + health/crack meter (deferred from P5).** Let a game *optionally* expose `combo()` / `health()` (0..1); the shell HUD renders them when present and nothing when absent — the same opt-in pattern as `configure?`. The crack meter is really the P7 soft-fail mechanic surfaced in the HUD.
- **Shared canvas easing.** When juice (P7) starts tweening on the canvas, add easing helpers to `shell/theme.ts` mirroring the CSS `--ease-*` tokens so DOM and canvas motion match. (They were removed for now to avoid dead code — re-add them with their first real caller.)
- **Attract / idle mode (P9).** The menu's idle backdrop (`Shell.drawIdle`) is the hook point — drop a looping silhouette ghost or a replayed fixture there so the first frame of the live link already moves.

**Hand Simon-Says — rich tier (P11 stretch)**
- Beyond the 7 built-in labels: grade *arbitrary* poses from landmarks via `fingerStates` (already in `pose.ts`) + in-plane rotation — never on palm-facing depth (too noisy from one webcam). The target set becomes data instead of the model's fixed labels.
- Tempo/lives are tuned constants in `simonSays.ts`; promote them to the debug panel like the wall dials so the difficulty curve is tunable by measurement, not guesswork.

**Juice (P7) — the hooks are already there**
- `juice/` services: `particles.burst()`, `camera.shake()`, `time.freeze/slowmo()`, `fx.flash()`. Wire them to the events the games *already compute* — HITW's pass/squash transition, Simon-Says's hit/miss feedback.
- Audio subsystem (`juice/audio.ts`, Web Audio): menu music that ramps with difficulty, event SFX on those same transitions, "duck on death". Kick the AudioContext on the first menu click (autoplay rules).
- Capture path: a ring buffer of the last ~2 s of canvas frames dumped to GIF/WebM on game-over — the freeze-frame work produces it almost for free, and it's the raw material for the P9 share artifacts.

**Persistence & sharing (P8) — all client-side**
- Share card (`shell/shareCard.ts`): render the freeze-frame + score + shape name to a downloadable PNG.
- Leaderboard (`shell/leaderboard.ts`): `localStorage` daily + all-time best.
- Daily seed (`shell/dailySeed.ts`): seed the wall sequence from `YYYY-MM-DD`. Low value for a play-once gallery — keep it optional.

**More games (cheap, now the seam is paid for)**
- *Dodge the Objects* (P10): objects fly in; `maskOverlap` against object pixels = hit.
- *Lean / balance*: hold a tilt read from the shoulder-line angle (`limbAngle`) — a calm, seated-friendly counterpoint to the frantic modes.
- *Reach targets*: light up zones, touch them with a wrist landmark — a natural rhythm-game base if walls/targets arrive on the beat.

**Accessibility (cheap, broadens appeal)**
- Reduce-motion / reduce-flash toggle: the CSS already honors `prefers-reduced-motion`; expose an in-app switch and gate screen shake on it.
- Colour-blind-safe danger cues — don't lean on red/green alone; pair with brightness/shape (the calibration dots already pair colour with a fill change; extend that discipline to the wall heat and Simon-Says feedback).

**Optional backend (last, never blocking)**
- A global leaderboard is the only feature that wants a server; everything ships with zero network today. If added, keep it strictly behind the local board so a network failure never breaks play.
