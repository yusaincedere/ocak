# Ocak

*Ocak* (Turkish for "hearth") is the spot friends gather around.

Self-hosted voice and video calls for a group of friends, running on your own VPS. There are no accounts, no servers or channels to set up, and nothing to manage: **start a call, share the link, talk.**

- **No accounts.** You pick a name the first time, and it's saved on that device. Click it to change it anytime.
- **Start a call** to get a room with an ID and password. Share the link (`https://your.site/r/k7m2-qp4x#h3x9tw`) and friends join in one click, or they can type the ID and password.
- **Rooms are reusable.** Your recent rooms are on the home screen, so "our room" keeps working. Rooms nobody uses for 7 days are deleted.
- **In a call:** voice, camera, **screen share with audio**, mute/deafen, mic and camera pickers, and join/leave sounds. Screen shares automatically fill the stage.
- **In-call chat** lives only for the call. Nothing is stored on the server.
- **Desktop app** (Windows/macOS) adds push-to-talk, a global mute shortcut, a mini overlay and tray controls (see below).

```
 browser / desktop app ──HTTPS──► Caddy ─┬─► app (Node): creates rooms, checks passwords, hands out call tokens
                                          └─► LiveKit (call signalling)
 browser / desktop app ◄───UDP media────► LiveKit SFU on your VPS (voice / video / screen share)
```

Calls go through **LiveKit**, an open-source media server, on your VPS. Each person uploads their stream once and the server forwards it, so calls stay smooth with 5–10 people and nobody's home IP is exposed.

## Run it locally (Mac)

```bash
brew install livekit            # one-time
livekit-server --dev            # terminal 1: LiveKit on ws://localhost:7880

cp .env.example .env            # terminal 2
npm install
npm run dev                     # http://localhost:5173
```

Open http://localhost:5173 and start a call. To test with yourself, open the invite link in a private window.

> Browsers only allow mic, camera and screen capture on `localhost` or HTTPS. A phone on your Wi-Fi can't join your dev server; use the deployed version for that.

## Deploy to the VPS

You need:
- a Linux VPS with Docker and Docker Compose
- two DNS names that point at it, for example `chat.yourdomain.com` and `rtc.yourdomain.com`

**No domain?** `sslip.io` gives you one for free: if your IP is `1.2.3.4`, use `chat.1-2-3-4.sslip.io` and `rtc.1-2-3-4.sslip.io`.

```bash
cd ocak/deploy
./setup.sh                      # asks for the domains and an optional server code, writes .env + livekit.yaml
# open the firewall ports it prints (80, 443, 7881/tcp, 3478/udp, 50000-50200/udp)
docker compose up -d --build
```

**Server code (recommended):** anyone can *join* a room with its link, but *starting* a new call asks for the server code once. The browser then remembers it. This stops strangers who find your site from running their own calls on your bandwidth. Set or change it with `CREATE_CODE` in `deploy/.env`.

Useful commands:

```bash
docker compose logs -f app livekit     # logs
docker compose up -d --build app       # redeploy after pulling changes
```

**Bandwidth:** roughly 1.5–2.5 Mbps out of the VPS per viewer per 720p camera, and more for 1080p screen shares. Five friends with cameras on is about 25–35 Mbps. Check your VPS's monthly traffic quota.

## Desktop app (Windows .exe / macOS .dmg)

The desktop app is a small Electron shell (`desktop/`) that opens your Ocak server, so web updates show up there instantly. It adds a few voice extras:

- **Mini overlay:** when you switch to a game or another app during a call, a small floating panel shows who's talking, with mute, deafen and leave. Drag it anywhere, and it remembers the spot.
- **Tray controls:** mute, deafen or leave the call from the tray icon. Closing the window keeps you in the call.
- **Push-to-talk:** any key or extra mouse button, and it works while you're in a game.
- **Global mute shortcut:** `Ctrl+Shift+M` by default.
- **Screen picker:** choose a screen or a single app window, and optionally share computer audio (Windows).

Settings are under ⚙ (top-right on the home screen, or in a call).

**Try it locally** (with `npm run dev` running):

```bash
cd desktop
npm install
npm run dev
```

**Build the installers with GitHub Actions** (this builds the Windows `.exe` on a real Windows machine):

1. Run `mkdir -p .github/workflows && mv desktop/ci/desktop.yml .github/workflows/`, then push to GitHub.
2. Optional: add a repository variable named `OCAK_SERVER_URL` (for example `https://chat.yourdomain.com`) so the app connects automatically.
3. Go to **Actions → Desktop app → Run workflow**, then download the installers from the run's artifacts.

To build locally instead, run `npm pkg set ocak.serverUrl=https://chat.yourdomain.com`, then `npm run dist:mac` (on a Mac) or `npm run dist:win` (on Windows).

**Give it to friends.** Put the installer in `deploy/downloads/` on the VPS so they can download it from your site.

> The builds aren't code-signed. On Windows, click **More info → Run anyway**. On macOS, right-click → **Open** the first time.
> **Computer audio** captures everything your PC plays, including your friends' voices, so they may hear themselves. Leave it off unless you're sharing a game or video.

## Project layout

```
server/src/
  index.ts          Fastify setup, serves web/dist in production
  config.ts         env vars (refuses default secrets in production)
  db.ts             SQLite: just a rooms table (id, password hash, last used)
  rooms.ts          room ID / password generation and checks
  routes/rooms.ts   POST /api/rooms, POST /api/rooms/:id/join, GET /api/config
  protocol.ts       types shared with the web app
web/src/
  App.tsx           home ⇄ call
  identity.ts       device id, name, recent rooms (local storage, no accounts)
  links.ts          invite links /r/<id>#<password>
  call.ts           start / join / leave, call quality settings
  components/       Home, CallView (stage, controls, chat, invite), ScreenPicker, settings
desktop/src/
  main.ts           window, tray, permissions, screen picker, IPC
  overlay.ts        the floating mini overlay (static/overlay.html)
  hotkeys.ts        system-wide push-to-talk
deploy/             docker-compose, Caddyfile, LiveKit config, setup.sh
```

## Next

- **Remote control:** a viewer asks to control a shared screen, and the sharer allows or denies it, with a timer and an instant revoke. Only the desktop app can be controlled.
- Desktop auto-update.
