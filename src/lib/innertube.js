// Fetches description, chapters and top comments of a video through
// YouTube's internal web API (the same one youtube.com itself uses) and turns
// them into ranked tracklists. Runs in the content script and in Node.
(function (root) {
  'use strict';

  // On music.youtube.com requests must stay same-origin: YouTube rejects the
  // Origin header that extension pages (background, popup) would send.
  const onYouTube = !!(root.location && /(^|\.)youtube\.com$/.test(root.location.hostname));
  const API_BASE = (onYouTube ? root.location.origin : 'https://www.youtube.com') + '/youtubei/v1/';
  const CLIENT_VERSION = '2.20250925.01.00';
  const MAX_COMMENT_PAGES = 3;

  function timecodes() {
    return root.YTMTC && root.YTMTC.rank ? root.YTMTC : require('./timecodes.js');
  }

  // Firefox content scripts expose the page's own fetch as content.fetch, which
  // sends the page Origin; elsewhere the regular fetch already does.
  function pageFetch(url, init) {
    if (typeof content !== 'undefined' && content && typeof content.fetch === 'function' && typeof cloneInto === 'function') {
      try {
        return content.fetch(url, cloneInto(init, content));
      } catch (e) {
        // Fall through to the regular fetch.
      }
    }
    return fetch(url, init);
  }

  async function callApi(endpoint, body, opts) {
    const res = await pageFetch(API_BASE + endpoint + '?prettyPrint=false', {
      method: 'POST',
      // Anonymous requests: public data only, same as tested from scripts/probe.js.
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: {
          client: { clientName: 'WEB', clientVersion: CLIENT_VERSION, hl: opts.hl || 'en' },
        },
        ...body,
      }),
    });
    if (!res.ok) throw new Error(`YouTube API ${endpoint}: HTTP ${res.status}`);
    // Parse here rather than res.json(): in Firefox the response belongs to the page.
    return JSON.parse(await res.text());
  }

  // Depth-first walk over a JSON tree; fn(node) is called for every object.
  function walk(node, fn) {
    if (!node || typeof node !== 'object') return;
    fn(node);
    for (const key in node) walk(node[key], fn);
  }

  function runsText(obj) {
    if (!obj) return '';
    if (typeof obj.simpleText === 'string') return obj.simpleText;
    if (typeof obj.content === 'string') return obj.content;
    if (Array.isArray(obj.runs)) return obj.runs.map((r) => r.text).join('');
    return '';
  }

  function extractDescription(next) {
    let text = '';
    walk(next, (n) => {
      if (text) return;
      if (n.videoSecondaryInfoRenderer) {
        const r = n.videoSecondaryInfoRenderer;
        text = runsText(r.attributedDescription) || runsText(r.description);
      } else if (n.expandableVideoDescriptionBodyRenderer) {
        text = runsText(n.expandableVideoDescriptionBodyRenderer.attributedDescriptionBodyText);
      }
    });
    return text;
  }

  function extractTitle(next) {
    let title = '';
    walk(next, (n) => {
      if (!title && n.videoPrimaryInfoRenderer) title = runsText(n.videoPrimaryInfoRenderer.title);
    });
    return title;
  }

  function extractChapters(next) {
    const chapters = [];
    walk(next, (n) => {
      if (n.chapterRenderer) {
        const c = n.chapterRenderer;
        chapters.push({ t: Math.floor(c.timeRangeStartMillis / 1000), title: runsText(c.title) });
      }
    });
    if (chapters.length) return chapters;
    walk(next, (n) => {
      if (n.macroMarkersListItemRenderer) {
        const m = n.macroMarkersListItemRenderer;
        const t = m.onTap && m.onTap.watchEndpoint && m.onTap.watchEndpoint.startTimeSeconds;
        if (t != null) chapters.push({ t, title: runsText(m.title) });
      }
    });
    return chapters;
  }

  function findCommentsToken(next) {
    let token = null;
    walk(next, (n) => {
      if (token || !n.itemSectionRenderer) return;
      const sec = n.itemSectionRenderer;
      if (sec.sectionIdentifier !== 'comment-item-section') return;
      walk(sec.contents, (c) => {
        if (!token && c.continuationCommand) token = c.continuationCommand.token;
      });
    });
    return token;
  }

  // Parses one comments page: top-level comments plus the next page token.
  function parseCommentsPage(page) {
    const comments = [];
    const mutations =
      (page.frameworkUpdates && page.frameworkUpdates.entityBatchUpdate &&
        page.frameworkUpdates.entityBatchUpdate.mutations) || [];
    for (const m of mutations) {
      const p = m.payload && m.payload.commentEntityPayload;
      if (!p || !p.properties || p.properties.replyLevel) continue;
      comments.push({
        text: runsText(p.properties.content),
        likes: timecodes().parseCount(p.toolbar && p.toolbar.likeCountNotliked),
        author: (p.author && p.author.displayName) || '',
      });
    }
    // Older response format.
    walk(page, (n) => {
      if (!n.commentRenderer) return;
      const c = n.commentRenderer;
      comments.push({
        text: runsText(c.contentText),
        likes: timecodes().parseCount(c.voteCount && runsText(c.voteCount)),
        author: runsText(c.authorText),
      });
    });

    let nextToken = null;
    for (const ep of page.onResponseReceivedEndpoints || []) {
      const action = ep.reloadContinuationItemsCommand || ep.appendContinuationItemsAction;
      const items = (action && action.continuationItems) || [];
      const last = items[items.length - 1];
      if (last && last.continuationItemRenderer) {
        walk(last.continuationItemRenderer, (n) => {
          if (!nextToken && n.continuationCommand) nextToken = n.continuationCommand.token;
        });
      }
    }
    return { comments, nextToken };
  }

  // opts: {hl, duration (seconds, 0 if unknown), maxCommentPages}
  async function getTimecodes(videoId, opts = {}) {
    const tc = timecodes();
    const duration = opts.duration || 0;
    const next = await callApi('next', { videoId }, opts);

    const candidates = [];
    const chapters = extractChapters(next);
    if (chapters.length) candidates.push({ kind: 'chapters', entries: chapters });
    candidates.push({ kind: 'description', text: extractDescription(next) });

    // An author-provided tracklist rarely needs a deep dig through comments.
    const authorList = tc.rank(candidates, duration)[0];
    const maxPages = authorList && authorList.entries.length >= 5 ? 1 : opts.maxCommentPages || MAX_COMMENT_PAGES;

    let token = findCommentsToken(next);
    for (let page = 0; token && page < maxPages; page++) {
      let data;
      try {
        data = await callApi('next', { continuation: token }, opts);
      } catch (e) {
        break; // Comments are best-effort; keep what we have.
      }
      const parsed = parseCommentsPage(data);
      for (const c of parsed.comments) candidates.push({ kind: 'comment', ...c });
      token = parsed.nextToken;
    }

    return { videoId, title: extractTitle(next), results: tc.rank(candidates, duration).slice(0, 8) };
  }

  const api = { getTimecodes, parseCommentsPage, extractDescription, extractChapters, findCommentsToken };
  root.YTMTC = Object.assign(root.YTMTC || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
