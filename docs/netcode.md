# Online connection recovery

## The reported freeze

In a three-player session on November 9, one guest in Germany stopped
receiving match updates and recovered after refreshing. The other players
were in Portugal. No browser logs or connection statistics were captured,
so the transport failure that started it is unconfirmed.

The previous code had a definite recovery gap: every guest opened two
PeerJS connections, but only the reliable control connection's `close`
event initiated a reconnect. A closed, failed or silently stalled state
connection left the control connection open and the pitch frozen. There
was no timeout for incoming snapshots. Reconnect attempts could also hang
forever once a room had already been joined.

## Recovery behavior

- Control carries identity, room changes and match events. State carries
  player inputs and snapshots. Both send a ping every second and answer
  with the current host tick and the sender's timestamp. Replies confirm
  traffic in both directions; incoming snapshots alone do not prove player
  inputs can reach the host.
- Eight seconds without acknowledgements on either connection starts
  recovery. Missing snapshots also trigger recovery if heartbeat replies
  show the host's simulation has passed the point where another snapshot
  was due (`snapshotEvery` ticks past the last one). A host whose
  simulation is paused but still answers pings does not trigger that check,
  even if it stopped a tick or so after its last snapshot.
- A connection close, error or failed ICE transport starts recovery
  immediately. Transient ICE disconnections get the heartbeat grace period.
- Recovery destroys the guest's old Peer and both connections, waits
  2.5 seconds, then creates a new Peer using the relay credential provider.
  Each connection attempt has a 15-second deadline, including retries.
  Failed initial joins show an error; an established room keeps retrying
  until the player leaves. The existing room and per-tab player identity
  survive, so the host reclaims the same player, team and match position.
- The UI says reconnecting until the new state connection actually receives
  traffic. Old callbacks cannot overwrite room state or inject snapshots.
- The host acknowledges identity before the guest opens state. State is
  bound to that control connection's ID and remote Peer ID, preventing a
  delayed old connection from taking over a returning player's stream.
- Inputs expire after half a second of simulated time. Sequence numbers
  still reject late inputs, and a new match invalidates the previous input.
- State sends are skipped when the browser has over 16 KiB queued. A later
  input or snapshot replaces the skipped update. Send exceptions close the
  failing connection instead of interrupting the host's simulation loop.

## Match consistency

Protocol version 2 is required on both ends. An old host or guest is rejected
with a message to refresh every browser. Each kickoff has a new random match
ID, carried by room state, inputs, snapshots, events and heartbeat replies.
Clients reject old-match traffic even if its tick/sequence is higher.

On joining or starting a match, the reliable control connection sends a
baseline (`sync`): the current snapshot, goal history, winner, goal pause,
coin-toss hold and kickoff team. Guests reset their interpolation/effect
queues to that baseline. A returning guest sees the final scoreboard even
if they missed the winning goal, or the goal banner if play is still paused.
Ordinary snapshots remain small; historical goals are not sent 30 times a
second. Inputs wait until a baseline for the current match has arrived.

Snapshots older than the latest baseline are dropped. Past it, only
advancing snapshots count as fresh traffic (the stall check and the
diagnostics), but a late one still goes to the interpolation buffer, which
slots it in if it falls within what's being drawn. The buffer never
resynchronizes to an old arriving packet, rejects another match until
reset, and retains at most 64 snapshots. Event queues are also
bounded while the tab is not drawing.

Recovery logs begin with `[ink-kick] reconnecting` and include a reason,
the latest snapshot and host ticks, and acknowledgement ages. These are
useful evidence if another live test stalls.

## Transport limits

In the installed PeerJS 1.5.4, `reliable: false` maps to `ordered: false`
when creating the RTCDataChannel. It does **not** set `maxRetransmits` or
`maxPacketLifeTime`, so this is unordered delivery with retransmissions,
not a lossy UDP-style channel. See `node_modules/peerjs/dist/peerjs.js`
at `createDataChannel` and the
[WebRTC channel options](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/createDataChannel).
The queue guard uses the browser's
[`bufferedAmount`](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/bufferedAmount).
It limits new application sends; it cannot cancel already queued packets.

The host steps its match from animation frames while the tab is drawing,
so its own view blends between ticks with current time. When frames stop
for over 100 ms (a hidden or covered tab), `HostClock` steps it from a
timer instead and queues visual events until drawing resumes. The timer
runs in a dedicated worker: a background page's own timers are slowed to
about once a second, and with each step capped at 0.1 s (six simulation
steps, to avoid a burst of stale inputs/updates) that would play the match
at a tenth of its speed. Without workers it falls back to the page timer.
Browsers can still freeze a tab entirely, so this improves background
hosting but is not an always-on guarantee; a server would be needed for
that. Guests still interpolate snapshots without local movement prediction.

## Diagnostics

In a guest's browser console, run `await inkKickNetwork()`. It reports:

- last heartbeat RTT for each connection, in milliseconds;
- time since the latest accepted snapshot, plus an exponentially smoothed
  arrival jitter estimate relative to host tick spacing;
- browser queue size for control and state, in bytes;
- direct/relay/unknown route for each connection, read on demand from the
  selected ICE candidate pair using
  [`getStats()`](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/getStats);
- reconnect count and most recent reason, scoped to the current session.

It returns no ICE addresses or relay credentials. Null means a measurement
is not available yet. Route discovery may return unknown where browser
statistics do not expose the selected pair. The host currently exposes no
per-guest metric table; capture this on the affected guest.

## Verification

`src/net/session.test.ts` exercises the real session logic with fake
PeerJS connections and timers: silent state stalls, one-way failures,
snapshot black holes, close/error/ICE failures, retry deadlines, stale
callbacks, queue pressure, player reclamation and leaving during recovery.
`src/net/room.test.ts` covers expired input, match restarts and recovery of
missed results. `src/game/state.test.ts` covers old packets and buffer reset.
`src/net/host-clock.test.ts` verifies that hosting delivers snapshots without
animation frames, and that frames and the timer never both step the match.
`src/ui/match-ui.test.ts` checks scoreboard/banner recovery with a minimal
DOM substitute.

For a live check, reload the host and all guests onto the same build before
starting a new room. Disconnect a guest's network for over eight seconds,
restore it, and check that they rejoin as the same player without refreshing.
Repeat with the other two players continuing their match, and check a
short interruption also recovers. Also test disconnecting before the final
goal, letting the host start another match while a guest is away, and
switching away from the host's tab. Capture `await inkKickNetwork()` and
browser console logs if it fails.
Real browser/WebRTC, relay paths and international network behavior still
need that live check; the automated tests replace the transports.
