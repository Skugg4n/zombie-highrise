// Wire protocol. NETCODE owns this file; every other domain conforms.
//
// Transport: PeerJS DataConnections (reliable, JSON), star topology with a
// host-authoritative server-in-a-browser.
//
// GEOMETRY IS NEVER SENT. Every peer builds the level locally from
// (seed, level) in the welcome message, so the wire only ever carries
// state, never the world.
//
// Message types
//   client -> host
//     hi     { t, pv, name, platform, v, b }     once, on connect
//              pv = PROTO_VERSION, checked by the host
//              b  = the joiner's meta scrap bonus
//     pose   { t, p:[x,y,z], ry, rx, vr, h?, hl?, hr? }   ~20 Hz
//              p  = feet position (world), ry = yaw, rx = pitch
//              vr = true when in an XR session
//              h/hl/hr = head / left hand / right hand as { p:[..], q:[..] }
//     act    { t: <action>, ... }                every player action; the
//              action set is owned by HostSim.handle in game/state.js
//   host -> client
//     welcome { t, pv, id, code, v, seed, level, area }
//              player id plus the level seed, so every peer builds
//              identical geometry locally
//     snap    { t, ts, players:{id:{p,ry,rx,vr,hp,down,name,h?,hl?,hr?}},
//               zs:[[id,typeIdx,x,y,z,hp],...],     zombies
//               gs, is, ms, ds, bs, tr,             grenades, items, mines,
//                                                   drones, barrels, traps
//               bw:[hp,...],                        base wall segment health
//               wave:{ph,n,lv,t,left,mod},          phase machine mirror
//               ev:[Event] }                        ~15 Hz
//   Event (inside snap.ev)
//     The set is owned by HostSim; the client switch in main.js handles it
//     and now WARNS on any event it does not know, because nine of them
//     were once being shipped every frame and silently discarded.
//
// PROTO_VERSION gates compatibility. Bump it whenever the shape of any
// message above changes in a way an older peer would misread. This matters
// more than it looks: builds are served from GitHub Pages and headsets
// cache hard, so a Quest running last week's build WILL try to join a
// current host. Without the gate the join succeeds and the two players
// then see different worlds, which is far worse than a refusal.
export const PROTO_VERSION = 2;

export const msg = {
  hi: (name, platform, v) => ({ t: 'hi', pv: PROTO_VERSION, name, platform, v }),
  pose: (pose) => ({ t: 'pose', ...pose }),
  welcome: (id, code, v) => ({ t: 'welcome', pv: PROTO_VERSION, id, code, v }),
};
