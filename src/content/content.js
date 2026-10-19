// Content script for music.youtube.com: adds a "Timecodes" button to the
// player bar, shows the tracklist panel, highlights the current song and
// seeks on click. Also runs as a userscript (see scripts/build.js), where
// there is no extension API and page/bridge.js is bundled in directly.
(function () {
  'use strict';
  if (window.__ytmtcContent) return;
  window.__ytmtcContent = true;

  const ext = globalThis.browser || globalThis.chrome;
  // Pages expose a bare `chrome` object too, so check for the real API.
  const isExtension = !!(ext && ext.runtime && ext.runtime.getURL);
  const { formatTime, getTimecodes } = globalThis.YTMTC;

  const FALLBACKS = {
    buttonLabel: 'Timecodes',
    panelTitle: 'Timecodes',
    loading: 'Looking for timecodes…',
    notFound: 'No timecodes found in the description or top comments.',
    noVideo: 'Play something to see its timecodes.',
    error: 'Could not load timecodes: $1',
    retry: 'Try again',
    refresh: 'Reload',
    close: 'Close',
    source: 'Source',
    sourceChapters: 'Video chapters',
    sourceDescription: 'Video description',
    sourceComment: 'Comment by $1',
    loopOn: 'Repeat this track',
    loopOff: 'Stop repeating',
    likes: '$1 likes',
    tracks: '$1 tracks',
  };

  function t(key, ...subs) {
    let msg = '';
    try {
      msg = ext.i18n.getMessage(key, subs.map(String));
    } catch (e) {
      // Context invalidated after an extension reload.
    }
    if (!msg) {
      const bundled = globalThis.YTMTC.messages; // set by the userscript build
      msg = ((bundled && bundled[key]) || FALLBACKS[key] || key).replace(/\$(\d)/g, (_, i) => subs[i - 1] ?? '');
    }
    return msg;
  }

  // ---------- tiny DOM helpers (no innerHTML: YouTube enforces Trusted Types)

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v != null) el.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null) el.append(c);
    return el;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function icon(pathD) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', pathD);
    svg.append(path);
    return svg;
  }

  const ICONS = {
    list: 'M3 5h2v2H3V5zm4 0h10v2H7V5zM3 11h2v2H3v-2zm4 0h6v2H7v-2zm-4 6h2v2H3v-2zm4 0h6v2H7v-2zm10.5-6a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm-.75 2v2.81l2.1 1.26.77-1.28-1.37-.82V13h-1.5z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    repeatOne: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z',
    refresh: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  };

  // ---------- state

  const state = {
    videoId: '',
    duration: 0,
    status: 'idle', // idle | loading | ready | empty | error
    error: '',
    results: [],
    selected: 0,
    current: -1,
    loop: -1, // index of the repeated track in entries(), -1 when off
    open: false,
    bridgeSeen: false,
  };
  let requestSeq = 0;

  function entries() {
    const r = state.results[state.selected];
    return r ? r.entries : [];
  }

  function currentEntry() {
    return state.current >= 0 ? entries()[state.current] : null;
  }

  // ---------- page bridge (reads player state in the page context)

  function injectBridge() {
    if (!isExtension) return; // The userscript bundles the bridge itself.
    try {
      const s = document.createElement('script');
      s.src = ext.runtime.getURL('page/bridge.js');
      s.onload = () => {
        s.remove();
        window.postMessage({ source: 'ytmtc-content', type: 'hello' }, '*');
      };
      (document.head || document.documentElement).append(s);
    } catch (e) {
      // Fallbacks below still work without the bridge.
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'ytmtc-bridge') return;
    if (e.data.type === 'video') {
      state.bridgeSeen = true;
      setVideo(e.data.videoId, e.data.duration);
    }
  });

  function videoEl() {
    return document.querySelector('#movie_player video') || document.querySelector('video');
  }

  // Used when the bridge could not be injected.
  function detectVideoIdFallback() {
    const link = document.querySelector('#movie_player .ytp-title-link[href*="v="]');
    const href = link ? link.href : location.href;
    try {
      return new URL(href, location.href).searchParams.get('v') || '';
    } catch (e) {
      return '';
    }
  }

  function seek(time) {
    if (state.bridgeSeen) {
      window.postMessage({ source: 'ytmtc-content', type: 'seek', time }, '*');
    } else {
      const v = videoEl();
      if (v) v.currentTime = time;
    }
  }

  // ---------- data loading

  function setVideo(videoId, duration) {
    if (duration > 0) state.duration = duration;
    if (!videoId || videoId === state.videoId) return;
    state.videoId = videoId;
    state.results = [];
    state.selected = 0;
    state.current = -1;
    state.loop = -1;
    load(false);
  }

  const CACHE_SIZE = 30;
  const cache = new Map(); // videoId -> Promise<{results}>

  function fetchCached(videoId, force) {
    if (force) cache.delete(videoId);
    if (!cache.has(videoId)) {
      const v = videoEl();
      const promise = getTimecodes(videoId, {
        duration: state.duration || (v && v.duration) || 0,
        hl: document.documentElement.lang || navigator.language,
      });
      promise.catch(() => cache.delete(videoId));
      cache.set(videoId, promise);
      while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
    }
    return cache.get(videoId);
  }

  async function load(force) {
    const seq = ++requestSeq;
    state.status = 'loading';
    render();
    try {
      const data = await fetchCached(state.videoId, force);
      if (seq !== requestSeq) return;
      state.results = data.results;
      state.status = state.results.length ? 'ready' : 'empty';
    } catch (e) {
      if (seq !== requestSeq) return;
      state.status = 'error';
      state.error = String((e && e.message) || e);
    }
    state.current = -1;
    state.loop = -1;
    tick();
    render();
  }

  // ---------- UI: player bar button

  const STYLE_BUTTON = `
    :host { display: inline-flex; align-items: center; margin: 0 8px; min-width: 0; }
    :host([floating]) { position: fixed; right: 16px; bottom: 84px; z-index: 2147483000; margin: 0; }
    button {
      display: inline-flex; align-items: center; gap: 6px; max-width: 260px; min-width: 0;
      height: 32px; padding: 0 12px 0 8px; border-radius: 16px; cursor: pointer;
      border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.08); color: #fff;
      font: 500 13px/1 Roboto, "YouTube Sans", Arial, sans-serif; transition: background .15s;
    }
    :host([floating]) button { background: #212121; box-shadow: 0 4px 16px rgba(0,0,0,.5); }
    button:hover { background: rgba(255,255,255,.16); }
    button[aria-expanded="true"] { background: #fff; color: #030303; }
    button.dim { color: rgba(255,255,255,.6); }
    .icon { display: inline-flex; }
    svg { width: 20px; height: 20px; flex: none; fill: currentColor; }
    button.looping:not([aria-expanded="true"]) .icon { color: #ff4e45; }
    .label { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  `;

  const buttonHost = h('ytmtc-button');
  const buttonRoot = buttonHost.attachShadow({ mode: 'open' });
  const buttonLabel = h('span', { class: 'label' });
  const buttonIcon = h('span', { class: 'icon' });
  const button = h('button', { type: 'button', 'aria-expanded': 'false', onclick: togglePanel }, buttonIcon, buttonLabel);
  buttonRoot.append(h('style', null, STYLE_BUTTON), button);

  function mountButton() {
    const container =
      document.querySelector('ytmusic-player-bar .right-controls-buttons') ||
      document.querySelector('ytmusic-player-bar .right-controls');
    if (container) {
      if (buttonHost.parentNode !== container) {
        buttonHost.removeAttribute('floating');
        container.prepend(buttonHost);
      }
    } else if (!buttonHost.isConnected && document.body) {
      buttonHost.setAttribute('floating', '');
      document.body.append(buttonHost);
    }
  }

  function renderButton() {
    const cur = currentEntry();
    const text = cur ? cur.title : t('buttonLabel');
    if (buttonLabel.textContent !== text) buttonLabel.textContent = text;
    button.title = cur ? `${formatTime(cur.t)} · ${cur.title}` : t('panelTitle');
    button.classList.toggle('dim', state.status !== 'ready');
    const iconName = state.loop >= 0 ? 'repeatOne' : 'list';
    if (buttonIcon.dataset.name !== iconName) {
      buttonIcon.dataset.name = iconName;
      buttonIcon.replaceChildren(icon(ICONS[iconName]));
    }
    button.classList.toggle('looping', state.loop >= 0);
    button.setAttribute('aria-expanded', String(state.open));
  }

  // ---------- UI: panel

  const STYLE_PANEL = `
    :host { all: initial; }
    .panel {
      position: fixed; right: 16px; bottom: 84px; z-index: 2147483000;
      width: min(380px, calc(100vw - 32px)); max-height: min(70vh, 640px);
      display: flex; flex-direction: column; overflow: hidden;
      background: #212121; color: #fff; border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,.6); border: 1px solid rgba(255,255,255,.1);
      font: 400 14px/1.4 Roboto, "YouTube Sans", Arial, sans-serif;
    }
    .panel[hidden] { display: none; }
    header { padding: 14px 8px 10px 16px; border-bottom: 1px solid rgba(255,255,255,.1); }
    .top { display: flex; align-items: center; gap: 4px; }
    h2 { flex: 1; margin: 0; font: 600 16px/1.3 Roboto, Arial, sans-serif; }
    .now { margin: 6px 8px 0 0; color: #ff4e45; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .now:empty { display: none; }
    .meta { margin: 6px 8px 0 0; color: rgba(255,255,255,.6); font-size: 12px; display: flex; gap: 8px; align-items: center; }
    .meta:empty { display: none; }
    select {
      flex: 1; min-width: 0; background: #303030; color: #fff; border: 1px solid rgba(255,255,255,.15);
      border-radius: 6px; padding: 4px 6px; font: inherit;
    }
    .icon-btn {
      width: 36px; height: 36px; border-radius: 50%; border: 0; background: transparent; color: #fff;
      display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
    }
    .icon-btn:hover { background: rgba(255,255,255,.1); }
    .icon-btn svg { width: 20px; height: 20px; fill: currentColor; }
    ol { flex: 1; min-height: 0; list-style: none; margin: 0; padding: 6px 0; overflow-y: auto; overscroll-behavior: contain; }
    li { display: flex; align-items: center; }
    li button.track {
      flex: 1; min-width: 0; display: flex; gap: 12px; align-items: baseline; text-align: left;
      padding: 8px 16px; border: 0; background: transparent; color: rgba(255,255,255,.85);
      font: inherit; cursor: pointer;
    }
    li:hover { background: rgba(255,255,255,.08); }
    li.past button.track { color: rgba(255,255,255,.5); }
    li.current { background: rgba(255,78,69,.16); box-shadow: inset 3px 0 0 #ff4e45; }
    li.current button.track { color: #fff; font-weight: 500; }
    li .loop { flex: none; margin-right: 8px; width: 32px; height: 32px; opacity: 0; color: rgba(255,255,255,.7); }
    li:hover .loop, li .loop:focus-visible, li.looped .loop { opacity: 1; }
    li.looped .loop { color: #ff4e45; background: rgba(255,78,69,.16); }
    li .loop svg { width: 18px; height: 18px; }
    @media (hover: none) { li .loop { opacity: 1; } }
    .time { flex: none; min-width: 56px; color: rgba(255,255,255,.6); font-variant-numeric: tabular-nums; }
    li.current .time { color: #ff4e45; }
    .msg { padding: 24px 16px; color: rgba(255,255,255,.7); text-align: center; }
    .msg button {
      margin-top: 12px; padding: 8px 16px; border-radius: 18px; border: 0; cursor: pointer;
      background: #fff; color: #030303; font: 500 14px Roboto, Arial, sans-serif;
    }
  `;

  const panelHost = h('ytmtc-panel');
  const panelRoot = panelHost.attachShadow({ mode: 'open' });
  const nowEl = h('div', { class: 'now' });
  const metaEl = h('div', { class: 'meta' });
  const listEl = h('ol');
  const msgEl = h('div', { class: 'msg' });
  const panel = h(
    'section',
    { class: 'panel', hidden: '', role: 'dialog', 'aria-label': t('panelTitle') },
    h(
      'header',
      null,
      h(
        'div',
        { class: 'top' },
        h('h2', null, t('panelTitle')),
        h('button', { class: 'icon-btn', type: 'button', title: t('refresh'), onclick: () => state.videoId && load(true) }, icon(ICONS.refresh)),
        h('button', { class: 'icon-btn', type: 'button', title: t('close'), onclick: togglePanel }, icon(ICONS.close)),
      ),
      nowEl,
      metaEl,
    ),
    msgEl,
    listEl,
  );
  panelRoot.append(h('style', null, STYLE_PANEL), panel);

  function sourceName(r) {
    if (r.kind === 'chapters') return t('sourceChapters');
    if (r.kind === 'description') return t('sourceDescription');
    return t('sourceComment', r.author || '?');
  }

  function sourceDetails(r) {
    const parts = [t('tracks', r.entries.length)];
    if (r.kind === 'comment' && r.likes) parts.push(t('likes', r.likes.toLocaleString()));
    return parts.join(' · ');
  }

  function renderMeta() {
    metaEl.replaceChildren();
    if (state.status !== 'ready') return;
    if (state.results.length > 1) {
      const select = h('select', {
        'aria-label': t('source'),
        onchange: (e) => {
          state.selected = Number(e.target.value);
          state.current = -1;
          state.loop = -1;
          tick();
          render();
        },
      });
      state.results.forEach((r, i) => {
        const opt = h('option', { value: String(i) }, `${sourceName(r)} — ${sourceDetails(r)}`);
        opt.selected = i === state.selected;
        select.append(opt);
      });
      metaEl.append(select);
    } else {
      const r = state.results[0];
      metaEl.append(`${sourceName(r)} · ${sourceDetails(r)}`);
    }
  }

  function renderList() {
    listEl.replaceChildren(
      ...entries().map((e, i) =>
        h(
          'li',
          { 'data-i': String(i) },
          h(
            'button',
            { class: 'track', type: 'button', onclick: () => playTrack(i) },
            h('span', { class: 'time' }, formatTime(e.t)),
            h('span', null, e.title),
          ),
          h('button', { class: 'icon-btn loop', type: 'button', onclick: () => toggleLoop(i) }, icon(ICONS.repeatOne)),
        ),
      ),
    );
    highlight(true);
  }

  function renderMessage() {
    msgEl.replaceChildren();
    msgEl.hidden = state.status === 'ready';
    if (state.status === 'idle') msgEl.append(t('noVideo'));
    else if (state.status === 'loading') msgEl.append(t('loading'));
    else if (state.status === 'empty') msgEl.append(t('notFound'));
    else if (state.status === 'error') {
      msgEl.append(
        h('div', null, t('error', state.error)),
        h('button', { type: 'button', onclick: () => load(true) }, t('retry')),
      );
    }
  }

  function highlight(scroll) {
    const items = listEl.children;
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle('current', i === state.current);
      items[i].classList.toggle('past', i < state.current);
      items[i].classList.toggle('looped', i === state.loop);
      const loopBtn = items[i].querySelector('.loop');
      loopBtn.setAttribute('aria-pressed', String(i === state.loop));
      loopBtn.title = i === state.loop ? t('loopOff') : t('loopOn');
    }
    const cur = items[state.current];
    if (scroll && cur && state.open) {
      const top = cur.offsetTop - listEl.offsetTop;
      if (top < listEl.scrollTop || top + cur.offsetHeight > listEl.scrollTop + listEl.clientHeight) {
        listEl.scrollTop = top - listEl.clientHeight / 3;
      }
    }
    const looped = entries()[state.loop];
    const e = looped || currentEntry();
    nowEl.textContent = e ? `${looped ? '🔁' : '▶'} ${e.title}` : '';
  }

  function render() {
    renderButton();
    panel.hidden = !state.open;
    renderMessage();
    renderMeta();
    renderList();
  }

  function togglePanel() {
    state.open = !state.open;
    if (state.open && !panelHost.isConnected) document.body.append(panelHost);
    render();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.open) togglePanel();
  });

  // ---------- playback tracking and track repeat

  // Seeks issued by the loop take a moment to land; don't mistake the old
  // position for the user jumping elsewhere.
  let loopSeekUntil = 0;

  function trackBounds(i) {
    const list = entries();
    const v = videoEl();
    const duration = state.duration || (v && v.duration) || Infinity;
    // Stop short of the very end, otherwise YouTube Music moves to the next video.
    const end = i + 1 < list.length ? list[i + 1].t : duration - 1.5;
    return { start: list[i].t, end };
  }

  function playTrack(i) {
    if (state.loop >= 0 && state.loop !== i) setLoop(-1);
    seek(entries()[i].t);
    loopSeekUntil = Date.now() + 1500;
  }

  function setLoop(i) {
    state.loop = i;
    renderButton();
    highlight(false);
  }

  function toggleLoop(i) {
    if (state.loop === i) return setLoop(-1);
    setLoop(i);
    const v = videoEl();
    const { start, end } = trackBounds(i);
    if (!v || v.currentTime < start - 0.5 || v.currentTime >= end) playTrack(i);
  }

  function checkLoop(v) {
    if (state.loop < 0 || !v || !entries()[state.loop]) return;
    const { start, end } = trackBounds(state.loop);
    const now = v.currentTime;
    if (now >= end - 0.3 && now < end + 3) {
      seek(start);
      loopSeekUntil = Date.now() + 1500;
    } else if (Date.now() > loopSeekUntil && (now < start - 1.5 || now >= end + 3)) {
      setLoop(-1); // The user jumped elsewhere with the progress bar.
    }
  }

  function tick() {
    const v = videoEl();
    checkLoop(v);
    const list = entries();
    let idx = -1;
    if (v && list.length) {
      const now = v.currentTime + 0.5;
      for (let i = 0; i < list.length && list[i].t <= now; i++) idx = i;
      if (state.loop >= 0 && idx === state.loop + 1) idx = state.loop; // about to jump back
    }
    if (idx !== state.current) {
      state.current = idx;
      renderButton();
      highlight(true);
    }
  }

  function poll() {
    mountButton();
    if (!state.bridgeSeen) {
      const v = videoEl();
      setVideo(detectVideoIdFallback(), v && v.duration);
    }
  }

  injectBridge();
  render();
  setInterval(poll, 1000);
  setInterval(tick, 250);
  poll();
})();
