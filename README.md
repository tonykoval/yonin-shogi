# Yonin Shogi

https://yonin-shogi.fly.dev/

Standalone four-player [shogi](https://en.wikipedia.org/wiki/Shogi) (将棋) variant on a 9×9 board — play **solo against bots**, work through an **interactive tutorial**, or host an **online room** and share the link with friends.

Extracted from the [shogi-puzzler](https://github.com/tonykoval/shogi-puzzler) project into its own self-contained app.

Current version: **1.0.0**.

## Features

- **Solo vs. bots** — 1–3 computer opponents at Easy / Medium / Hard.
- **Online rooms** — share a link; empty seats can be filled with bots.
- **Interactive tutorial** — learn the rules step by step.
- **Checkmate modes** — choose what happens to an eliminated player's pieces:
  *take their pieces* (classic), *pieces to your hand*, or *free-for-all*
  (their pieces stay on the board for anyone to capture).
- **Eval overlay** — per-player advantage bar, material points and check badges.
- English and Slovak UI.

## How it works

All game rules — move generation, check, checkmate, promotion, drops, the special
4-player turn order and elimination logic — run **client-side** in
`yonin-shogi.js`, so **solo vs. bots** and the **tutorial** are fully offline in
the browser.

For **online rooms** the server keeps an authoritative copy of the same engine
(`ShogiEngine.scala`) to validate turn order, resolve checkmate/elimination and
drive bot seats; clients still replay the move list to render. Rooms are kept
in memory only (no database).

## Tech stack

- **Scala 2.13** + [Cask](https://com-lihaoyi.github.io/cask/) (HTTP) + [Scalatags](https://com-lihaoyi.github.io/scalatags/) (server-side HTML)
- Bootstrap 5 + Bootstrap Icons (via CDN) on the frontend
- No database, no engine, no auth — just an in-memory room registry

## Run

```bash
sbt run        # starts on http://0.0.0.0:8080
```

Then open:

- `/` — lobby (solo / online / tutorial)
- `/tutorial` — interactive rules tutorial
- `/solo?bots=3&level=medium&mode=inherit` — play against 1–3 bots
- `/game/:roomId` — an online room
- `/about` — about & credits

### Build a fat JAR

```bash
sbt assembly
java -jar target/scala-2.13/yonin-shogi-assembly-1.0.0.jar
```

### Configuration

| Env var      | Default   | Description        |
|--------------|-----------|--------------------|
| `YONIN_HOST` | `0.0.0.0` | Bind address       |
| `YONIN_PORT` | `8080`    | HTTP port          |

## Internationalization

English and Slovak, in `src/main/resources/i18n/{en,sk}.json`. Language is chosen
via the `?lang=` query param (persisted in a cookie) and the header toggle.

## Project layout

```
src/main/scala/yonin/
  YoninShogiApp.scala     entry point (cask.Main)
  YoninShogiRoutes.scala  pages + online-room relay API
  StaticRoutes.scala      serves /js and /assets/css from the classpath
  Layout.scala            shared <head> + minimal navbar
  I18n.scala              JSON-backed translations
src/main/resources/
  js/   yonin-shogi.js, yonin-tutorial.js   (the game engine + tutorial)
  assets/css/  yonin-shogi.css, app.css
  i18n/ en.json, sk.json
```

## License

Licensed under the [Apache License 2.0](LICENSE). Copyright 2026 Tony Koval.
