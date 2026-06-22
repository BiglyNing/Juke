# Juke — Implementation Phases

A phased build plan for Juke, a webcam-game arcade (flagship: **Hole-in-the-Wall**, plus **Dodge** and **Hand Simon-Says**).

## Guiding principle

**Build the risky, foundational, and testable parts first; defer game logic and polish.**

The single biggest unknown in this project is *"does in-browser webcam perception actually run well enough on a normal laptop?"* — not *"is the wall fun?"*. So we prove the perception pipeline and build a **debug/test harness** before writing a line of real gameplay. Every phase ends with a concrete **exit criteria** you can verify by looking at the screen, so you never build on an unproven layer.

Ordering rules:
1. **De-risk before you invest.** Anything that could force a redesign (perception, performance, collision feasibility) comes first.
2. **Tooling before content.** The debug overlay and tuning sliders exist before the first game, so every later phase is measurable.
3. **One vertical slice before breadth.** Get *one* crude-but-complete game loop working end-to-end before adding juice, more games, or backend.
4. **Polish last.** Particles, mascot, share cards, and a second/third game only after the core is proven and tunable.

Legend for each phase: **Goal** · **Why here** · **Tasks** · **Exit criteria** (how you verify) · **Risks**.

---

## Phase 0 — Project skeleton & dev loop

**Goal:** A running dev environment that serves a blank page over HTTPS-capable localhost, deployable as a static site.

**Why here:** You can't test anything without a build/serve loop. Webcam (`getUserMedia`) requires a secure context, so the dev server must work on `localhost` (which is exempt from the HTTPS requirement).

**Tasks:**
- `npm create vite@latest` → TypeScript template. No framework (vanilla TS).
- Establish folder layout (`src/engine`, `src/juice`, `src/shell`, `src/games`, `src/render`).
- Add a single full-window `<canvas>` and a basic render loop stub (`requestAnimationFrame`).
- Configure static deploy target — **decided: GitHub Pages** (free, no extra accounts, fits the Hack Club GitHub flow; deploy via a GitHub Action on push). Wire it now so deploy is never a late surprise. Confirm one deploy of the blank page succeeds. Note: Vite needs `base` set to the repo name for Pages (`base: '/Juke/'`) so asset paths resolve.
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

**Exit criteria:**
- You can see your own silhouette mask and skeleton tracking your movement in real time.
- It runs at an acceptable frame rate on the **actual target laptop** (not just your dev machine) — confirm by eye that it's not choppy.
- Denying camera permission shows a graceful message.

**Risks:** High — this is the de-risking phase. If perf is bad, try the WebGPU delegate, lower the camera resolution, or reduce model complexity *now*, before building on it.

---

## Phase 2 — Debug/test harness & perception utilities

**Goal:** A developer overlay and a set of tested utility functions that make every later phase measurable. **This is the "testing features first" phase.**

**Why here:** Before any gameplay, you want instruments. You'll be tuning resolution, leniency thresholds, and smoothing constantly — you need numbers on screen, not guesses. Building this now pays off in every subsequent phase.

**Tasks:**
- **Debug overlay** (toggle with a key), showing live:
  - FPS / frame time, and perception inference time.
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
- Lightweight unit tests for the pure math functions (`maskOverlap`, angles) — these are deterministic and worth pinning down.

**Exit criteria:**
- Pressing the debug key shows FPS + the downsampled mask grid overlaid on the video.
- Moving a slider visibly changes the mask resolution / smoothing in real time.
- `maskOverlap` and the angle helpers pass their unit tests.

**Risks:** Low, but resist the urge to skip this — it's the difference between tuning by measurement and tuning by vibes.

---

## Phase 3 — Engine core: the game contract & loop

**Goal:** The `JukeGame` interface, a registry, and a loop that drives whichever game is active using a normalized `PerceptionFrame`.

**Why here:** This is the seam that lets all three games share one engine and lets you build/cut games independently. It must exist before the first game so the first game is written *to the contract*, not around it.

**Tasks:**
- Define `PerceptionFrame` (`silhouetteMask`, `maskW/H`, `pose`, `hands`, `video`, `dt`).
- Define `JukeGame` (`id`, `title`, `needs`, `intensity`, `init`, `update`, `render`, `score`, `isOver`, `reset`).
- Build the perception layer into a producer that emits one `PerceptionFrame` per tick (lazy-loading hand model only when a game `needs` it).
- Fixed-timestep update + render loop; a simple "active game" slot.
- A `registry` and `register()`.

**Exit criteria:**
- A trivial throwaway "test game" (e.g. draws the mask and prints `dt`) implements `JukeGame`, is registered, and runs through the loop.
- Swapping the active game is a one-line change.

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
- Find usable default values for **resolution**, **erosion**, **TOL**, and **crossing window** using the sliders.

**Exit criteria:**
- You can physically pass several walls in a row and see the score climb.
- Failing (not fitting) ends the run.
- You've recorded sensible default leniency values that feel fair on the target laptop.

**Risks:** Medium — this is where "is it actually fun / fair?" gets answered. Budget time to tune, not just build.

---

## Phase 5 — Game shell: menu, calibration, lifecycle

**Goal:** The wrapper around games — an arcade menu, a calibration step, a HUD, and clean state transitions.

**Why here:** Once one game works, you need the frame that holds games. Calibration in particular is a *real-world reliability* feature (the laptop judge being too close / poorly lit is a top failure mode), so it ranks above polish.

**Tasks:**
- **Arcade menu**: cards auto-built from the registry; selecting one starts it.
- **Calibration** adapts to `intensity`: standing → "step back until your feet show, plain background, face the light," with a live silhouette preview and a green check when all four limbs are visible (gate on landmark visibility). Seated → "show your hand."
- **HUD**: score, combo, the crack/health meter.
- **State machine**: Menu → Calibration → Countdown → Play → GameOver → (Retry / Menu).

**Exit criteria:**
- From a cold load you can: open the menu, pick Hole-in-the-Wall, pass calibration, play, die, and return to the menu — without a reload.
- Calibration refuses to start until the body is properly framed.

**Risks:** Low–medium. Keep the state machine simple and explicit.

---

## Phase 6 — Juice layer (the north star)

**Goal:** Make it *feel* like a real game — the project's #1 quality bar.

**Why here:** Polish only pays off once the mechanic underneath is proven (Phase 4) and framed (Phase 5). Doing it earlier means polishing something you might redesign.

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

**Exit criteria:**
- A clean pass and a crush both produce distinct, satisfying **audio + visual** feedback.
- Background music plays from the menu through gameplay, and a mute toggle works.
- The silhouette looks polished (glow + trail) on the menu and in-game.
- Particle/effect counts are capped so weak laptops stay smooth (verify FPS via the overlay).

**Risks:** Medium — easy to overspend here. Cap effort; juice is high-leverage but has diminishing returns.

---

## Phase 7 — Result/share card, daily challenge, local leaderboard

**Goal:** The shareability + retention layer, all client-side (no backend).

**Why here:** These depend on a complete play loop and a death moment (freeze-frame from Phase 6). They're high-value for a hackathon submission but not load-bearing, so they come after the core feels good.

**Tasks:**
- **Share card** (`shell/shareCard.ts`): render the freeze-frame to a canvas — desaturated background, glowing silhouette, score + shape name + caption. Download as PNG / copy to clipboard.
- **Daily challenge** (`shell/dailySeed.ts`): seed RNG from `YYYY-MM-DD` so the wall sequence is identical for everyone that day. Pure local.
- **Leaderboard** (`shell/leaderboard.ts`): localStorage daily-best + all-time best. (Optional later: a free Supabase/Cloudflare backend for a global board — a single REST call on game-over, still no WebSocket.)

**Exit criteria:**
- Dying produces a downloadable PNG result card.
- Replaying the daily challenge gives the same wall sequence; a new date gives a new one.
- Your best score persists across reloads.

**Risks:** Low. The optional global leaderboard is the only thing that touches a network; keep it optional and behind the local version.

---

## Phase 8 — Game #2: Dodge the Objects

**Goal:** The second game, reusing the entire engine.

**Why here:** Proves the plugin architecture pays off and adds variety. Cheap *because* Phases 1–7 did the hard shared work — it's mostly a new danger-mask generator + content.

**Tasks:**
- New `JukeGame` in `games/dodge.ts`: objects fly in (2–3 types), `maskOverlap` against object pixels = hit.
- Difficulty curve via spawn rate + speed.
- Reuse juice (trails, shatter on near-miss, hit flash) and the shell/share/leaderboard systems.

**Exit criteria:**
- Dodge appears in the arcade menu and plays a full loop (calibration → play → death → share) with **no engine changes** — only a new game file (plus registration).

**Risks:** Low. If anything here forces engine changes, note it — it's feedback on the contract.

---

## Phase 9 — Game #3: Hand Simon-Says

**Goal:** The seated, laptop-friendly hand-mimic game.

**Why here:** Introduces the **hand** perception path, so it comes after the body pipeline is fully proven. Last of the three because it's the most independent and the lowest-risk-to-cut.

**Tasks:**
- Lazy-load **MediaPipe Gesture Recognizer** (triggered by `needs: ['hands']`).
- **Easy tier first:** targets are the ~7 built-in gesture labels; match by label. Get the full loop working on this before anything fancier.
- Loop: flash target sign → short timer → score match → streak combos → tempo ramps.
- **Rich tier (optional):** arbitrary hand poses via normalized landmark comparison (finger-states + in-plane rotation; never grade on palm-facing depth).
- Reuse shell/juice/share/leaderboard.

**Exit criteria:**
- Hand Simon-Says plays a full loop using the built-in gestures, seated, with no standing calibration.
- The hand model loads only when this game is selected (verify the body games never pay for it).

**Risks:** Low–medium. Keep to the easy tier for the first working version; treat the rich tier as a stretch.

---

## Phase 10 — Polish pass, mascot, and ship

**Goal:** Final coat of paint and a confident public deploy.

**Why here:** Last, by definition. Everything works; now make it cohesive.

**Tasks:**
- **Mascot**: fill the reserved layout slot — a simple 2-frame character that reacts (cheers on pass, winces on crush).
- Visual cohesion pass: consistent neon-on-dark theme across menu, games, cards.
- First-run UX: a quick "how to play" and the camera-permission ask framed nicely.
- Cross-laptop sanity check (different webcam, lighting, lower-end machine).
- Final deploy + verify the live HTTPS link works end-to-end on a fresh machine.

**Exit criteria:**
- A stranger can open the live link, grant camera access, understand what to do, and play all three games without help.
- The mascot reacts in at least one game.
- Runs acceptably on a low-end laptop.

**Risks:** Low. Time-box polish; protect the "it works on a fresh machine" check above cosmetic extras.

---

## Dependency summary

```
P0 setup
  └─ P1 perception (HIGH RISK — prove first)
       └─ P2 debug harness + utilities (test tooling first)
            └─ P3 engine contract + loop
                 └─ P4 minimal Hole-in-the-Wall (vertical slice)
                      └─ P5 shell: menu / calibration / lifecycle
                           └─ P6 juice (north star)
                                └─ P7 share card / daily / leaderboard
                                     ├─ P8 Dodge (reuse engine)
                                     ├─ P9 Hand Simon (new hand path)
                                     └─ P10 polish + mascot + ship
```

## What is deliberately deferred and why

- **Game logic beyond the first slice** waits until perception + harness + contract are proven (P1–P3). Building games on an unproven pipeline risks throwing them away.
- **Polish/juice** waits until the mechanic is proven fun and fair (P4) and framed (P5).
- **Backend / global leaderboard** is optional and last — the design is fully playable and shareable with zero server, so a backend never blocks shipping.
- **The mascot and rich hand-grading** are explicitly stretch items, safe to cut without affecting the core.

---

## Appendix — Polish backlog (pull from this in P6 / P10)

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
- **Attract / idle mode** on the menu: a looping silhouette demo so the screen is never static.
- **Loading screen with personality** (rotating tips while the model loads).
- Nicely framed **camera-permission prompt** ("Juke needs your camera to see you move").

**Shareability (beyond the static card)**
- **Replay GIF/clip capture** of the last few seconds before death — far more shareable than a static image.
- **Themed result cards** per shape ("Squashed by: The Pretzel" with matching art).

**Mascot**
- 2-frame reactive character that rides the wall / corner of the screen — cheers on a clean pass, winces on a crush, idle-bobs on the menu.

**Accessibility (cheap, broadens appeal)**
- Color-blind-safe danger colors (don't rely on red/green alone — add shape/brightness cues).
- A toggle to reduce screen shake / flashes (photosensitivity + motion-sensitivity friendly).

---

## Appendix — Hackathon demo polish (prioritized)

**Context: Hack Club Horizons — an *online* hackathon.** The reviewer isn't in a room watching you present; they open a deployed link (or a demo video / README) on their *own* machine, and Hack Club submissions skew peer-voted / gallery-style. That reframes the whole polish strategy:

- **Your demo video, README, and a scroll-stopping GIF are first-class artifacts** — often seen *before* or *instead of* the live app. A webcam game that looks incredible in a 15s clip beats one that only shines when you stand up.
- **Webcam friction is the #1 online enemy.** The reviewer has to grant camera permission *and physically stand up and move* — many won't. So the app must be **appreciable without standing**: attract-mode, an auto-playing demo loop, and the GIF carry it. The **seated Hand Simon-Says is your lowest-friction mode for an online reviewer** — weight it higher than the phase order implies; it may be the one they actually try.
- **The deployed HTTPS link must work first-try on a stranger's machine** (P10 exit criteria) — for online judging this isn't polish, it's the whole submission. Test on a fresh browser/machine you've never granted camera on.

With that framing, every remaining polish dollar goes toward *the screen looking and sounding alive instantly* and *the death moment being a spectacle*. Pull these in during P6/P10, roughly in this order.

**Submission artifacts (online-specific — treat as load-bearing):**
- **A 15–30s demo video / GIF** of a great run + the crush moment — the single highest-leverage thing for a peer-voted online gallery.
- **A README with an embedded GIF and a one-line hook** above the fold, plus the live link and "stand back ~6ft, face a window" setup tip.
- **An in-app attract loop** so the very first frame of the live link is already moving (no dead title card for someone who won't stand up).

**The 3 that win the demo (do these first):**
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
- **Loading screen with rotating tips** while MediaPipe loads — turns the awkward 2–3s model-load (the worst first-impression moment) into personality.
- **Everything eases** — menus, cards, score count-up; nothing snaps. Reads as "polished" subconsciously.

**Demo-day safety (don't skip):**
- **Mute toggle** — a reviewer opening your link mid-task may want it off instantly. One key.
- **Reduce-shake/flash toggle** — photosensitivity safety *and* a craft signal to judges.
- **Replay GIF of the last ~2s before death** — for a webcam game this is the most shareable artifact and a killer beat to end a live demo on.
