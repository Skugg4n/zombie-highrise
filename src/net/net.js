// PeerJS transport: host a room or join one with a 4-character code.
// Peer id = zhr-v1-<CODE>. Host-authoritative star topology.
// Known pitfalls handled (LESSONS.md): id collision -> new code, broker
// flakiness -> clear UI errors and retry, client drop -> host cleans up.
/* global Peer */
import { CONFIG, VERSION } from '../config.js';
import { msg } from './protocol.js';

function randomCode() {
  const a = CONFIG.CODE_ALPHABET;
  let c = '';
  for (let i = 0; i < CONFIG.CODE_LENGTH; i++) c += a[Math.floor(Math.random() * a.length)];
  return c;
}

const noop = () => {};

export class Net {
  constructor() {
    this.mode = null;          // null | 'host' | 'client'
    this.peer = null;
    this.code = null;
    this.myId = null;          // 'H' for host, assigned id for clients
    this.conns = new Map();    // host: playerId -> DataConnection
    this.hostConn = null;      // client: connection to host
    this.nextClientNum = 2;    // host: P2, P3, ...
    this.established = false;  // host: broker accepted our id; client: welcomed
    // Callbacks the game wires up:
    this.onHostReady = () => {};      // (code)
    this.onPeerJoin = () => {};       // host: (id, hello)
    this.onPeerLeave = () => {};      // host: (id)
    this.onClientMessage = () => {};  // host: (id, msg)
    this.onWelcome = () => {};        // client: (welcome)
    this.onSnapshot = () => {};       // client: (snap)
    this.onError = () => {};          // (userFacingText, fatal)
    this.onDisconnected = () => {};   // client: host went away
  }

  get isHost() { return this.mode === 'host'; }
  get connected() {
    if (this.mode === 'host') return true;
    return !!(this.hostConn && this.hostConn.open);
  }

  // ---- Hosting ---------------------------------------------------------
  host(attempt = 0) {
    this.mode = 'host';
    this.myId = 'H';
    this.code = randomCode();
    const peer = new Peer(CONFIG.ROOM_PREFIX + this.code);
    this.peer = peer;

    peer.on('open', () => {
      if (peer !== this.peer) return;
      this.established = true;
      this.onHostReady(this.code);
    });
    peer.on('connection', (conn) => this._acceptClient(conn));
    peer.on('error', (err) => {
      if (peer !== this.peer) return;
      if (err.type === 'unavailable-id' && attempt < 5) {
        peer.destroy();
        this.host(attempt + 1);      // code collision: roll a new code
      } else if (err.type === 'network' || err.type === 'server-error') {
        if (this.established) {
          // Broker link lost mid-session. Existing P2P connections keep
          // working; only NEW joins are blocked. Never tear the game down.
          this.onError('Lost contact with the connection broker. Current players stay connected; new players cannot join until it returns.', false);
          try { this.peer.reconnect(); } catch { /* destroyed */ }
        } else {
          this.onError('Cannot reach the connection broker. Check your network and try again.', true);
        }
      } else if (err.type !== 'peer-unavailable') {
        this.onError('Connection error: ' + err.type, false);
      }
    });
    peer.on('disconnected', () => {
      if (peer !== this.peer) return;
      // Broker link lost; existing P2P links survive. Try to get it back
      // so new players can still join.
      try { peer.reconnect(); } catch { /* destroyed */ }
    });
  }

  _acceptClient(conn) {
    const id = 'P' + this.nextClientNum++;
    conn.on('open', () => {
      this.conns.set(id, conn);
      conn.send(msg.welcome(id, this.code, VERSION));
    });
    conn.on('data', (data) => {
      if (!data || typeof data !== 'object') return;
      if (data.t === 'hi') this.onPeerJoin(id, data);
      else this.onClientMessage(id, data);
    });
    const drop = () => {
      if (this.conns.delete(id)) this.onPeerLeave(id);
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  broadcast(m) {
    for (const conn of this.conns.values()) {
      if (conn.open) conn.send(m);
    }
  }

  // ---- Joining ---------------------------------------------------------
  join(code, hello) {
    this.mode = 'client';
    this.code = code.toUpperCase();
    const peer = new Peer();          // anonymous id from the broker
    this.peer = peer;

    peer.on('open', () => {
      if (peer !== this.peer) return;
      const conn = peer.connect(CONFIG.ROOM_PREFIX + this.code, { reliable: true });
      this.hostConn = conn;
      conn.on('open', () => { if (hello) conn.send(hello); });
      conn.on('data', (data) => {
        if (!data || typeof data !== 'object') return;
        if (data.t === 'welcome') { this.myId = data.id; this.established = true; this.onWelcome(data); }
        else if (data.t === 'snap') this.onSnapshot(data);
      });
      conn.on('close', () => this.onDisconnected());
      conn.on('error', () => this.onDisconnected());
    });
    peer.on('error', (err) => {
      if (peer !== this.peer) return;
      if (err.type === 'peer-unavailable') {
        this.onError('No room with code ' + this.code + '. Check the code and try again.', false);
      } else if (err.type === 'network' || err.type === 'server-error') {
        if (this.established) {
          // Broker gone but the P2P link to the host still works. Ignore.
          try { this.peer.reconnect(); } catch { /* destroyed */ }
        } else {
          this.onError('Cannot reach the connection broker. Check your network and try again.', true);
        }
      } else {
        this.onError('Connection error: ' + err.type, false);
      }
    });
  }

  sendToHost(m) {
    if (this.hostConn && this.hostConn.open) this.hostConn.send(m);
  }

  // ---- Common ----------------------------------------------------------
  leave() {
    // Detach every callback FIRST: peer.destroy() synchronously emits
    // 'close' on open connections (PeerJS 1.5.4), which must not surface
    // as a fake "lost connection" error after a deliberate leave.
    this.onHostReady = this.onPeerJoin = this.onPeerLeave = noop;
    this.onClientMessage = this.onWelcome = this.onSnapshot = noop;
    this.onError = this.onDisconnected = noop;
    if (this.peer) { try { this.peer.destroy(); } catch { /* already gone */ } }
    this.mode = null; this.peer = null; this.code = null; this.myId = null;
    this.conns.clear(); this.hostConn = null; this.nextClientNum = 2;
    this.established = false;
  }
}
