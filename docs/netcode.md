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
  with the current host tick. Replies confirm traffic in both directions;
  incoming snapshots alone do not prove player inputs can reach the host.
- Eight seconds without acknowledgements on either connection starts
  recovery. Missing snapshots also trigger recovery if heartbeat replies
  show the host's simulation is ahead of the last snapshot. A host whose
  simulation is paused but still answers pings does not trigger that check.
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

The host still runs the simulation in its browser's animation frames.
Putting the host tab in the background can pause the game for everyone.
Guests still draw interpolated snapshots without local input prediction.
These changes repair recovery, not hosting continuity or latency hiding.

## Verification

`src/net/session.test.ts` exercises the real session logic with fake
PeerJS connections and timers: silent state stalls, one-way failures,
snapshot black holes, close/error/ICE failures, retry deadlines, stale
callbacks, queue pressure, player reclamation and leaving during recovery.
`src/net/room.test.ts` covers expired input and match restarts.

For a live check, reload the host and all guests onto the same build before
starting a new room. Disconnect a guest's network for over eight seconds,
restore it, and check that they rejoin as the same player without refreshing.
Repeat with the other two players continuing their match, and check a
short interruption also recovers. Capture browser console logs if it fails.
Real browser/WebRTC, relay paths and international network behavior still
need that live check; the automated tests replace the transports.
