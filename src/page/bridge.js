// Runs in the page's own JS context (not the extension sandbox) to read the
// YouTube player state and seek through the player API. Talks to the content
// script via window.postMessage.
(function () {
  'use strict';
  if (window.__ytmtcBridge) return;
  window.__ytmtcBridge = true;

  let lastKey = '';

  function player() {
    return document.getElementById('movie_player');
  }

  function report() {
    const p = player();
    if (!p || typeof p.getVideoData !== 'function' || p.classList.contains('ad-showing')) return;
    const data = p.getVideoData() || {};
    const duration = typeof p.getDuration === 'function' ? p.getDuration() : 0;
    const key = `${data.video_id}|${data.title}|${Math.round(duration)}`;
    if (!data.video_id || key === lastKey) return;
    lastKey = key;
    window.postMessage(
      { source: 'ytmtc-bridge', type: 'video', videoId: data.video_id, title: data.title || '', author: data.author || '', duration },
      '*',
    );
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'ytmtc-content') return;
    if (e.data.type === 'seek') {
      const p = player();
      if (p && typeof p.seekTo === 'function') p.seekTo(e.data.time, true);
    } else if (e.data.type === 'hello') {
      lastKey = '';
      report();
    }
  });

  setInterval(report, 1000);
  report();
})();
