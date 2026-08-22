// Wire protocol v1. NETCODE owns this file; every other domain conforms.
//
// Transport: PeerJS DataConnections (reliable, JSON), star topology with a
// host-authoritative server-in-a-browser.
//
// Message types
//   client -> host
//     hi     { t, name, platform, v }            once, on connect
//     pose   { t, p:[x,y,z], ry, rx, vr, h?, hl?, hr? }   ~20 Hz
//              p  = feet position (world), ry = yaw, rx = pitch
//              vr = true when in an XR session
//              h/hl/hr = head / left hand / right hand as { p:[..], q:[..] }
//     shoot  { t, o:[x,y,z], d:[x,y,z] }         fire event, ray origin + dir
//   host -> client
//     welcome { t, id, code, v, seed, level }    player id + level seed so
//                                                every peer builds identical
//                                                geometry locally
//     snap    { t, ts, players:{id:{p,ry,rx,vr,hp,down,name,h?,hl?,hr?}},
//               zs:[[id,typeIdx,x,y,z,hp],...],  compact zombie rows
//               wave:{ph,n,lv,t,left},           phase machine mirror
//               ev:[Event] }                     ~15 Hz
//   Event (inside snap.ev)
//     { e:'zhit', id } | { e:'zdie', id, type, p, scrap } | { e:'zspawn', id }
//     { e:'phit', id, hp } | { e:'down', id } | { e:'revive', id, hp }
//     { e:'day', n } | { e:'countdown', s } | { e:'night', n }
//     { e:'elevator' } | { e:'ride' } | { e:'level', index }
//     { e:'gameover', stats:{nights,kills,level} } | { e:'restart' }
//     { e:'join', id, name } | { e:'leave', id }
export const PROTO_VERSION = 1;

export const codeAlphabetCheck = (code, alphabet) =>
  code.length === 4 && [...code].every((ch) => alphabet.includes(ch));

export const msg = {
  hi: (name, platform, v) => ({ t: 'hi', name, platform, v }),
  pose: (pose) => ({ t: 'pose', ...pose }),
  shoot: (o, d) => ({ t: 'shoot', o, d }),
  welcome: (id, code, v) => ({ t: 'welcome', id, code, v }),
  snap: (ts, players, z, ev) => ({ t: 'snap', ts, players, z, ev }),
};
