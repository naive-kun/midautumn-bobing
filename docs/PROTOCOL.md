# Shared contract v1

WebSocket endpoint: `/ws`. Web preview uses Vite proxy to `127.0.0.1:8796`.
Client messages: `{ type, requestId, payload }`. Server replies with `ack` `{ type:'ack', requestId }` or `error` `{type:'error', requestId, code, message}`.

First message `hello`: payload `{token?:string}`. Server returns `{type:'welcome', playerId, token, serverTime}`. Bearer token is random server-issued, never broadcast.
Commands:
- `create`: `{name:string, rounds:number}` (1..10). Creates room and joins host; default rounds 3.
- `join`: `{name:string, roomCode:string}` (6 numeric digits).
- `ready`: `{ready:boolean}`.
- `start`: `{}` host only, all connected players ready; single player practice allowed.
- `roll`: `{}` current player only. Same requestId is idempotent.
- `leave`: `{}`.
- `ping`: `{clientTime:number}`, reply `{type:'pong',clientTime,serverTime}`.
- `reset`: `{}` host only when finished, preserves room/seats, resets round and ready.

Snapshots: `{type:'room', selfId, serverTime, room}`. `room` = `{code, hostId, phase:'lobby'|'waiting'|'rolling'|'finished', players:[{id,name,seat,ready,connected,score}], round:1, totalRounds:3, turnPlayerId:null|string, turnDeadline:null|ms, history:[{id,playerId,playerName,round,values:number[],award:{name,points,rank}, invalid?:string}], activeRoll:null|{id,playerId,startTime,duration}}`.
`{type:'left'}` clears client room.

The UI records awards per round: filter `room.history` by `round`, group by `playerId`, and show `award.name`, `values`, and `invalid`. Keep invalid retries in history; the latest attempt describes the player's current round status. `score` and `points` are retained for wire/storage compatibility only and are not displayed or used to rank players.

Trajectory broadcast `{type:'trajectory',serverTime,roll:{id,playerId,startTime,duration,frames,impacts}}`.
Frames: `[{t:seconds,dice:[[x,y,z,qx,qy,qz,qw],...6]}]`; impacts `[{t:seconds,strength:number}]`. duration in milliseconds. startTime epoch ms. Reconnecting clients receive snapshot plus active/last trajectory and display frame at current server time offset. Renderer interpolates positions and quaternions. Spectators DO NOT re-simulate.

Physics shared exports in `shared/physics.js`: `async simulateRoll({seed}={}) -> {frames,impacts,duration,values,invalid:null|string}`. Headless Bullet, bounded settling. Geometry/face conventions in `shared/geometry.js`. Rules: `evaluateRoll(values) -> {name,points,rank}` in `shared/rules.js`. Failed physical throws are recorded as invalid with zero score; allow same current player to retry with a new action id, up to 3 attempts then skip with clear history.

Renderer API in `web/scene.js`: `createScene({canvas, width, height, pixelRatio=1, canvasFactory, onImpact}) -> {resize(w,h,dpr), setRoll(roll,serverOffset=0), update(nowEpochMs), render(), dispose()}`. No mandatory DOM/global-window calls in scene module. Camera uses Y-up. `canvasFactory(width,height)` creates 2D canvas for textures; default document canvas on web. update/render called externally. Idle scene shows 6 resting dice. Server offset = serverTime - Date.now() (later refine with ping midpoint).

Root owns package.json, Vite/build scripts, minigame/, docs and shared/client.js. Server worker owns server/ and test/server.test.js. Physics worker owns shared/physics.js, shared/geometry.js, shared/rules.js and physics/rules tests. Web worker owns index.html and web/ including scene.js. All workers must avoid other owners' files.
