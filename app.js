(() => {
  // Office TV board, meant to sit on a screen for weeks.
  // One <video> plays the playlist in clips.js. One off-document warmer preloads the
  // next file and is aborted (src cleared, load()) before it is reused. Listeners,
  // timers, and leaf nodes are created once. A stuck or broken clip is skipped.
  const params = new URLSearchParams(location.search);

  function num(key, fallback, min, max) {
    if (!params.has(key)) return fallback;
    const n = Number(params.get(key));
    if (!isFinite(n)) return fallback;
    if (n < min) return min;
    if (max != null && n > max) return max;
    return n;
  }

  const maxClip = num('maxclip', 60, 10, 600);
  const stallMs = num('stall', 8, 1, 120) * 1000;
  const reloadHours = num('reload', 4, 0, 168);
  const fresh = params.get('fresh') === '1';
  const debug = params.get('debug') === '1';
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const leavesOn = params.get('leaves') !== '0' && !reduceMotion;
  const LEAF_CAP = 12;
  const FAIL_LIMIT = 3;
  const FAILURE_BACKOFF_MS = 180000;
  const HARD_EXTRA_MS = 15 * 60 * 1000;
  const HOUR_MS = 3600000;

  const stage = document.getElementById('stage');
  const vid = document.getElementById('vid');
  const bar = document.querySelector('#progress span');
  const counter = document.getElementById('counter');
  const countdown = document.getElementById('countdown');
  const pauseBtn = document.getElementById('pause');
  const soundBtn = document.getElementById('sound');

  // tg_ keys stay off the Christmas board. Both sites share the github.io origin.
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  if (!store.get('tg_since')) store.set('tg_since', String(Date.now()));
  store.set('tg_loads', String((Number(store.get('tg_loads')) || 0) + 1));

  // The muted property has to be set in script. The HTML attribute alone is not
  // enough for some TV browsers, and audible autoplay is what they block.
  vid.muted = true;
  vid.defaultMuted = true;
  vid.loop = false;
  vid.playsInline = true;
  vid.preload = 'auto';
  try { vid.disablePictureInPicture = true; } catch (e) {}
  let wantSound = false;

  function readClips() {
    const list = window.CLIPS;
    const out = [];
    if (!list || !list.length) return out;
    for (let n = 0; n < list.length; n++) {
      if (typeof list[n] === 'string' && list[n].trim()) out.push(list[n].trim());
    }
    return out;
  }

  let clips = readClips();
  if (params.get('shuffle') === '1') {
    for (let n = clips.length - 1; n > 0; n--) {
      const j = Math.floor(Math.random() * (n + 1));
      const swap = clips[n];
      clips[n] = clips[j];
      clips[j] = swap;
    }
  }

  let index = 0;
  let generation = 0;
  let expectedSrc = '';
  let paused = false;
  let failures = 0;
  let failedGen = -1;
  let retryGen = -1;
  let reloading = false;
  let releasing = false;
  let armed = false;
  let offline = typeof navigator.onLine === 'boolean' ? navigator.onLine === false : false;
  let lastGood = Date.now();
  let lastMediaTime = -1;
  let sawFrame = false;
  let clipStarted = 0;
  let wakeLock = null;
  let lastWake = 0;
  let preloader = null;
  let preloaded = '';
  let armTimer = 0;
  let failTimer = 0;
  let idleTimer = 0;
  let countdownTimer = 0;
  let rafId = 0;
  let lastFrame = 0;
  const leaves = [];
  const booted = Date.now();
  const reloadAt = reloadHours > 0 ? booted + reloadHours * HOUR_MS : 0;
  const hardAt = reloadAt ? reloadAt + HARD_EXTRA_MS : 0;

  function clock() {
    try {
      if (typeof window.__nowMs === 'function') return window.__nowMs();
    } catch (e) {}
    return Date.now();
  }

  function nowDate() {
    try {
      if (typeof window.__now === 'function') return window.__now();
    } catch (e) {}
    return new Date();
  }

  function note(msg) {
    store.set('tg_err', new Date().toLocaleTimeString() + ' ' + msg);
  }

  function labelOf(src) {
    const path = (src || '').split('?')[0];
    const parts = path.split('/');
    return parts[parts.length - 1] || src || 'clip';
  }

  function nyParts(date) {
    try {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const bits = fmt.formatToParts(date);
      const grab = (type) => {
        for (let n = 0; n < bits.length; n++) {
          if (bits[n].type === type) return Number(bits[n].value);
        }
        return 0;
      };
      return { y: grab('year'), m: grab('month'), d: grab('day') };
    } catch (e) {
      return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
    }
  }

  function activeParts() {
    const raw = params.get('date');
    if (raw) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
      if (match) return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
    }
    return nyParts(nowDate());
  }

  // Thursday, November 26, 2026. Fixed for this board; it does not roll to next year.
  const THANKSGIVING = Date.UTC(2026, 10, 26);

  function daysUntilThanksgiving(parts) {
    const today = Date.UTC(parts.y, parts.m - 1, parts.d);
    return Math.round((THANKSGIVING - today) / 86400000);
  }

  function countdownText(days) {
    if (days > 1) return days + ' DAYS UNTIL THANKSGIVING';
    if (days === 1) return '1 DAY UNTIL THANKSGIVING';
    if (days === 0) return 'HAPPY THANKSGIVING FROM 3R';
    return 'THANK YOU FOR A GREAT YEAR';
  }

  let lastMessage = '';
  function paintCountdown() {
    const text = countdownText(daysUntilThanksgiving(activeParts()));
    if (text !== lastMessage) {
      lastMessage = text;
      countdown.textContent = text;
    }
    window.__countdownChecks = (window.__countdownChecks || 0) + 1;
    publish();
  }

  // Once a minute, just after the clock minute, so midnight America/New_York
  // flips the chip on that tick instead of on a drifting multi-hour timer.
  function scheduleCountdown() {
    paintCountdown();
    const delay = 60000 - (Date.now() % 60000) + 40;
    countdownTimer = setTimeout(scheduleCountdown, delay);
  }

  window.__thanksgivingMessage = (date) => countdownText(daysUntilThanksgiving(nyParts(date)));

  function publish() {
    window.__board = {
      index: index,
      count: clips.length,
      src: clips.length ? clips[index] : '',
      paused: paused,
      days: daysUntilThanksgiving(activeParts()),
      message: countdown.textContent,
      leaves: leaves.length,
      failures: failures,
      preload: preloaded,
      offline: offline,
      videos: document.querySelectorAll('video').length
    };
  }

  function warmer() {
    if (preloader) return preloader;
    preloader = document.createElement('video');
    preloader.muted = true;
    preloader.defaultMuted = true;
    preloader.playsInline = true;
    preloader.preload = 'auto';
    preloader.setAttribute('aria-hidden', 'true');
    try { preloader.disablePictureInPicture = true; } catch (e) {}
    // Swallow preload errors. The playback element decides if a file is bad.
    preloader.addEventListener('error', () => {});
    return preloader;
  }

  function abortPreload() {
    preloaded = '';
    if (!preloader) return;
    try { preloader.pause(); } catch (e) {}
    preloader.removeAttribute('src');
    preloader.src = '';
    try { preloader.load(); } catch (e) {}
  }

  function preloadNext() {
    if (clips.length < 2) {
      abortPreload();
      return;
    }
    const next = clips[(index + 1) % clips.length];
    if (!next || next === preloaded) return;
    abortPreload();
    preloaded = next;
    warmer().src = next;
  }

  function releaseVideo() {
    releasing = true;
    armed = false;
    abortPreload();
    expectedSrc = '';
    try { vid.pause(); } catch (e) {}
    vid.classList.remove('on');
    vid.removeAttribute('src');
    try { vid.load(); } catch (e) {}
    releasing = false;
  }

  function playClip() {
    const gen = generation;
    let ret;
    try { ret = vid.play(); } catch (e) { ret = Promise.reject(e); }
    // Older TV browsers return undefined from play(). Calling .then on that throws.
    Promise.resolve(ret).then(() => {
      if (gen !== generation) return;
      if (paused) {
        try { vid.pause(); } catch (e) {}
        return;
      }
      vid.classList.add('on');
      lastGood = Date.now();
    }).catch((err) => {
      if (gen !== generation || paused || reloading) return;
      if (err && err.name === 'AbortError') return;
      // One muted retry per clip. Audible autoplay is what TV browsers reject.
      if (retryGen !== gen) {
        retryGen = gen;
        vid.muted = true;
        wantSound = false;
        soundBtn.textContent = '\uD83D\uDD07';
        soundBtn.setAttribute('aria-label', 'Turn sound on');
        playClip();
        return;
      }
      failClip('playback rejected');
    });
  }

  function safeReload(reason, nextIndex) {
    if (reloading) return;
    const failureReload = reason === 'failures';
    if (failureReload && offline) return;
    const last = Number(store.get('tg_reload_at')) || 0;
    // A clip that kills the page must not reboot the TV every few seconds.
    if (failureReload && Date.now() - last < FAILURE_BACKOFF_MS) {
      failures = 0;
      goTo(index + 1);
      return;
    }
    reloading = true;
    note(reason);
    store.set('tg_reload_at', String(Date.now()));
    store.set('tg_reason', reason);
    if (clips.length) {
      const next = nextIndex == null ? (index + 1) % clips.length : nextIndex;
      store.set('tg_next', String(next));
    }
    const url = new URL(location.href);
    url.searchParams.set('bust', String(Date.now()));
    location.replace(url.toString());
  }

  function failClip(reason) {
    if (reloading || releasing) return;
    const gen = generation;
    if (failedGen === gen) return;
    failedGen = gen;
    note(reason);
    failures += 1;
    const snapshot = failures;
    if (failTimer) clearTimeout(failTimer);
    // Leave the current call stack. error/abort can fire inside show().
    failTimer = setTimeout(() => {
      failTimer = 0;
      if (generation !== gen || reloading) return;
      if (failures < snapshot) return;
      if (failures >= FAIL_LIMIT && !offline) {
        safeReload('failures');
        return;
      }
      if (failures >= FAIL_LIMIT && offline) failures = 0;
      goTo(index + 1);
    }, 0);
  }

  function goTo(n) {
    if (reloading) return;
    if (fresh && clips.length > 1) {
      const next = ((n % clips.length) + clips.length) % clips.length;
      safeReload('fresh', next);
      return;
    }
    show(n);
  }

  function advance(manual) {
    if (!clips.length || reloading) return;
    if (!manual && reloadAt && clock() >= reloadAt) {
      safeReload('scheduled');
      return;
    }
    goTo(index + 1);
  }

  function show(n) {
    if (!clips.length) {
      showEmpty();
      return;
    }
    if (reloading) return;
    const gen = ++generation;
    armed = false;
    releaseVideo();
    index = ((n % clips.length) + clips.length) % clips.length;
    const src = clips[index];
    expectedSrc = src;
    counter.style.opacity = '';
    counter.textContent = (index + 1) + ' / ' + clips.length;
    bar.style.width = '0%';
    lastMediaTime = -1;
    sawFrame = false;
    lastGood = Date.now();
    clipStarted = lastGood;
    vid.muted = !wantSound;
    vid.src = src;
    preloadNext();
    publish();
    if (armTimer) clearTimeout(armTimer);
    armTimer = setTimeout(() => {
      armTimer = 0;
      if (generation === gen) armed = true;
    }, 0);
    if (paused) return;
    playClip();
  }

  function showEmpty() {
    releaseVideo();
    counter.textContent = window.CLIPS ? 'No clips yet' : 'Playlist missing';
    counter.style.opacity = '1';
    bar.style.width = '0%';
    publish();
  }

  function onEnded() {
    if (!armed || reloading || releasing || swapGrace()) return;
    if ((vid.getAttribute('src') || '') !== expectedSrc) return;
    failures = 0;
    failedGen = -1;
    lastGood = Date.now();
    advance(false);
  }

  function onError() {
    if (releasing || reloading) return;
    const current = vid.getAttribute('src') || '';
    if (!current || current !== expectedSrc) return;
    failClip('error');
  }

  // load() queues abort/emptied. Ignore that burst so a healthy cut is not a failure.
  function swapGrace() {
    return clipStarted > 0 && Date.now() - clipStarted < 400;
  }

  function onAbort() {
    if (!armed || releasing || reloading || paused || swapGrace()) return;
    if ((vid.getAttribute('src') || '') !== expectedSrc) return;
    failClip('abort');
  }

  function onEmptied() {
    if (!armed || releasing || reloading || paused || swapGrace()) return;
    if ((vid.getAttribute('src') || '') !== expectedSrc) return;
    failClip('emptied');
  }

  function onStalled() {
    if (!armed || releasing || reloading || paused || document.hidden) return;
    if ((vid.getAttribute('src') || '') !== expectedSrc) return;
    if (Date.now() - lastGood >= stallMs) failClip('stalled');
  }

  function onPlaying() {
    if ((vid.getAttribute('src') || '') !== expectedSrc) return;
    vid.classList.add('on');
    lastGood = Date.now();
  }

  function onTime() {
    if ((vid.getAttribute('src') || '') !== expectedSrc) return;
    // A last timeupdate from a file that already failed must not cancel the skip.
    if (vid.error) return;
    if (vid.currentTime > lastMediaTime + 0.2) {
      lastMediaTime = vid.currentTime;
      lastGood = Date.now();
      if (vid.videoWidth > 0) {
        sawFrame = true;
        failures = 0;
        failedGen = -1;
        if (failTimer) {
          clearTimeout(failTimer);
          failTimer = 0;
        }
      } else if (vid.currentTime > 1) {
        failClip('no frames');
      }
    }
  }

  vid.addEventListener('ended', onEnded);
  vid.addEventListener('error', onError);
  vid.addEventListener('abort', onAbort);
  vid.addEventListener('emptied', onEmptied);
  vid.addEventListener('stalled', onStalled);
  vid.addEventListener('playing', onPlaying);
  vid.addEventListener('timeupdate', onTime);

  function togglePause() {
    paused = !paused;
    pauseBtn.textContent = paused ? '\u25b6' : '\u2161';
    pauseBtn.setAttribute('aria-label', paused ? 'Resume slideshow' : 'Pause slideshow');
    publish();
    if (!clips.length) return;
    if (paused) {
      try { vid.pause(); } catch (e) {}
      if (reloadAt && clock() >= reloadAt) safeReload('scheduled');
      return;
    }
    lastGood = Date.now();
    playClip();
  }

  function toggleSound() {
    wantSound = !wantSound;
    vid.muted = !wantSound;
    soundBtn.textContent = vid.muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
    soundBtn.setAttribute('aria-label', vid.muted ? 'Turn sound on' : 'Turn sound off');
    if (wantSound && !paused && clips.length) playClip();
  }

  document.getElementById('next').onclick = () => advance(true);
  document.getElementById('prev').onclick = () => show(index - 1);
  pauseBtn.onclick = togglePause;
  soundBtn.onclick = (e) => {
    e.stopPropagation();
    toggleSound();
  };
  document.getElementById('full').onclick = () => {
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    if (request && request.catch) request.catch(() => {});
  };
  addEventListener('keydown', (e) => {
    const key = (e.key || '').toLowerCase();
    if (key === 'arrowright' || key === ' ') {
      e.preventDefault();
      advance(true);
    } else if (key === 'arrowleft') {
      e.preventDefault();
      show(index - 1);
    } else if (key === 'p') togglePause();
    else if (key === 'm') toggleSound();
    else if (key === 'f') document.getElementById('full').click();
  });

  function wakeCursor() {
    stage.classList.add('awake');
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = 0;
      stage.classList.remove('awake');
    }, 3000);
  }
  stage.addEventListener('mousemove', wakeCursor);
  stage.addEventListener('pointerdown', wakeCursor);

  function initLeaves() {
    if (!leavesOn || leaves.length) return;
    const fx = document.getElementById('fx');
    const colors = ['#e07a3d', '#e8c56b', '#f6edd8', '#c4552a', '#8c2f39', '#d4a04a'];
    const count = LEAF_CAP;
    for (let n = 0; n < count; n++) {
      const el = document.createElement('span');
      el.className = 'leaf';
      const w = 7 + (n % 3) * 3;
      el.style.width = w + 'px';
      el.style.height = Math.round(w * 1.45) + 'px';
      el.style.background = colors[n % colors.length];
      el.style.opacity = String(0.28 + (n % 4) * 0.08);
      fx.appendChild(el);
      leaves.push({
        el: el,
        x: (n * 8.3) % 100,
        y: (n * 17) % 110,
        speed: 6 + (n % 5) * 1.4,
        drift: (n % 2 ? 1 : -1) * (1.2 + (n % 4) * 0.4),
        rot: n * 28,
        spin: (n % 2 ? 1 : -1) * (18 + (n % 5) * 6)
      });
    }
  }

  function leafFrame(ts) {
    rafId = 0;
    if (document.hidden || leaves.length === 0) return;
    const dt = lastFrame ? Math.min(0.05, (ts - lastFrame) / 1000) : 0.016;
    lastFrame = ts;
    const count = leaves.length;
    for (let i = 0; i < count; i++) {
      const p = leaves[i];
      p.y += p.speed * dt;
      p.x += p.drift * dt;
      p.rot += p.spin * dt;
      if (p.y > 108) {
        p.y = -12;
        p.x = (i * 8.3 + p.y) % 100;
      }
      if (p.x < -8) p.x = 104;
      else if (p.x > 108) p.x = -4;
      p.el.style.transform = 'translate3d(' + p.x + 'vw,' + p.y + 'vh,0) rotate(' + p.rot + 'deg)';
    }
    rafId = requestAnimationFrame(leafFrame);
  }

  function startLeaves() {
    if (rafId || document.hidden || leaves.length === 0) return;
    lastFrame = 0;
    rafId = requestAnimationFrame(leafFrame);
  }

  function stopLeaves() {
    if (!rafId) return;
    cancelAnimationFrame(rafId);
    rafId = 0;
    lastFrame = 0;
  }

  async function wake() {
    if (!('wakeLock' in navigator) || document.hidden) return;
    try {
      if (wakeLock && !wakeLock.released) return;
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {}
  }

  function onVisible() {
    if (document.hidden) {
      stopLeaves();
      lastGood = Date.now();
      return;
    }
    startLeaves();
    wake();
    if (!paused && expectedSrc && vid.paused && !reloading) playClip();
  }

  function tick() {
    if (reloading) return;
    if (hardAt && clock() >= hardAt) {
      safeReload('hard');
      return;
    }
    if (reloadAt && clock() >= reloadAt && (paused || !clips.length)) {
      safeReload('scheduled');
      return;
    }
    const now = Date.now();
    if (paused || !clips.length || document.hidden) {
      lastGood = now;
    } else if (expectedSrc) {
      const duration = vid.duration;
      if (duration && isFinite(duration) && duration > 0) {
        bar.style.width = Math.min(100, (100 * vid.currentTime) / duration) + '%';
      }
      if (!sawFrame && vid.currentTime > 1 && vid.videoWidth === 0) failClip('no frames');
      else if (now - lastGood >= stallMs) failClip('stalled');
      else if (clipStarted && now - clipStarted >= maxClip * 1000) advance(false);
    }
    if (now - lastWake >= 60000) {
      lastWake = now;
      wake();
    }
    if (debug) paintDebug();
  }

  addEventListener('offline', () => {
    offline = true;
    publish();
  });
  addEventListener('online', () => {
    offline = false;
    publish();
    if (Date.now() - booted < 5000 || paused || !clips.length || reloading) return;
    if (vid.error || vid.networkState === 3) show(index);
    else if (expectedSrc && vid.paused) playClip();
  });

  window.onerror = (msg) => { note('error: ' + msg); };

  let dbg = null;
  function paintDebug() {
    if (!dbg) return;
    const up = Math.round((Date.now() - Number(store.get('tg_since'))) / 60000);
    dbg.textContent = 'clip: ' + (clips.length ? (index + 1) + '/' + clips.length + '  ' + labelOf(clips[index]) : 'none')
      + '\nrunning: ' + up + ' min'
      + '\npage loads: ' + store.get('tg_loads')
      + '\nfailures: ' + failures
      + '\nlast problem: ' + (store.get('tg_err') || 'none');
  }

  if (debug) {
    dbg = document.createElement('div');
    dbg.id = 'debug';
    dbg.style.cssText = 'position:fixed;left:28px;bottom:28px;z-index:9;background:rgba(26,12,12,.82);color:#f6edd8;font:16px/1.4 monospace;padding:8px 10px;border-radius:6px;white-space:pre';
    document.body.appendChild(dbg);
  }

  function startIndex() {
    if (params.has('slide')) {
      const q = Number(params.get('slide'));
      if (isFinite(q)) return Math.max(1, Math.floor(q)) - 1;
    }
    const raw = store.get('tg_next');
    if (raw) {
      const n = Number(raw);
      store.set('tg_next', '');
      if (isFinite(n) && n >= 0 && clips.length) return n % clips.length;
    }
    return 0;
  }

  initLeaves();
  startLeaves();
  scheduleCountdown();
  wake();
  document.addEventListener('visibilitychange', onVisible);
  setInterval(tick, 500);

  if (!clips.length) showEmpty();
  else show(startIndex());
})();
