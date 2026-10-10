# Online matches

Choose **Online game**, create a room for two to four players, share its six-character code,
and start when every seat is connected. Everyone plays at the same simulation speed.
Online games do not overwrite the single-player resume slot.

The browser sends commands to a WebSocket relay at `/multiplayer`. The relay assigns player
identities, bounds and validates messages, orders all players' commands, then releases one
turn after everyone has submitted. Four fixed simulation ticks make one turn. Every 25 turns
the peers compare simulation hashes; disagreement pauses the match instead of hiding drift.
Cosmetic player colours and pathfinding diagnostics are excluded from these hashes.

A disconnected seat remains reserved for 30 seconds. Its token stays in that browser's
session storage; rejoining the same code restores the seat. A fresh browser world replays
the sparse command history from the original map, including empty turns, so private movement
and exploration caches continue exactly. After the grace period, a lost player resigns and
the remaining players continue. The relay is in-memory: restarting it ends existing rooms.

## Local verification

```
npm run build:relay
npm run relay
npm test -- src/network/network.test.ts --maxWorkers=1
npx playwright test e2e/multiplayer.e2e.ts --workers=1
```

Browser regressions run a private ephemeral relay. Real matches use the same-origin endpoint.
Vite development and preview servers proxy `/multiplayer` to the local relay on port 8973,
so starting the relay and opening localhost:5173 or localhost:4174 also supports normal online rooms.
The tests compare both clients' checkpoint hashes, interrupt/reconnect a seat and finish the
match by resignation; relay tests cover identity attribution and hash disagreement.

## Production

Host: `jedmeier@157.245.7.84` (jedm). Static files remain under `/var/www/agesago.jedm.dev`.
The separate relay service binds only `127.0.0.1:8973` and runs as `jedmeier`.
Build `relay-dist`, copy it plus `server/start.mjs` and package/lock files into an immutable
`/home/jedmeier/agesago-relay/releases/<commit>` directory, run `npm ci --omit=dev`, and point
`/home/jedmeier/agesago-relay/current` at that release. Install the service unit from
`server/agesago-relay.service` and start it with systemd.

Add this block to the HTTPS `agesago.jedm.dev` nginx server (leave the static paths intact):

```
location /multiplayer {
    proxy_pass http://127.0.0.1:8973;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 70s;
    proxy_send_timeout 70s;
}
```

Validate with `nginx -t` before reloading. Check both `/multiplayer/health` and an actual
WebSocket create/join/turn exchange at `wss://agesago.jedm.dev/multiplayer` afterwards.
Rollback: restore the previous release symlink and restart `agesago-relay`; for a first
installation, stop/disable the service and restore the saved nginx site file, validate,
then reload nginx. No database or existing game data is migrated.

First installation completed on 2026-10-10: `agesago-relay` is active on jedm,
with release `/home/jedmeier/agesago-relay/releases/1ec9f2b`. The pre-relay nginx
configuration is saved at `/etc/nginx/sites-available/agesago.jedm.dev.before-relay-1ec9f2b`.
Both local and public health checks passed. The public WebSocket smoke check completed
two independent client simulations, compared hashes at turns 0 and 25, and ended with
the same winner on both clients. Reproduce that protocol check with:

```sh
RELAY_SMOKE_URL=wss://agesago.jedm.dev/multiplayer \
RELAY_SMOKE_ORIGIN=https://agesago.jedm.dev npx vite-node scripts/smoke-relay.ts
```

The static-site CI deployment does not restart the relay; relay changes require building
and installing a new release through the service deployment procedure above.

The relay accepts the production origin, caps connections/rooms/messages/history and expires
inactive rooms. Limits also cap session length and replay size. It provides deterministic
coordination, not anti-cheat: participants hold the full simulation state on their browsers.
