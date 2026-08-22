// Lobby UI as an explicit state machine (LESSONS.md: the lobby must never
// make hosting and VR entry mutually exclusive).
//
//   boot -> menu -> hosting ----\
//                -> joining -> connected -> playing
//                -> (solo) ------------------^
//
// VR entry is ORTHOGONAL to every state: #btn-vr is its own button, shown
// whenever WebXR is available, in the lobby AND in-game (vr.js owns it).
// ?uistate=<name> renders a state with representative fake data for the
// UI critic gallery; in that mode nothing is wired to the network.
const $ = (id) => document.getElementById(id);

const PANELS = ['panel-menu', 'panel-hosting', 'panel-joining', 'panel-connected', 'panel-shop', 'panel-gameover', 'panel-error'];

export class LobbyUI {
  constructor(handlers) {
    this.h = handlers;   // { onHost, onJoin(code), onSolo, onStart, onLeave }
    this.state = 'boot';
    this.locoMode = 'stationary';

    $('btn-host').addEventListener('click', () => this.h.onHost());
    $('btn-join').addEventListener('click', () => this.setState('joining'));
    $('btn-solo').addEventListener('click', () => this.h.onSolo());
    $('btn-start-host').addEventListener('click', () => this.h.onStart());
    $('btn-start-client').addEventListener('click', () => this.h.onStart());
    $('btn-back-host').addEventListener('click', () => this.h.onLeave());
    // BACK from joining must CANCEL the pending join (destroy its peer),
    // not just switch panels: an abandoned join's callbacks would fire
    // into whatever session comes next.
    $('btn-back-join').addEventListener('click', () => this.h.onLeave());
    $('btn-leave').addEventListener('click', () => this.h.onLeave());
    $('btn-error-lobby').addEventListener('click', () => {
      $('panel-error').classList.add('hidden');
      this.h.onLeave();
    });

    $('btn-join-go').addEventListener('click', () => this._submitJoin());
    $('join-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._submitJoin();
    });
    $('join-code').addEventListener('input', (e) => {
      // Only characters the room-code alphabet can actually produce
      // (no I, O, 0, 1: they are excluded to avoid misreadings).
      e.target.value = e.target.value.toUpperCase().replace(/[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g, '');
    });

    $('btn-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText($('room-code').textContent.trim());
        $('btn-copy').textContent = 'COPIED!';
        setTimeout(() => { $('btn-copy').textContent = 'COPY CODE'; }, 1500);
      } catch { /* clipboard unavailable (http, permissions) */ }
    });

    // Locomotion choice appears in both hosting and connected panels; keep
    // the two button groups in sync.
    for (const groupId of ['loco-choice-host', 'loco-choice-client']) {
      const group = $(groupId);
      group.querySelector('.loco-roomscale').addEventListener('click', () => this._setLoco('roomscale'));
      group.querySelector('.loco-stationary').addEventListener('click', () => this._setLoco('stationary'));
    }
  }

  // Disable the menu actions while a host/join attempt is in flight so a
  // second click cannot spawn a parallel session.
  setMenuBusy(busy, text = '') {
    for (const id of ['btn-host', 'btn-join', 'btn-solo']) $(id).disabled = busy;
    $('menu-status').textContent = text;
  }

  _setLoco(mode) {
    this.locoMode = mode;
    for (const groupId of ['loco-choice-host', 'loco-choice-client']) {
      const group = $(groupId);
      group.querySelector('.loco-roomscale').classList.toggle('on', mode === 'roomscale');
      group.querySelector('.loco-stationary').classList.toggle('on', mode === 'stationary');
    }
  }

  _submitJoin() {
    const code = $('join-code').value.trim().toUpperCase();
    if (code.length !== 4) {
      this.setJoinStatus('The code has 4 characters.', true);
      return;
    }
    this.h.onJoin(code);
  }

  setState(state) {
    this.state = state;
    const show = {
      menu: 'panel-menu',
      hosting: 'panel-hosting',
      joining: 'panel-joining',
      connected: 'panel-connected',
    }[state];
    for (const id of PANELS) {
      // The error overlay is managed separately, except that returning to
      // the menu always clears it (a deliberate leave must never end on a
      // stale "connection lost" screen).
      if (id === 'panel-error') {
        if (state === 'menu') $(id).classList.add('hidden');
        continue;
      }
      $(id).classList.toggle('hidden', id !== show);
    }
    $('hud').classList.toggle('hidden', state !== 'playing');
  }

  showCode(code) {
    $('room-code').textContent = code;
    $('host-status').textContent = '';
    this.setState('hosting');
  }

  setHostPlayers(names) {
    $('host-players').textContent = names.length
      ? 'In the room: you, ' + names.join(', ')
      : 'Waiting for friends... (they press JOIN A ROOM)';
  }

  setJoinStatus(text, isError = false) {
    const el = $('join-status');
    el.textContent = text;
    el.classList.toggle('error', isError);
  }

  showConnected(code) {
    $('connected-room').textContent = 'Room ' + code;
    this.setState('connected');
  }

  showError(text) {
    $('error-text').textContent = text;
    $('panel-error').classList.remove('hidden');
  }

  // ---- UI critic gallery ------------------------------------------------
  applyUIState(name) {
    for (const id of PANELS) $(id).classList.add('hidden');
    $('hud').classList.add('hidden');
    // Fake data representative of live play.
    $('room-code').textContent = 'XK42';
    $('host-players').textContent = 'In the room: you, Maja, Jack';
    $('connected-room').textContent = 'Room XK42';
    $('hud-room').textContent = 'ROOM XK42';
    $('hud-health').textContent = 'HP 80';
    $('hud-ammo').textContent = '4 / 8';
    $('hud-weapon').textContent = 'PISTOL';
    $('hud-items').textContent = 'G 1   P 1';
    $('hud-scrap').textContent = 'SCRAP 135';
    $('hud-wave').textContent = 'NIGHT 2 - 6 left';
    $('join-code').value = 'XK';
    $('join-status').textContent = 'Connecting to XK42...';
    // The gallery always shows the VR button: it must be judged in every
    // state (it is available on XR-capable devices in all of them).
    $('btn-vr').classList.remove('hidden');
    switch (name) {
      case 'lobby': $('panel-menu').classList.remove('hidden'); this.state = 'menu'; break;
      case 'hosting': $('panel-hosting').classList.remove('hidden'); this.state = 'hosting'; break;
      case 'joining': $('panel-joining').classList.remove('hidden'); this.state = 'joining'; break;
      case 'hud': $('hud').classList.remove('hidden'); this.state = 'playing'; break;
      case 'shop': $('hud').classList.remove('hidden'); $('panel-shop').classList.remove('hidden'); this.state = 'playing'; break;
      case 'gameover': $('panel-gameover').classList.remove('hidden'); this.state = 'playing'; break;
      case 'connected': $('panel-connected').classList.remove('hidden'); this.state = 'connected'; break;
      default: $('panel-menu').classList.remove('hidden'); this.state = 'menu';
    }
  }
}
