# Juke

**Dodge, fit, and mimic — using only your webcam.** Juke is a browser webcam-game arcade with no controller, no download, and no install: your body *is* the controller. Stand back, and the game reads your silhouette and pose in real time.

> Built for [Hack Club Horizons](https://hackclub.com/).

![Juke demo](docs/demo.gif) <!-- TODO: drop a 15–30s gameplay GIF here before submitting -->

## The games

- **Hole-in-the-Wall** (flagship) — a wall with a person-shaped gap rushes at you; contort to fit through or get squashed.
- **Dodge the Objects** — objects fly in; move your body out of the way.
- **Hand Simon-Says** — seated and laptop-friendly; mimic the hand sign before the timer runs out.

## How it works

Everything runs **client-side in the browser** — no backend, no video ever leaves your machine.

- **Perception:** [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe) — Pose Landmarker with segmentation masks (body games) and Gesture Recognizer (hand game), GPU-accelerated.
- **Engine:** vanilla TypeScript + a single full-window `<canvas>`, built with [Vite](https://vitejs.dev/). All three games share one engine via a `JukeGame` contract fed a normalized `PerceptionFrame` each tick.
- **No network dependency:** daily challenge (seeded RNG) and leaderboard are local; the app is fully playable and shareable with zero server.

## Play it

🔗 **Live:** _(coming soon — deployed link goes here)_

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

🚧 In active development — see [IMPLEMENTATION.md](IMPLEMENTATION.md) for current phase progress.
