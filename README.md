# Juke

**Dodge, fit, and mimic — using only your webcam.** Juke is a browser webcam-game arcade with no controller, no download, and no install: your body *is* the controller. Stand back, and the game reads your silhouette and pose in real time.

> Built for [Hack Club Horizons](https://hackclub.com/).

![Juke demo](docs/demo.gif)
<!-- TODO before submitting: record a 15–30s run in-app (play → game-over → "Save clip" → WebM),
     convert it to a GIF, and save it as docs/demo.gif. Lead with a clean run + the crush moment,
     then a few seconds of seated Hand Simon-Says so a non-stander sees something playable. -->

## The games

- **Hole-in-the-Wall** (flagship) — a wall with a person-shaped gap rushes at you; contort to fit through or get squashed.
- **Hand Simon-Says** — seated and laptop-friendly; mimic the hand sign before the timer runs out.
- **Dodge the Objects** *(planned)* — objects fly in; move your body out of the way.

## How it works

Everything runs **client-side in the browser** — no backend, no video ever leaves your machine.

- **Perception:** [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe) — Pose Landmarker with segmentation masks (body games) and Gesture Recognizer (hand game), GPU-accelerated.
- **Engine:** vanilla TypeScript + a single full-window `<canvas>`, built with [Vite](https://vitejs.dev/). All three games share one engine via a `JukeGame` contract fed a normalized `PerceptionFrame` each tick.
- **No network dependency:** daily challenge (seeded RNG) and leaderboard are local; the app is fully playable and shareable with zero server.

## Play it

🔗 **Live:** https://biglyning.github.io/Juke/

**For the best experience:** use a laptop/desktop with a webcam, **stand back ~6 ft** so your whole body is in frame, face a window or light source, and use a plain background. (Hand Simon-Says works seated — just show your hand.)

You'll be asked for camera permission; the feed is processed locally and never uploaded.

## Develop

> Requires Node. Webcam APIs (`getUserMedia`) need a secure context — `localhost` is exempt, so local dev works over plain HTTP.

```bash
npm install
npm run dev      # serve at localhost with the canvas render loop
npm run build    # static production build
```

## Roadmap

The build is phased to **de-risk the hardest part (in-browser webcam perception) first**, prove one game end-to-end, then add polish and breadth. See [IMPLEMENTATION.md](IMPLEMENTATION.md) for the full phase-by-phase plan, exit criteria, and the polish backlog.

## Status

🚧 In active development. **Playable today:** the arcade shell (menu, calibration, countdown, HUD, game-over) with two complete modes — **Hole-in-the-Wall** (standing) and **Hand Simon-Says** (seated) — plus the full juice layer (audio + effects), a downloadable PNG result card, a local daily/all-time leaderboard, and an always-moving **attract loop** on the menu (a looping silhouette ghost, so the first frame is never static). The remaining submission to-dos are content captures: the gameplay GIF above and a short demo video, plus a fresh-machine smoke test of the live link. See [IMPLEMENTATION.md](IMPLEMENTATION.md) for the phase-by-phase plan and a live build-status table.
