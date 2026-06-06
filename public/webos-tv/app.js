function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }
function _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); } _next(void 0); }); }; }
(function () {
  'use strict';

  installCompatibilityPolyfills();
  const storageKeys = {
    serverUrl: 'moontv-tv.serverUrl',
    authToken: 'moontv-tv.authToken',
    authInfo: 'moontv-tv.authInfo',
    lastQuery: 'moontv-tv.lastQuery',
    selectedResult: 'moontv-tv.selectedResult',
    selectedDetail: 'moontv-tv.selectedDetail',
    selectedEpisode: 'moontv-tv.selectedEpisode',
    subtitleMode: 'moontv-tv.subtitleMode',
    savedItemContext: 'moontv-tv.savedItemContext',
    localFavorites: 'moontv-tv.localFavorites',
    localHistory: 'moontv-tv.localHistory',
    tvDeviceId: 'moontv-tv.remoteDeviceId',
    pendingRemotePlay: 'moontv-tv.pendingRemotePlay',
    restoreAutoplay: 'moontv-tv.restoreAutoplay'
  };
  const publicAppPath = '/webos-tv/index.html';
  const state = {
    serverUrl: '',
    authToken: '',
    authInfo: null,
    results: [],
    detail: null,
    selectedResult: null,
    selectedEpisodeIndex: 0,
    playerUrl: '',
    favorites: {},
    history: {},
    savedItemContext: {},
    isHostedOnSameOrigin: false,
    subtitleMode: 'auto',
    subtitleDefaults: null,
    isResolvingPlayback: false,
    syncSupport: {
      playrecords: 'unknown',
      favorites: 'unknown'
    }
  };
  const elements = {};
  let saveProgressTimer = 0;
  let lastSavedProgressAt = 0;
  let subtitleRefreshTimer = 0;
  let subtitleFallbackRefreshTimer = 0;
  let hlsLibraryPromise = null;
  let activeHlsInstance = null;
  let activePlayerSource = '';
  let activePlayerEngine = '';
  let playerAttachToken = 0;
  let playbackResolveToken = 0;
  let hlsJsUnavailable = false;
  let forcedHlsSource = '';
  let failedHlsSource = '';
  let nativeHlsFallbackTimer = 0;
  let playerControlsOpen = true;
  let playerIdleTimer = 0;
  let playerHintTimer = 0;
  let playerDigitBuffer = '';
  let playerDigitTimer = 0;
  let lastMenuKeyAt = 0;
  let pendingAutoplay = false;
  let suppressResumeSeekForCurrentLoad = false;
  let tvRemoteSocket = null;
  let tvRemoteStateTimer = 0;
  let socketIoLibraryPromise = null;
  let startupConfig = null;
  let pendingRemotePlaybackState = null;
  let remoteDanmakuItems = [];
  let remoteDanmakuEnabled = true;
  let remoteDanmakuSettings = {
    fontSize: 30,
    opacity: 0.75
  };
  let remoteDanmakuSpawned = {};
  let remoteDanmakuLastTime = 0;
  function installCompatibilityPolyfills() {
    if (!Object.assign) {
      Object.assign = function (target) {
        if (target == null) {
          throw new TypeError('Cannot convert undefined or null to object');
        }
        const output = Object(target);
        for (let index = 1; index < arguments.length; index += 1) {
          const source = arguments[index];
          if (source == null) {
            continue;
          }
          for (const key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
              output[key] = source[key];
            }
          }
        }
        return output;
      };
    }
    if (!Object.entries) {
      Object.entries = function (value) {
        const entries = [];
        for (const key in value) {
          if (Object.prototype.hasOwnProperty.call(value, key)) {
            entries.push([key, value[key]]);
          }
        }
        return entries;
      };
    }
    if (!Array.from) {
      Array.from = function (value) {
        return Array.prototype.slice.call(value);
      };
    }
    if (!Array.prototype.find) {
      Array.prototype.find = function (predicate) {
        for (let index = 0; index < this.length; index += 1) {
          if (predicate(this[index], index, this)) {
            return this[index];
          }
        }
        return undefined;
      };
    }
    if (!String.prototype.padStart) {
      String.prototype.padStart = function (targetLength, padString) {
        const output = String(this);
        const desiredLength = Number(targetLength) || 0;
        const fillString = String(padString || ' ');
        if (output.length >= desiredLength || !fillString) {
          return output;
        }
        let padding = '';
        while (padding.length + output.length < desiredLength) {
          padding += fillString;
        }
        return padding.slice(0, desiredLength - output.length) + output;
      };
    }
    if (typeof Promise !== 'undefined' && Promise.prototype && !Promise.prototype.finally) {
      Promise.prototype.finally = function (callback) {
        const onFinally = function () {
          return callback();
        };
        return this.then(function (value) {
          return Promise.resolve(onFinally()).then(function () {
            return value;
          });
        }, function (error) {
          return Promise.resolve(onFinally()).then(function () {
            throw error;
          });
        });
      };
    }
    if (typeof Element !== 'undefined' && Element.prototype && !Element.prototype.remove) {
      Element.prototype.remove = function () {
        if (this.parentNode) {
          this.parentNode.removeChild(this);
        }
      };
    }
  }
  function init() {
    cacheElements();
    startupConfig = consumeStartupConfig();
    bindEvents();
    hydrateState();
    applyStartupConfig();
    const hasPendingRemotePlay = hasPendingRemotePlayCommand();
    renderServer();
    renderSession();
    renderHistory();
    renderFavorites();
    renderResults();
    renderDetail();
    renderEpisodes();
    renderSubtitleTracks();
    setStatus(getServerStatusMessage(), state.serverUrl && !state.isHostedOnSameOrigin ? 'error' : 'info');
    focusInitialElement();
    if (hasAuthenticatedSession()) {
      restoreAuthenticatedState();
    } else if (shouldAutoLoginFromStartupConfig()) {
      loginFromStartupConfig();
    }
    if (hasPendingRemotePlay) {
      consumePendingRemotePlayCommand(0);
    } else if (state.detail && Array.isArray(state.detail.episodes) && state.detail.episodes.length) {
      const restoreAutoplayRequest = consumeRestoreAutoplayRequest();
      const restoredEpisodeIndex = Math.max(0, Math.min(state.selectedEpisodeIndex || 0, state.detail.episodes.length - 1));
      const openRestoredSelection = function () {
        selectEpisode(restoredEpisodeIndex, false, restoreAutoplayRequest.autoplay ? {
          autoplay: true,
          resume: false
        } : undefined);
      };
      if (restoreAutoplayRequest.delayMs > 0) {
        state.isResolvingPlayback = true;
        renderPlayer();
        setStatus('Opening cast on TV...', 'info');
        window.setTimeout(openRestoredSelection, restoreAutoplayRequest.delayMs);
      } else {
        openRestoredSelection();
      }
    } else {
      renderPlayer();
    }
    startTVRemoteReceiver();
  }
  function cacheElements() {
    elements.serverForm = document.getElementById('server-form');
    elements.serverUrl = document.getElementById('server-url');
    elements.openServerButton = document.getElementById('open-server-button');
    elements.serverBadge = document.getElementById('server-badge');
    elements.loginForm = document.getElementById('login-form');
    elements.username = document.getElementById('username');
    elements.password = document.getElementById('password');
    elements.searchForm = document.getElementById('search-form');
    elements.searchInput = document.getElementById('search-input');
    elements.resultsGrid = document.getElementById('results-grid');
    elements.resultsSummary = document.getElementById('results-summary');
    elements.detailPanel = document.getElementById('detail-panel');
    elements.detailPoster = document.getElementById('detail-poster');
    elements.detailSource = document.getElementById('detail-source');
    elements.detailTitle = document.getElementById('detail-title');
    elements.detailMeta = document.getElementById('detail-meta');
    elements.detailDesc = document.getElementById('detail-desc');
    elements.favoriteButton = document.getElementById('favorite-button');
    elements.resumeButton = document.getElementById('resume-button');
    elements.historyGrid = document.getElementById('history-grid');
    elements.historySummary = document.getElementById('history-summary');
    elements.favoritesGrid = document.getElementById('favorites-grid');
    elements.favoritesSummary = document.getElementById('favorites-summary');
    elements.episodeGrid = document.getElementById('episode-grid');
    elements.episodeSummary = document.getElementById('episode-summary');
    elements.playerPanel = document.getElementById('player-panel');
    elements.playerShell = document.getElementById('player-shell');
    elements.player = document.getElementById('player');
    elements.playerDanmakuLayer = document.getElementById('player-danmaku-layer');
    elements.playerSummary = document.getElementById('player-summary');
    elements.playerOverlayTitle = document.getElementById('player-overlay-title');
    elements.playerEngineBadge = document.getElementById('player-engine-badge');
    elements.playerCenterHint = document.getElementById('player-center-hint');
    elements.playerDigitHint = document.getElementById('player-digit-hint');
    elements.playerProgressFill = document.getElementById('player-progress-fill');
    elements.playerCurrentTime = document.getElementById('player-current-time');
    elements.playerDuration = document.getElementById('player-duration');
    elements.playerPlayButton = document.getElementById('player-play-button');
    elements.playerBackwardButton = document.getElementById('player-backward-button');
    elements.playerForwardButton = document.getElementById('player-forward-button');
    elements.playerVolumeDownButton = document.getElementById('player-volume-down-button');
    elements.playerVolumeUpButton = document.getElementById('player-volume-up-button');
    elements.subtitleGrid = document.getElementById('subtitle-grid');
    elements.subtitleSummary = document.getElementById('subtitle-summary');
    elements.statusPanel = document.getElementById('status-panel');
    elements.logoutButton = document.getElementById('logout-button');
    elements.sessionSummary = document.getElementById('session-summary');
  }
  function bindEvents() {
    elements.serverForm.addEventListener('submit', onSaveServer);
    elements.openServerButton.addEventListener('click', onOpenServer);
    elements.loginForm.addEventListener('submit', onLogin);
    elements.searchForm.addEventListener('submit', onSearch);
    elements.logoutButton.addEventListener('click', onLogout);
    elements.favoriteButton.addEventListener('click', onToggleFavorite);
    elements.resumeButton.addEventListener('click', onResumeFromRecord);
    bindPlayerEvents(elements.player);
    elements.playerPlayButton.addEventListener('click', togglePlayerPlayback);
    elements.playerBackwardButton.addEventListener('click', function () {
      seekPlayerBy(-10, true);
    });
    elements.playerForwardButton.addEventListener('click', function () {
      seekPlayerBy(10, true);
    });
    elements.playerVolumeDownButton.addEventListener('click', function () {
      changePlayerVolume(-0.05);
    });
    elements.playerVolumeUpButton.addEventListener('click', function () {
      changePlayerVolume(0.05);
    });
    document.addEventListener('keydown', onGlobalKeyDown);
  }
  function bindPlayerEvents(player) {
    if (!player) {
      return;
    }
    player.addEventListener('loadstart', onPlayerLoadStart);
    player.addEventListener('timeupdate', onPlayerTimeUpdate);
    player.addEventListener('loadedmetadata', onPlayerLoadedMetadata);
    player.addEventListener('ended', onPlayerEnded);
    player.addEventListener('pause', onPlayerPause);
    player.addEventListener('error', onPlayerError);
    player.addEventListener('play', onPlayerStateChange);
    player.addEventListener('playing', onPlayerStateChange);
    player.addEventListener('volumechange', onPlayerStateChange);
    player.addEventListener('durationchange', updatePlayerOverlay);
    player.addEventListener('click', onPlayerClick);
  }
  function unbindPlayerEvents(player) {
    if (!player) {
      return;
    }
    player.removeEventListener('loadstart', onPlayerLoadStart);
    player.removeEventListener('timeupdate', onPlayerTimeUpdate);
    player.removeEventListener('loadedmetadata', onPlayerLoadedMetadata);
    player.removeEventListener('ended', onPlayerEnded);
    player.removeEventListener('pause', onPlayerPause);
    player.removeEventListener('error', onPlayerError);
    player.removeEventListener('play', onPlayerStateChange);
    player.removeEventListener('playing', onPlayerStateChange);
    player.removeEventListener('volumechange', onPlayerStateChange);
    player.removeEventListener('durationchange', updatePlayerOverlay);
    player.removeEventListener('click', onPlayerClick);
  }
  function onPlayerClick() {
    togglePlayerPlayback();
  }
  function hydrateState() {
    state.serverUrl = normalizeServerUrl(localStorage.getItem(storageKeys.serverUrl) || deriveHostedServerUrl());
    state.authToken = localStorage.getItem(storageKeys.authToken) || '';
    try {
      state.authInfo = JSON.parse(localStorage.getItem(storageKeys.authInfo) || 'null');
      state.selectedResult = JSON.parse(localStorage.getItem(storageKeys.selectedResult) || 'null');
      state.detail = JSON.parse(localStorage.getItem(storageKeys.selectedDetail) || 'null');
    } catch (error) {
      state.authInfo = null;
      state.selectedResult = null;
      state.detail = null;
    }
    try {
      state.savedItemContext = normalizeSavedItemContextMap(JSON.parse(localStorage.getItem(storageKeys.savedItemContext) || '{}'));
    } catch (error) {
      state.savedItemContext = {};
    }
    state.selectedEpisodeIndex = parseInt(localStorage.getItem(storageKeys.selectedEpisode) || '0', 10);
    state.subtitleMode = normalizeSubtitleMode(localStorage.getItem(storageKeys.subtitleMode) || 'auto');
    elements.serverUrl.value = state.serverUrl;
    elements.searchInput.value = localStorage.getItem(storageKeys.lastQuery) || '';
    state.isHostedOnSameOrigin = computeSameOrigin();
    if (state.selectedResult && state.selectedResult.source && state.selectedResult.id) {
      rememberSavedItemContext({
        source: state.selectedResult.source,
        id: state.selectedResult.id,
        title: state.selectedResult.title,
        searchTitle: state.selectedResult.searchTitle || state.selectedResult.title,
        fileName: state.selectedResult.fileName
      });
    }
    if (hydrateAuthState()) {
      persistSession();
    }
    if (hasAuthenticatedSession()) {
      if (state.syncSupport.playrecords === 'unsupported') {
        state.history = loadLocalSyncCache('playrecords');
      }
      if (state.syncSupport.favorites === 'unsupported') {
        state.favorites = loadLocalSyncCache('favorites');
      }
    }
  }
  function consumeStartupConfig() {
    const hash = String(window.location.hash || '');
    const prefix = '#moontv-config=';
    let payload = '';
    if (hash.indexOf(prefix) !== 0) {
      return null;
    }
    payload = hash.slice(prefix.length);
    clearStartupConfigHash();
    try {
      return JSON.parse(decodeBase64Url(decodeURIComponent(payload)));
    } catch (error) {
      return null;
    }
  }
  function clearStartupConfigHash() {
    if (window.history && window.history.replaceState) {
      try {
        window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
        if (!window.location.hash) {
          return;
        }
      } catch (error) {}
    }
    window.location.replace(window.location.href.replace(/#.*$/, ''));
  }
  function decodeBase64Url(value) {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + new Array((4 - normalized.length % 4) % 4 + 1).join('=');
    return decodeURIComponent(escape(window.atob(padded)));
  }
  function applyStartupConfig() {
    if (!startupConfig || typeof startupConfig !== 'object') {
      return;
    }
    const serverUrl = normalizeStartupServerUrl(startupConfig.serverUrl || deriveHostedServerUrl());
    const username = String(startupConfig.username || '').trim();
    const password = String(startupConfig.password || '');
    if (serverUrl) {
      state.serverUrl = serverUrl;
      elements.serverUrl.value = serverUrl;
      state.isHostedOnSameOrigin = computeSameOrigin();
      localStorage.setItem(storageKeys.serverUrl, state.serverUrl);
    }
    if (username) {
      elements.username.value = username;
    }
    if (password) {
      elements.password.value = password;
    }
  }
  function shouldAutoLoginFromStartupConfig() {
    return Boolean(startupConfig && typeof startupConfig === 'object' && String(startupConfig.password || '') && state.serverUrl && state.isHostedOnSameOrigin);
  }
  function normalizeStartupServerUrl(value) {
    const normalized = normalizeServerUrl(value);
    const suffix = publicAppPath.replace(/\/+$/, '');
    if (normalized.slice(-suffix.length) === suffix) {
      return normalizeServerUrl(normalized.slice(0, -suffix.length));
    }
    return normalized;
  }
  function normalizeServerUrl(value) {
    return (value || '').trim().replace(/\/+$/, '');
  }
  function deriveHostedServerUrl() {
    const origin = getCurrentOrigin();
    if (!origin || origin === 'null' || /^file:/i.test(origin)) {
      return '';
    }
    return normalizeServerUrl(origin);
  }
  function computeSameOrigin() {
    if (!state.serverUrl) {
      return false;
    }
    try {
      return getOriginFromUrl(state.serverUrl) === getCurrentOrigin();
    } catch (error) {
      return false;
    }
  }
  function getCurrentOrigin() {
    if (window.location.origin) {
      return window.location.origin;
    }
    return window.location.protocol + '//' + window.location.host;
  }
  function getOriginFromUrl(value) {
    const anchor = document.createElement('a');
    anchor.href = String(value || '');
    if (!anchor.protocol || !anchor.host) {
      return '';
    }
    return anchor.protocol + '//' + anchor.host;
  }
  function buildHostedFrontendUrl() {
    const origin = getOriginFromUrl(state.serverUrl) || state.serverUrl;
    if (!origin) {
      return publicAppPath;
    }
    return normalizeServerUrl(origin) + publicAppPath;
  }
  function buildSameOriginRequiredMessage() {
    return 'MoonTVPlus TV must be served from the same origin. Deploy it at ' + buildHostedFrontendUrl() + ' and reopen it there.';
  }
  function getServerStatusMessage() {
    if (!state.serverUrl) {
      return 'Configure the MoonTVPlus URL, then sign in.';
    }
    if (!state.isHostedOnSameOrigin) {
      return buildSameOriginRequiredMessage();
    }
    return 'MoonTVPlus origin detected. Sign in to continue.';
  }
  function isUnsupportedSyncError(error) {
    return Boolean(error && error.message === 'Internal Server Error');
  }
  function isSyncFeatureAvailable(feature) {
    return state.syncSupport[feature] !== 'unsupported';
  }
  function buildSyncUnavailableMessage(feature) {
    return feature === 'favorites' ? 'Favorites are stored locally on this TV because MoonTVPlus sync is unavailable.' : 'Play history is stored locally on this TV because MoonTVPlus sync is unavailable.';
  }
  function markSyncFeatureUnsupported(feature) {
    if (state.syncSupport[feature] === 'unsupported') {
      return;
    }
    state.syncSupport[feature] = 'unsupported';
    renderHistory();
    renderFavorites();
    renderDetail();
  }
  function buildUserScopedStorageKey(baseKey) {
    const username = state.authInfo && state.authInfo.username ? String(state.authInfo.username).trim() : 'anonymous';
    return baseKey + '.' + username;
  }
  function readJsonStorage(baseKey, fallbackValue) {
    try {
      const rawValue = localStorage.getItem(baseKey);
      return rawValue ? JSON.parse(rawValue) : fallbackValue;
    } catch (error) {
      return fallbackValue;
    }
  }
  function loadLocalSyncCache(feature) {
    const baseKey = feature === 'favorites' ? storageKeys.localFavorites : storageKeys.localHistory;
    const parsed = readJsonStorage(buildUserScopedStorageKey(baseKey), {});
    return parsed && typeof parsed === 'object' ? parsed : {};
  }
  function persistLocalSyncCache(feature) {
    const baseKey = feature === 'favorites' ? storageKeys.localFavorites : storageKeys.localHistory;
    const value = feature === 'favorites' ? state.favorites : state.history;
    if (value && Object.keys(value).length) {
      localStorage.setItem(buildUserScopedStorageKey(baseKey), JSON.stringify(value));
    } else {
      localStorage.removeItem(buildUserScopedStorageKey(baseKey));
    }
  }
  function clearLocalSyncCache(feature) {
    const baseKey = feature === 'favorites' ? storageKeys.localFavorites : storageKeys.localHistory;
    localStorage.removeItem(buildUserScopedStorageKey(baseKey));
  }
  function normalizeSubtitleMode(value) {
    const normalized = String(value || '').trim();
    return normalized || 'auto';
  }
  function getBrowserCookieValue(name) {
    const target = String(name || '').trim();
    if (!target || typeof document === 'undefined') {
      return '';
    }
    const prefix = target + '=';
    const match = document.cookie.split(';').map(function (part) {
      return part.trim();
    }).find(function (part) {
      return part.indexOf(prefix) === 0;
    });
    return match ? match.slice(prefix.length) : '';
  }
  function decodeAuthToken(value) {
    let decoded = String(value || '');
    if (!decoded) {
      return '';
    }
    try {
      decoded = decodeURIComponent(decoded);
    } catch (error) {
      decoded = String(value || '');
    }
    if (decoded.indexOf('%') !== -1) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch (error) {
        decoded = decoded;
      }
    }
    return decoded;
  }
  function parseAuthToken(value) {
    const decoded = decodeAuthToken(value);
    if (!decoded) {
      return null;
    }
    try {
      return JSON.parse(decoded);
    } catch (error) {
      return null;
    }
  }
  function sanitizeAuthInfo(authInfo) {
    if (!authInfo || typeof authInfo !== 'object') {
      return null;
    }
    const sanitized = Object.assign({}, authInfo);
    delete sanitized.password;
    return sanitized;
  }
  function syncAuthStateFromReadableCookie() {
    if (!state.isHostedOnSameOrigin) {
      return false;
    }
    const authCookieValue = getBrowserCookieValue('auth');
    if (!authCookieValue) {
      return false;
    }
    const parsed = sanitizeAuthInfo(parseAuthToken(authCookieValue));
    if (!parsed) {
      return false;
    }
    let changed = false;
    if (!state.authToken) {
      state.authToken = authCookieValue;
      changed = true;
    }
    if (!state.authInfo) {
      state.authInfo = parsed;
      changed = true;
    }
    return changed;
  }
  function hydrateAuthState() {
    let changed = false;
    if (!state.authInfo && state.authToken) {
      const parsed = sanitizeAuthInfo(parseAuthToken(state.authToken));
      if (parsed) {
        state.authInfo = parsed;
        changed = true;
      }
    }
    if (syncAuthStateFromReadableCookie()) {
      changed = true;
    }
    return changed;
  }
  function getSessionToken() {
    if (state.authToken) {
      return state.authToken;
    }
    if (state.isHostedOnSameOrigin) {
      return getBrowserCookieValue('auth');
    }
    return '';
  }
  function hasAuthenticatedSession() {
    return Boolean(getSessionToken());
  }
  function setStatus(message, tone) {
    elements.statusPanel.textContent = message;
    elements.statusPanel.className = 'status-panel';
    if (tone === 'good') {
      elements.statusPanel.classList.add('status-good');
    }
    if (tone === 'error') {
      elements.statusPanel.classList.add('status-error');
    }
  }
  function persistSession() {
    if (state.authToken) {
      localStorage.setItem(storageKeys.authToken, state.authToken);
    } else {
      localStorage.removeItem(storageKeys.authToken);
    }
    if (state.authInfo) {
      localStorage.setItem(storageKeys.authInfo, JSON.stringify(state.authInfo));
    } else {
      localStorage.removeItem(storageKeys.authInfo);
    }
  }
  function persistSelection() {
    if (state.selectedResult) {
      localStorage.setItem(storageKeys.selectedResult, JSON.stringify(state.selectedResult));
    } else {
      localStorage.removeItem(storageKeys.selectedResult);
    }
    if (state.detail) {
      localStorage.setItem(storageKeys.selectedDetail, JSON.stringify(state.detail));
    } else {
      localStorage.removeItem(storageKeys.selectedDetail);
    }
    localStorage.setItem(storageKeys.selectedEpisode, String(state.selectedEpisodeIndex || 0));
  }
  function persistSavedItemContext() {
    if (Object.keys(state.savedItemContext || {}).length) {
      localStorage.setItem(storageKeys.savedItemContext, JSON.stringify(state.savedItemContext));
      return;
    }
    localStorage.removeItem(storageKeys.savedItemContext);
  }
  function restoreAuthenticatedState() {
    return _restoreAuthenticatedState.apply(this, arguments);
  }
  function _restoreAuthenticatedState() {
    _restoreAuthenticatedState = _asyncToGenerator(function* () {
      try {
        const syncIssues = yield refreshUserData();
        setStatus(syncIssues.length ? 'Session restored. ' + syncIssues.join(' ') : 'Session restored.', syncIssues.length ? 'info' : 'good');
      } catch (error) {
        setStatus('Saved session found, but user data refresh failed.', 'error');
      }
    });
    return _restoreAuthenticatedState.apply(this, arguments);
  }
  function renderServer() {
    elements.serverBadge.textContent = state.serverUrl ? state.isHostedOnSameOrigin ? 'Same-origin mode' : 'Wrong origin' : 'Not connected';
  }
  function renderSession() {
    if (state.serverUrl && !state.isHostedOnSameOrigin) {
      elements.logoutButton.classList.add('hidden');
      elements.sessionSummary.textContent = buildSameOriginRequiredMessage();
      return;
    }
    const loggedIn = hasAuthenticatedSession();
    elements.logoutButton.classList.toggle('hidden', !loggedIn);
    if (!loggedIn) {
      elements.sessionSummary.textContent = 'No active session.';
      return;
    }
    const username = state.authInfo && state.authInfo.username ? state.authInfo.username : 'authenticated';
    const role = state.authInfo && state.authInfo.role ? state.authInfo.role : 'user';
    elements.sessionSummary.textContent = 'Logged in as ' + username + ' (' + role + ').';
  }
  function renderDetail() {
    if (!state.detail) {
      elements.detailPanel.classList.add('hidden');
      elements.resumeButton.classList.add('hidden');
      return;
    }
    elements.detailPanel.classList.remove('hidden');
    elements.detailPoster.src = state.detail.poster || buildFallbackPoster();
    elements.detailPoster.alt = state.detail.title || '';
    elements.detailSource.textContent = state.detail.source_name || state.detail.source || 'Source';
    elements.detailTitle.textContent = state.detail.title || 'Untitled';
    elements.detailMeta.textContent = [state.detail.year || 'Unknown year', state.detail.type_name || 'Video', Array.isArray(state.detail.episodes_titles) ? state.detail.episodes_titles.length + ' episodes' : null].filter(Boolean).join(' • ');
    elements.detailDesc.textContent = state.detail.desc || 'MoonTVPlus did not return a synopsis for this title.';
    const favoriteKey = buildStorageKey(state.detail.source, state.detail.id);
    const isFavorited = Boolean(state.favorites[favoriteKey]);
    elements.favoriteButton.disabled = false;
    elements.favoriteButton.textContent = isFavorited ? 'Remove Favorite' : 'Add Favorite';
    const record = state.history[favoriteKey];
    elements.resumeButton.classList.toggle('hidden', !record);
  }
  function renderHistory() {
    elements.historyGrid.innerHTML = '';
    const entries = Object.entries(state.history).sort(function (left, right) {
      return (right[1].save_time || 0) - (left[1].save_time || 0);
    });
    if (!isSyncFeatureAvailable('playrecords')) {
      elements.historySummary.textContent = entries.length ? entries.length + ' local items. Sync unavailable.' : buildSyncUnavailableMessage('playrecords');
    } else {
      elements.historySummary.textContent = entries.length ? entries.length + ' saved items' : 'No history loaded.';
    }
    entries.slice(0, 8).forEach(function (entry) {
      const key = entry[0];
      const record = entry[1];
      const button = createLibraryCard({
        key: key,
        title: record.title,
        poster: record.cover,
        meta: [record.source_name, record.year].filter(Boolean).join(' • '),
        tagline: 'Episode ' + record.index + ' • ' + formatTime(record.play_time),
        onClick: function () {
          openLibraryItem(key, record, Math.max(0, (record.index || 1) - 1));
        }
      });
      elements.historyGrid.appendChild(button);
    });
  }
  function renderFavorites() {
    elements.favoritesGrid.innerHTML = '';
    const entries = Object.entries(state.favorites).sort(function (left, right) {
      return (right[1].save_time || 0) - (left[1].save_time || 0);
    });
    if (!isSyncFeatureAvailable('favorites')) {
      elements.favoritesSummary.textContent = entries.length ? entries.length + ' local titles. Sync unavailable.' : buildSyncUnavailableMessage('favorites');
    } else {
      elements.favoritesSummary.textContent = entries.length ? entries.length + ' saved titles' : 'No favorites loaded.';
    }
    entries.slice(0, 8).forEach(function (entry) {
      const key = entry[0];
      const favorite = entry[1];
      const button = createLibraryCard({
        key: key,
        title: favorite.title,
        poster: favorite.cover,
        meta: [favorite.source_name, favorite.year].filter(Boolean).join(' • '),
        tagline: favorite.total_episodes ? favorite.total_episodes + ' episodes' : 'Favorite',
        onClick: function () {
          openLibraryItem(key, favorite, 0);
        }
      });
      elements.favoritesGrid.appendChild(button);
    });
  }
  function renderResults() {
    elements.resultsGrid.innerHTML = '';
    if (!state.results.length) {
      elements.resultsSummary.textContent = 'No results loaded.';
      return;
    }
    elements.resultsSummary.textContent = state.results.length + ' titles';
    state.results.forEach(function (item, index) {
      const button = createCardButton(item.title, item.poster, [item.source_name || item.source, item.year || 'Unknown year', Array.isArray(item.episodes_titles) ? item.episodes_titles.length + ' episodes' : null].filter(Boolean).join(' • '));
      button.dataset.index = String(index);
      button.classList.toggle('is-active', Boolean(state.selectedResult) && state.selectedResult.source === item.source && state.selectedResult.id === item.id);
      button.addEventListener('click', function () {
        onSelectResult(index);
      });
      elements.resultsGrid.appendChild(button);
    });
  }
  function renderEpisodes() {
    elements.episodeGrid.innerHTML = '';
    if (!state.detail || !Array.isArray(state.detail.episodes) || !state.detail.episodes.length) {
      elements.episodeSummary.textContent = 'Select a title to browse episodes.';
      return;
    }
    elements.episodeSummary.textContent = state.detail.episodes.length + ' playable items from ' + (state.detail.source_name || state.detail.source);
    state.detail.episodes.forEach(function (_episodeUrl, index) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'episode-button is-focus-anchor';
      button.dataset.index = String(index);
      if (index === state.selectedEpisodeIndex) {
        button.classList.add('is-active');
      }
      const title = Array.isArray(state.detail.episodes_titles) && state.detail.episodes_titles[index] ? state.detail.episodes_titles[index] : 'Episode ' + String(index + 1);
      button.textContent = title;
      button.addEventListener('click', function () {
        selectEpisode(index);
      });
      elements.episodeGrid.appendChild(button);
    });
  }
  function renderPlayer() {
    if (!state.playerUrl) {
      elements.playerSummary.textContent = state.isResolvingPlayback ? 'Resolving playback URL...' : 'Choose an episode to start playback.';
      elements.playerOverlayTitle.textContent = state.isResolvingPlayback ? 'Preparing stream...' : 'No episode selected';
      elements.playerEngineBadge.textContent = state.isResolvingPlayback ? 'Loading' : 'Idle';
      if (elements.playerShell) {
        elements.playerShell.dataset.playerMode = state.isResolvingPlayback ? 'loading' : 'idle';
      }
      if (state.isResolvingPlayback) {
        setPlayerHint('Loading', 0);
      } else {
        hidePlayerHint();
      }
      updatePlayerOverlay();
      if (!state.isResolvingPlayback) {
        teardownPlayerSource();
        removeManagedSubtitleTracks();
        resetSubtitleDefaults();
        renderSubtitleTracks();
      }
      return;
    }
    const title = state.detail && Array.isArray(state.detail.episodes_titles) && state.detail.episodes_titles[state.selectedEpisodeIndex] ? state.detail.episodes_titles[state.selectedEpisodeIndex] : 'Selected episode';
    elements.playerSummary.textContent = title;
    elements.playerOverlayTitle.textContent = title;
    elements.playerEngineBadge.textContent = shouldUseHlsJs(state.playerUrl) ? 'HLS' : 'Native';
    hidePlayerHint();
    const subtitleTracksChanged = syncManagedSubtitleTracks();
    const nextPlayerEngine = shouldUseHlsJs(state.playerUrl) ? 'hls' : 'native';
    if (activePlayerSource !== state.playerUrl || activePlayerEngine !== nextPlayerEngine) {
      resetSubtitleDefaults();
      attachPlayerSource(state.playerUrl).then(function () {
        if (pendingAutoplay) {
          if (shouldWaitForMetadataBeforeAutoplay()) {
            return;
          }
          pendingAutoplay = false;
          playPlayerSoon();
        }
      }).catch(function (error) {
        pendingAutoplay = false;
        setStatus(error.message || 'Playback setup failed.', 'error');
      });
    } else if (subtitleTracksChanged) {
      resetSubtitleDefaults();
      scheduleSubtitleRefresh();
      if (pendingAutoplay) {
        if (!shouldWaitForMetadataBeforeAutoplay()) {
          pendingAutoplay = false;
          playPlayerSoon();
        }
      }
    } else if (pendingAutoplay) {
      if (!shouldWaitForMetadataBeforeAutoplay()) {
        pendingAutoplay = false;
        playPlayerSoon();
      }
    }
    renderSubtitleTracks();
    updatePlayerOverlay();
  }
  function renderSubtitleTracks() {
    elements.subtitleGrid.innerHTML = '';
    if (!state.playerUrl) {
      elements.subtitleSummary.textContent = 'Choose an episode to inspect subtitle tracks.';
      return;
    }
    const tracks = getPlayerTextTracks();
    if (!tracks.length) {
      elements.subtitleSummary.textContent = elements.player.readyState < 1 ? 'Loading subtitle tracks...' : 'No subtitle tracks detected for this stream.';
      return;
    }
    const activeTrack = getActiveSubtitleTrack(tracks);
    const activeKey = activeTrack ? buildSubtitleTrackKey(activeTrack) : '';
    const activeIndex = activeTrack ? tracks.indexOf(activeTrack) : -1;
    elements.subtitleGrid.appendChild(createSubtitleButton('Auto', state.subtitleMode === 'auto', function () {
      setSubtitleMode('auto');
    }));
    elements.subtitleGrid.appendChild(createSubtitleButton('Off', state.subtitleMode === 'off', function () {
      setSubtitleMode('off');
    }));
    tracks.forEach(function (track, index) {
      const key = buildSubtitleTrackKey(track);
      elements.subtitleGrid.appendChild(createSubtitleButton(describeTextTrack(track, index), activeKey === key, function () {
        setSubtitleMode(key);
      }));
    });
    if (activeTrack) {
      elements.subtitleSummary.textContent = state.subtitleMode === 'auto' ? 'Auto mode selected ' + describeTextTrack(activeTrack, activeIndex) + '.' : 'Showing ' + describeTextTrack(activeTrack, activeIndex) + '.';
      return;
    }
    if (state.subtitleMode === 'off') {
      elements.subtitleSummary.textContent = 'Subtitles are off.';
      return;
    }
    if (state.subtitleMode === 'auto') {
      elements.subtitleSummary.textContent = 'Auto mode is enabled. No default subtitle track is active.';
      return;
    }
    elements.subtitleSummary.textContent = 'Saved subtitle preference is unavailable for this stream.';
  }
  function createSubtitleButton(label, active, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'episode-button subtitle-button is-focus-anchor';
    button.textContent = label;
    if (active) {
      button.classList.add('is-active');
    }
    button.addEventListener('click', onClick);
    return button;
  }
  function getPlayerTextTracks() {
    return Array.from(elements.player.textTracks || []);
  }
  function getEpisodeSubtitleEntries() {
    if (!state.detail || !Array.isArray(state.detail.subtitles)) {
      return [];
    }
    const episodeSubtitles = state.detail.subtitles[state.selectedEpisodeIndex];
    if (!Array.isArray(episodeSubtitles)) {
      return [];
    }
    return episodeSubtitles.filter(function (item) {
      return item && typeof item.url === 'string' && item.url.trim();
    }).map(function (item, index) {
      const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : 'Subtitle ' + String(index + 1);
      return {
        label: label,
        language: normalizeSubtitleLanguage(item.language),
        url: resolveMediaResourceUrl(item.url)
      };
    });
  }
  function normalizeSubtitleLanguage(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(normalized)) {
      return normalized;
    }
    return 'und';
  }
  function resolveMediaResourceUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }
    if (/^(https?:|data:|blob:)/i.test(raw)) {
      return raw;
    }
    try {
      return resolveAbsoluteUrl(raw, state.serverUrl || getCurrentOrigin());
    } catch (error) {
      return buildUrl(raw);
    }
  }
  function resolveAbsoluteUrl(rawValue, baseUrl) {
    const raw = String(rawValue || '').trim();
    const base = document.createElement('a');
    const resolved = document.createElement('a');
    let basePath = '';
    if (!raw) {
      return '';
    }
    base.href = String(baseUrl || getCurrentOrigin()).replace(/\/?$/, '/');
    basePath = base.pathname || '/';
    if (basePath.charAt(basePath.length - 1) !== '/') {
      basePath = basePath.replace(/[^/]*$/, '/');
    }
    if (raw.indexOf('//') === 0) {
      resolved.href = base.protocol + raw;
      return resolved.href;
    }
    if (raw.charAt(0) === '/') {
      resolved.href = base.protocol + '//' + base.host + raw;
      return resolved.href;
    }
    resolved.href = base.protocol + '//' + base.host + basePath + raw;
    return resolved.href;
  }
  function buildManagedSubtitleSignature(subtitles) {
    return subtitles.map(function (item) {
      return item.label + '|' + item.language + '|' + item.url;
    }).join('||');
  }
  function removeManagedSubtitleTracks() {
    Array.from(elements.player.querySelectorAll('track[data-managed-subtitle="true"]')).forEach(function (track) {
      track.remove();
    });
    delete elements.player.dataset.subtitleSignature;
  }
  function shouldUseHlsJs(url) {
    if (!canUseHlsJs(url)) {
      return false;
    }
    if (failedHlsSource === url) {
      return false;
    }
    if (forcedHlsSource === url) {
      return true;
    }
    return !shouldPreferNativeHls(url);
  }
  function canUseHlsJs(url) {
    return !hlsJsUnavailable && isHlsStreamUrl(url) && typeof window !== 'undefined' && typeof window.MediaSource !== 'undefined';
  }
  function shouldPreferNativeHls(url) {
    return isHlsStreamUrl(url) && isWebOSBrowser();
  }
  function isWebOSBrowser() {
    const ua = navigator.userAgent || '';
    return /webos|web0s|webOS/i.test(ua);
  }
  function isHlsStreamUrl(url) {
    const normalized = String(url || '').toLowerCase();
    if (!normalized) {
      return false;
    }
    return normalized.indexOf('.m3u8') !== -1 || normalized.indexOf('/m3u8') !== -1;
  }
  function clearNativePlayerSource() {
    elements.player.removeAttribute('src');
    elements.player.load();
  }
  function recreatePlayerElement() {
    const oldPlayer = elements.player;
    const nextPlayer = document.createElement('video');
    const volume = typeof oldPlayer.volume === 'number' ? oldPlayer.volume : 1;
    const wasMuted = Boolean(oldPlayer.muted);
    nextPlayer.id = oldPlayer.id;
    nextPlayer.className = oldPlayer.className;
    nextPlayer.tabIndex = oldPlayer.tabIndex;
    nextPlayer.controls = oldPlayer.controls;
    nextPlayer.autoplay = oldPlayer.autoplay;
    nextPlayer.muted = wasMuted;
    nextPlayer.volume = volume;
    if (oldPlayer.getAttribute('playsinline') !== null) {
      nextPlayer.setAttribute('playsinline', '');
    }
    if (oldPlayer.getAttribute('webkit-playsinline') !== null) {
      nextPlayer.setAttribute('webkit-playsinline', '');
    }
    Array.from(oldPlayer.querySelectorAll('track[data-managed-subtitle="true"]')).forEach(function (track) {
      nextPlayer.appendChild(track.cloneNode(true));
    });
    unbindPlayerEvents(oldPlayer);
    if (oldPlayer.parentNode) {
      oldPlayer.parentNode.replaceChild(nextPlayer, oldPlayer);
    }
    elements.player = nextPlayer;
    bindPlayerEvents(nextPlayer);
    return nextPlayer;
  }
  function shouldRecreateNativePlayerForSource(url) {
    return isWebOSBrowser() && !isHlsStreamUrl(url);
  }
  function shouldWaitForMetadataBeforeAutoplay() {
    return isWebOSBrowser() && elements.player && elements.player.readyState < 1;
  }
  function clearNativeHlsFallbackTimer() {
    window.clearTimeout(nativeHlsFallbackTimer);
    nativeHlsFallbackTimer = 0;
  }
  function detachHlsInstance() {
    if (!activeHlsInstance) {
      return;
    }
    try {
      activeHlsInstance.destroy();
    } catch (error) {
      return;
    } finally {
      activeHlsInstance = null;
    }
  }
  function teardownPlayerSource() {
    playerAttachToken += 1;
    activePlayerSource = '';
    activePlayerEngine = '';
    clearNativeHlsFallbackTimer();
    detachHlsInstance();
    clearNativePlayerSource();
  }
  function attachPlayerSource(_x) {
    return _attachPlayerSource.apply(this, arguments);
  }
  function _attachPlayerSource() {
    _attachPlayerSource = _asyncToGenerator(function* (url) {
      const nextEngine = shouldUseHlsJs(url) ? 'hls' : 'native';
      const attachToken = ++playerAttachToken;
      activePlayerSource = url;
      activePlayerEngine = nextEngine;
      if (nextEngine === 'hls') {
        const attached = yield attachHlsSource(url, attachToken);
        if (attached) {
          return;
        }
      }
      if (attachToken !== playerAttachToken) {
        return;
      }
      activePlayerEngine = 'native';
      attachNativeSource(url, attachToken);
    });
    return _attachPlayerSource.apply(this, arguments);
  }
  function attachNativeSource(url, attachToken) {
    if (attachToken !== playerAttachToken) {
      return;
    }
    clearNativeHlsFallbackTimer();
    detachHlsInstance();
    if (shouldRecreateNativePlayerForSource(url)) {
      recreatePlayerElement();
    }
    if (elements.player.src !== url) {
      elements.player.src = url;
      elements.player.load();
    }
    scheduleNativeHlsFallback(url, attachToken);
  }
  function scheduleNativeHlsFallback(url, attachToken) {
    if (!canUseHlsJs(url) || forcedHlsSource === url || failedHlsSource === url) {
      return;
    }
    const startingTime = Number(elements.player.currentTime || 0);
    clearNativeHlsFallbackTimer();
    nativeHlsFallbackTimer = window.setTimeout(function () {
      if (attachToken !== playerAttachToken || activePlayerEngine !== 'native' || activePlayerSource !== url || !state.playerUrl || elements.player.readyState >= 2 || Number(elements.player.currentTime || 0) > startingTime + 0.5) {
        return;
      }
      triggerHlsFallbackFromNative('Native HLS stalled. Trying HLS fallback.');
    }, 8000);
  }
  function attachHlsSource(_x2, _x3) {
    return _attachHlsSource.apply(this, arguments);
  }
  function _attachHlsSource() {
    _attachHlsSource = _asyncToGenerator(function* (url, attachToken) {
      let Hls = null;
      clearNativeHlsFallbackTimer();
      detachHlsInstance();
      clearNativePlayerSource();
      try {
        Hls = yield loadHlsLibrary();
      } catch (error) {
        hlsJsUnavailable = true;
        setStatus('HLS fallback failed to load. Trying native playback.', 'error');
        return false;
      }
      if (attachToken !== playerAttachToken) {
        return true;
      }
      if (!Hls || !Hls.isSupported || !Hls.isSupported()) {
        hlsJsUnavailable = true;
        return false;
      }
      activeHlsInstance = new Hls({
        enableWorker: false,
        lowLatencyMode: false
      });
      bindHlsEvents(Hls, activeHlsInstance, url, attachToken);
      activeHlsInstance.attachMedia(elements.player);
      return true;
    });
    return _attachHlsSource.apply(this, arguments);
  }
  function bindHlsEvents(Hls, hls, url, attachToken) {
    let appendErrorCount = 0;
    let fatalMediaErrorCount = 0;
    let networkErrorCount = 0;
    function markHlsSourceFailed(message) {
      if (attachToken !== playerAttachToken || activeHlsInstance !== hls) {
        return;
      }
      failedHlsSource = url;
      forcedHlsSource = '';
      pendingAutoplay = false;
      setStatus(message, 'error');
      detachHlsInstance();
      clearNativePlayerSource();
      activePlayerEngine = 'failed';
      elements.playerEngineBadge.textContent = 'Error';
      setPlayerHint('Playback failed', 1800);
      updatePlayerOverlay();
    }
    hls.on(Hls.Events.MEDIA_ATTACHED, function () {
      if (attachToken !== playerAttachToken || activeHlsInstance !== hls) {
        return;
      }
      hls.loadSource(url);
    });
    hls.on(Hls.Events.MANIFEST_PARSED, function () {
      if (attachToken !== playerAttachToken || activeHlsInstance !== hls) {
        return;
      }
      scheduleSubtitleRefresh();
    });
    hls.on(Hls.Events.ERROR, function (_event, data) {
      if (!data || attachToken !== playerAttachToken || activeHlsInstance !== hls) {
        return;
      }
      if (data.details === 'bufferAppendError' || data.details === 'bufferAppendingError') {
        appendErrorCount += 1;
        if (appendErrorCount >= 3) {
          markHlsSourceFailed('This stream is not compatible with this TV. Try another source.');
          return;
        }
      }
      if (!data.fatal) {
        return;
      }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        networkErrorCount += 1;
        if (networkErrorCount > 2) {
          markHlsSourceFailed('Stream network error. Try another source.');
          return;
        }
        setStatus('Stream network error. Retrying...', 'error');
        hls.startLoad();
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        fatalMediaErrorCount += 1;
        if (fatalMediaErrorCount > 1) {
          markHlsSourceFailed('This stream is not compatible with this TV. Try another source.');
          return;
        }
        setStatus('Stream media error. Recovering playback...', 'error');
        hls.recoverMediaError();
        return;
      }
      hlsJsUnavailable = true;
      forcedHlsSource = '';
      setStatus('HLS fallback failed. Trying native playback.', 'error');
      detachHlsInstance();
      if (attachToken !== playerAttachToken) {
        return;
      }
      activePlayerEngine = 'native';
      attachNativeSource(url, attachToken);
    });
  }
  function loadHlsLibrary() {
    if (typeof window === 'undefined') {
      return Promise.reject(new Error('HLS fallback is unavailable.'));
    }
    if (window.Hls) {
      return Promise.resolve(window.Hls);
    }
    if (hlsLibraryPromise) {
      return hlsLibraryPromise;
    }
    hlsLibraryPromise = new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      script.src = 'vendor/hls.min.js';
      script.async = true;
      script.onload = function () {
        if (window.Hls) {
          resolve(window.Hls);
          return;
        }
        hlsLibraryPromise = null;
        reject(new Error('HLS fallback library is unavailable.'));
      };
      script.onerror = function () {
        hlsLibraryPromise = null;
        reject(new Error('HLS fallback library failed to load.'));
      };
      document.head.appendChild(script);
    });
    return hlsLibraryPromise;
  }
  function syncManagedSubtitleTracks() {
    const subtitles = getEpisodeSubtitleEntries();
    const signature = buildManagedSubtitleSignature(subtitles);
    if (elements.player.dataset.subtitleSignature === signature) {
      return false;
    }
    removeManagedSubtitleTracks();
    subtitles.forEach(function (subtitle, index) {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = subtitle.label;
      track.srclang = subtitle.language;
      track.src = subtitle.url;
      track.default = index === 0;
      track.dataset.managedSubtitle = 'true';
      elements.player.appendChild(track);
    });
    elements.player.dataset.subtitleSignature = signature;
    return true;
  }
  function getActiveSubtitleTrack(tracks) {
    return (tracks || getPlayerTextTracks()).find(function (track) {
      return track.kind !== 'metadata' && track.mode === 'showing';
    }) || null;
  }
  function normalizeSubtitleToken(value) {
    return String(value || '').trim().toLowerCase();
  }
  function buildSubtitleTrackKey(track) {
    return [normalizeSubtitleToken(track && track.kind), normalizeSubtitleToken(track && track.language), normalizeSubtitleToken(track && track.label)].join('|');
  }
  function describeTextTrack(track, index) {
    const parts = [];
    const label = String(track && track.label ? track.label : '').trim();
    const language = String(track && track.language ? track.language : '').trim();
    const kind = String(track && track.kind ? track.kind : '').trim();
    if (label) {
      parts.push(label);
    }
    if (language) {
      parts.push(language.toUpperCase());
    }
    if (kind && kind !== 'subtitles') {
      parts.push(kind);
    }
    return parts.join(' • ') || 'Track ' + String(index + 1);
  }
  function rememberSubtitleDefaults() {
    const tracks = getPlayerTextTracks();
    if (!tracks.length || !state.playerUrl) {
      return;
    }
    if (state.subtitleDefaults && state.subtitleDefaults.playerUrl === state.playerUrl) {
      return;
    }
    state.subtitleDefaults = {
      playerUrl: state.playerUrl,
      modes: tracks.map(function (track) {
        return track.mode || 'disabled';
      })
    };
  }
  function resetSubtitleDefaults() {
    state.subtitleDefaults = null;
    window.clearTimeout(subtitleRefreshTimer);
    window.clearTimeout(subtitleFallbackRefreshTimer);
  }
  function restoreSubtitleDefaults(tracks) {
    const currentTracks = tracks || getPlayerTextTracks();
    const savedModes = state.subtitleDefaults && state.subtitleDefaults.playerUrl === state.playerUrl ? state.subtitleDefaults.modes : null;
    currentTracks.forEach(function (track, index) {
      const savedMode = savedModes && savedModes[index] ? savedModes[index] : track.default ? 'showing' : 'disabled';
      setTrackMode(track, savedMode);
    });
  }
  function setTrackMode(track, mode) {
    try {
      track.mode = mode;
    } catch (error) {
      return false;
    }
    return true;
  }
  function findTrackForMode(tracks, mode) {
    if (!mode || mode === 'auto' || mode === 'off') {
      return null;
    }
    const normalizedMode = normalizeSubtitleMode(mode);
    const parts = normalizedMode.split('|');
    const language = parts[1] || '';
    const label = parts[2] || '';
    return tracks.find(function (track) {
      return buildSubtitleTrackKey(track) === normalizedMode;
    }) || (language ? tracks.find(function (track) {
      return normalizeSubtitleToken(track.language) === language;
    }) : null) || (label ? tracks.find(function (track) {
      return normalizeSubtitleToken(track.label) === label;
    }) : null) || null;
  }
  function applySubtitleMode(mode) {
    const tracks = getPlayerTextTracks();
    if (!tracks.length) {
      return null;
    }
    if (mode === 'auto') {
      restoreSubtitleDefaults(tracks);
      return getActiveSubtitleTrack(tracks);
    }
    tracks.forEach(function (track) {
      setTrackMode(track, 'disabled');
    });
    if (mode === 'off') {
      return null;
    }
    const matchedTrack = findTrackForMode(tracks, mode);
    if (matchedTrack) {
      setTrackMode(matchedTrack, 'showing');
    }
    return matchedTrack;
  }
  function setSubtitleMode(mode) {
    state.subtitleMode = normalizeSubtitleMode(mode);
    localStorage.setItem(storageKeys.subtitleMode, state.subtitleMode);
    const activeTrack = applySubtitleMode(state.subtitleMode);
    renderSubtitleTracks();
    if (state.subtitleMode === 'off') {
      setStatus('Subtitles turned off.', 'good');
      return;
    }
    if (state.subtitleMode === 'auto') {
      setStatus('Subtitle mode set to auto.', 'good');
      return;
    }
    if (activeTrack) {
      const index = getPlayerTextTracks().indexOf(activeTrack);
      setStatus('Subtitles set to ' + describeTextTrack(activeTrack, index) + '.', 'good');
      return;
    }
    setStatus('Preferred subtitle track is unavailable for this stream.', 'error');
  }
  function scheduleSubtitleRefresh() {
    window.clearTimeout(subtitleRefreshTimer);
    window.clearTimeout(subtitleFallbackRefreshTimer);
    subtitleRefreshTimer = window.setTimeout(syncSubtitleStateFromTracks, 0);
    subtitleFallbackRefreshTimer = window.setTimeout(syncSubtitleStateFromTracks, 500);
  }
  function syncSubtitleStateFromTracks() {
    rememberSubtitleDefaults();
    if (state.subtitleMode !== 'auto') {
      applySubtitleMode(state.subtitleMode);
    }
    renderSubtitleTracks();
  }
  function createCardButton(title, posterUrl, meta) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card-button is-focus-anchor';
    const poster = document.createElement('img');
    poster.className = 'card-poster';
    poster.alt = title;
    poster.loading = 'lazy';
    poster.src = posterUrl || buildFallbackPoster();
    const heading = document.createElement('p');
    heading.className = 'card-title';
    heading.textContent = title;
    const metaLine = document.createElement('p');
    metaLine.className = 'card-meta';
    metaLine.textContent = meta;
    button.appendChild(poster);
    button.appendChild(heading);
    button.appendChild(metaLine);
    return button;
  }
  function createLibraryCard(config) {
    const button = createCardButton(config.title, config.poster, config.meta || '');
    button.dataset.libraryKey = config.key;
    const tagline = document.createElement('p');
    tagline.className = 'card-tagline';
    tagline.textContent = config.tagline || '';
    button.appendChild(tagline);
    button.addEventListener('click', config.onClick);
    return button;
  }
  function buildFallbackPoster() {
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="720" viewBox="0 0 480 720"><rect width="480" height="720" fill="#10233c"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#8dd7ff" font-size="34" font-family="Segoe UI">MoonTVPlus TV</text></svg>');
  }
  function formatTime(seconds) {
    const numeric = Number(seconds) || 0;
    const minutes = Math.floor(numeric / 60);
    const remainder = Math.floor(numeric % 60);
    return minutes + ':' + String(remainder).padStart(2, '0');
  }
  function buildStorageKey(source, id) {
    return source + '+' + id;
  }
  function decodeBase58Utf8(value) {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const input = String(value || '').trim();
    const bytes = [0];
    let zeros = 0;
    if (!input) {
      return '';
    }
    while (zeros < input.length && input.charAt(zeros) === '1') {
      zeros += 1;
    }
    for (let index = 0; index < input.length; index += 1) {
      const digit = alphabet.indexOf(input.charAt(index));
      let carry = digit;
      if (digit < 0) {
        throw new Error('Cast direct-play id is invalid.');
      }
      for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
        carry += bytes[byteIndex] * 58;
        bytes[byteIndex] = carry & 255;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 255);
        carry >>= 8;
      }
    }
    while (zeros > 0) {
      bytes.push(0);
      zeros -= 1;
    }
    const output = [];
    for (let index = bytes.length - 1; index >= 0; index -= 1) {
      output.push(String.fromCharCode(bytes[index]));
    }
    try {
      return decodeURIComponent(escape(output.join('')));
    } catch (error) {
      return output.join('');
    }
  }
  function normalizeSavedItemContextMap(value) {
    const normalized = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return normalized;
    }
    Object.keys(value).forEach(function (key) {
      const entry = value[key];
      const next = {};
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return;
      }
      if (typeof entry.title === 'string' && entry.title.trim()) {
        next.title = entry.title.trim();
      }
      if (typeof entry.searchTitle === 'string' && entry.searchTitle.trim()) {
        next.searchTitle = entry.searchTitle.trim();
      }
      if (typeof entry.fileName === 'string' && entry.fileName.trim()) {
        next.fileName = entry.fileName.trim();
      }
      if (Object.keys(next).length) {
        normalized[key] = next;
      }
    });
    return normalized;
  }
  function getSavedItemContext(key) {
    return state.savedItemContext && state.savedItemContext[key] ? state.savedItemContext[key] : null;
  }
  function rememberSavedItemContext(input) {
    if (!input || !input.source || !input.id) {
      return null;
    }
    const key = buildStorageKey(input.source, input.id);
    const current = getSavedItemContext(key) || {};
    const next = {};
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const searchTitle = typeof input.searchTitle === 'string' ? input.searchTitle.trim() : '';
    const fileName = typeof input.fileName === 'string' ? input.fileName.trim() : '';
    if (title || current.title) {
      next.title = title || current.title;
    }
    if (searchTitle || current.searchTitle) {
      next.searchTitle = searchTitle || current.searchTitle;
    }
    if (fileName || current.fileName) {
      next.fileName = fileName || current.fileName;
    }
    if (!Object.keys(next).length) {
      return null;
    }
    state.savedItemContext[key] = next;
    persistSavedItemContext();
    return next;
  }
  function buildSourceDetailUrl(source, id, title, fileName) {
    let detailUrl = '/api/source-detail?source=' + encodeURIComponent(source) + '&id=' + encodeURIComponent(id) + '&title=' + encodeURIComponent(title || 'Saved title');
    if (fileName) {
      detailUrl += '&fileName=' + encodeURIComponent(fileName);
    }
    return detailUrl;
  }
  function resolveSelectedSearchTitle() {
    if (state.selectedResult) {
      if (typeof state.selectedResult.searchTitle === 'string' && state.selectedResult.searchTitle.trim()) {
        return state.selectedResult.searchTitle.trim();
      }
      if (typeof state.selectedResult.title === 'string' && state.selectedResult.title.trim()) {
        return state.selectedResult.title.trim();
      }
    }
    if (!state.detail) {
      return '';
    }
    const savedContext = getSavedItemContext(buildStorageKey(state.detail.source, state.detail.id));
    if (savedContext && savedContext.searchTitle) {
      return savedContext.searchTitle;
    }
    return state.detail.title || '';
  }
  function focusInitialElement() {
    if (hasAuthenticatedSession() && elements.searchInput) {
      elements.searchInput.focus();
      return;
    }
    if (state.serverUrl && elements.password) {
      elements.password.focus();
      return;
    }
    elements.serverUrl.focus();
  }
  function openLibraryItem(_x4, _x5, _x6) {
    return _openLibraryItem.apply(this, arguments);
  }
  function _openLibraryItem() {
    _openLibraryItem = _asyncToGenerator(function* (key, savedItem, episodeIndex) {
      const parsed = parseStorageKey(key);
      if (!parsed) {
        setStatus('Library item key is invalid.', 'error');
        return;
      }
      const savedContext = getSavedItemContext(key);
      const displayTitle = savedContext && savedContext.title || savedItem && savedItem.title || 'Saved title';
      const searchTitle = savedContext && savedContext.searchTitle || savedItem && savedItem.search_title || displayTitle;
      state.selectedResult = {
        source: parsed.source,
        id: parsed.id,
        title: displayTitle,
        searchTitle: searchTitle
      };
      if (savedContext && savedContext.fileName) {
        state.selectedResult.fileName = savedContext.fileName;
      }
      persistSelection();
      renderResults();
      renderDetail();
      renderEpisodes();
      renderPlayer();
      setStatus('Loading saved item...', 'info');
      try {
        const response = yield apiFetch(buildSourceDetailUrl(parsed.source, parsed.id, searchTitle, savedContext && savedContext.fileName));
        state.detail = yield response.json();
        state.selectedEpisodeIndex = 0;
        rememberSavedItemContext({
          source: parsed.source,
          id: parsed.id,
          title: state.detail.title || displayTitle,
          searchTitle: searchTitle,
          fileName: savedContext && savedContext.fileName
        });
        persistSelection();
        renderDetail();
        renderEpisodes();
        yield selectEpisode(savedItem && typeof savedItem.index === 'number' ? Math.max(0, episodeIndex || 0) : resolvePreferredEpisodeIndex(), false);
        setStatus('Saved item loaded.', 'good');
        const targetButton = elements.resumeButton.classList.contains('hidden') ? elements.episodeGrid.querySelector('button') : elements.resumeButton;
        if (targetButton) {
          targetButton.focus();
        }
      } catch (error) {
        setStatus(error.message || 'Failed to open saved item.', 'error');
      }
    });
    return _openLibraryItem.apply(this, arguments);
  }
  function parseStorageKey(key) {
    const parts = String(key || '').split('+');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return null;
    }
    return {
      source: parts[0],
      id: parts[1]
    };
  }
  function onSaveServer(event) {
    event.preventDefault();
    state.serverUrl = normalizeServerUrl(elements.serverUrl.value) || deriveHostedServerUrl();
    state.isHostedOnSameOrigin = computeSameOrigin();
    localStorage.setItem(storageKeys.serverUrl, state.serverUrl);
    if (hydrateAuthState()) {
      persistSession();
    }
    renderServer();
    renderSession();
    setStatus(state.serverUrl ? getServerStatusMessage() : 'Server URL cleared.', state.serverUrl && !state.isHostedOnSameOrigin ? 'error' : state.serverUrl ? 'good' : 'info');
  }
  function onOpenServer() {
    if (!state.serverUrl) {
      setStatus('Enter a MoonTVPlus URL first.', 'error');
      return;
    }
    window.open(buildHostedFrontendUrl(), '_blank');
  }
  function onLogin(_x7) {
    return _onLogin.apply(this, arguments);
  }
  function _onLogin() {
    _onLogin = _asyncToGenerator(function* (event) {
      event.preventDefault();
      yield loginWithCredentials(elements.username.value.trim(), elements.password.value, 'Signing in...', 'Signed in successfully.');
    });
    return _onLogin.apply(this, arguments);
  }
  function loginFromStartupConfig() {
    return _loginFromStartupConfig.apply(this, arguments);
  }
  function _loginFromStartupConfig() {
    _loginFromStartupConfig = _asyncToGenerator(function* () {
      yield loginWithCredentials(elements.username.value.trim(), elements.password.value, 'Signing in from remote setup...', 'Signed in from remote setup.');
    });
    return _loginFromStartupConfig.apply(this, arguments);
  }
  function loginWithCredentials(_x8, _x9, _x0, _x1) {
    return _loginWithCredentials.apply(this, arguments);
  }
  function _loginWithCredentials() {
    _loginWithCredentials = _asyncToGenerator(function* (username, password, pendingMessage, successMessage) {
      if (!state.serverUrl) {
        setStatus('Save a MoonTVPlus URL first.', 'error');
        return;
      }
      if (!password) {
        setStatus('Password is required.', 'error');
        return;
      }
      setStatus(pendingMessage || 'Signing in...', 'info');
      try {
        const payload = username ? {
          username: username,
          password: password
        } : {
          password: password
        };
        const response = yield rawFetch('/api/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload),
          credentials: 'include'
        });
        if (!response.ok) {
          throw new Error(yield parseErrorMessage(response, 'Login failed.'));
        }
        const data = yield response.json();
        state.authToken = data.token || '';
        state.authInfo = sanitizeAuthInfo(data.auth) || sanitizeAuthInfo(parseAuthToken(state.authToken));
        if (!state.authToken || !state.authInfo) {
          hydrateAuthState();
        }
        persistSession();
        renderSession();
        startTVRemoteReceiver();
        elements.password.value = '';
        const syncIssues = yield refreshUserData();
        setStatus(syncIssues.length ? 'Signed in. ' + syncIssues.join(' ') : successMessage || 'Signed in successfully.', syncIssues.length ? 'info' : 'good');
        if (elements.searchInput.value.trim()) {
          yield performSearch(elements.searchInput.value.trim());
        } else {
          elements.searchInput.focus();
        }
      } catch (error) {
        setStatus(error.message || 'Login failed.', 'error');
      }
    });
    return _loginWithCredentials.apply(this, arguments);
  }
  function onSearch(_x10) {
    return _onSearch.apply(this, arguments);
  }
  function _onSearch() {
    _onSearch = _asyncToGenerator(function* (event) {
      event.preventDefault();
      const keyword = elements.searchInput.value.trim();
      if (!keyword) {
        setStatus('Enter a keyword to search.', 'error');
        return;
      }
      yield performSearch(keyword);
    });
    return _onSearch.apply(this, arguments);
  }
  function performSearch(_x11) {
    return _performSearch.apply(this, arguments);
  }
  function _performSearch() {
    _performSearch = _asyncToGenerator(function* (keyword) {
      if (!state.serverUrl) {
        setStatus('Save a MoonTVPlus URL first.', 'error');
        return;
      }
      if (!hasAuthenticatedSession()) {
        setStatus('Sign in before searching.', 'error');
        return;
      }
      localStorage.setItem(storageKeys.lastQuery, keyword);
      setStatus('Searching for "' + keyword + '"...', 'info');
      try {
        const response = yield apiFetch('/api/search?q=' + encodeURIComponent(keyword));
        const data = yield response.json();
        state.results = Array.isArray(data.results) ? data.results : [];
        state.selectedResult = null;
        state.detail = null;
        state.selectedEpisodeIndex = 0;
        state.playerUrl = '';
        persistSelection();
        renderResults();
        renderDetail();
        renderEpisodes();
        renderPlayer();
        if (state.results.length) {
          setStatus('Search completed. Use the remote to choose a title.', 'good');
          const firstResult = elements.resultsGrid.querySelector('button');
          if (firstResult) {
            firstResult.focus();
          }
        } else {
          setStatus('Search completed with no results.', 'info');
        }
      } catch (error) {
        setStatus(error.message || 'Search failed.', 'error');
      }
    });
    return _performSearch.apply(this, arguments);
  }
  function onSelectResult(_x12) {
    return _onSelectResult.apply(this, arguments);
  }
  function _onSelectResult() {
    _onSelectResult = _asyncToGenerator(function* (index) {
      const item = state.results[index];
      if (!item) {
        return;
      }
      state.selectedResult = Object.assign({}, item, {
        searchTitle: item.title
      });
      state.detail = null;
      state.selectedEpisodeIndex = 0;
      state.playerUrl = '';
      rememberSavedItemContext({
        source: item.source,
        id: item.id,
        title: item.title,
        searchTitle: item.title,
        fileName: item.fileName
      });
      persistSelection();
      renderResults();
      renderDetail();
      renderEpisodes();
      renderPlayer();
      setStatus('Loading details for ' + item.title + '...', 'info');
      try {
        const response = yield apiFetch(buildSourceDetailUrl(item.source, item.id, item.title, item.fileName));
        state.detail = yield response.json();
        state.selectedEpisodeIndex = 0;
        rememberSavedItemContext({
          source: item.source,
          id: item.id,
          title: state.detail.title || item.title,
          searchTitle: item.title,
          fileName: item.fileName
        });
        persistSelection();
        renderDetail();
        renderEpisodes();
        yield selectEpisode(resolvePreferredEpisodeIndex(), false);
        setStatus('Detail loaded for ' + item.title + '.', 'good');
        if (!elements.resumeButton.classList.contains('hidden')) {
          elements.resumeButton.focus();
        } else {
          const firstEpisodeButton = elements.episodeGrid.querySelector('button');
          if (firstEpisodeButton) {
            firstEpisodeButton.focus();
          }
        }
      } catch (error) {
        setStatus(error.message || 'Failed to load details.', 'error');
      }
    });
    return _onSelectResult.apply(this, arguments);
  }
  function resolvePreferredEpisodeIndex() {
    if (!state.detail || !Array.isArray(state.detail.episodes) || !state.detail.episodes.length) {
      return 0;
    }
    const initialEpisodeIndex = resolveDetailInitialEpisodeIndex();
    const key = buildStorageKey(state.detail.source, state.detail.id);
    const record = state.history[key];
    if (!record) {
      return initialEpisodeIndex;
    }
    const recordEpisodeIndex = Math.max(0, Math.min((record.index || 1) - 1, state.detail.episodes.length - 1));
    if (recordEpisodeIndex !== initialEpisodeIndex) {
      return initialEpisodeIndex;
    }
    return recordEpisodeIndex;
  }
  function resolveDetailInitialEpisodeIndex() {
    if (!state.detail || !Array.isArray(state.detail.episodes) || !state.detail.episodes.length) {
      return 0;
    }
    const rawIndex = state.detail.initialEpisodeIndex;
    if (typeof rawIndex !== 'number' || !isFinite(rawIndex)) {
      return 0;
    }
    return Math.max(0, Math.min(Math.floor(rawIndex), state.detail.episodes.length - 1));
  }
  function selectEpisode(_x13, _x14, _x15) {
    return _selectEpisode.apply(this, arguments);
  }
  function _selectEpisode() {
    _selectEpisode = _asyncToGenerator(function* (index, announce, options) {
      if (!state.detail || !Array.isArray(state.detail.episodes) || !state.detail.episodes.length) {
        return;
      }
      const safeIndex = Math.max(0, Math.min(state.detail.episodes.length - 1, index));
      if (!state.detail.episodes[safeIndex]) {
        return;
      }
      const resolveToken = ++playbackResolveToken;
      state.selectedEpisodeIndex = safeIndex;
      state.playerUrl = '';
      state.isResolvingPlayback = true;
      pendingAutoplay = Boolean(options && options.autoplay);
      forcedHlsSource = '';
      failedHlsSource = '';
      suppressResumeSeekForCurrentLoad = Boolean(options && options.resume === false);
      persistSelection();
      renderEpisodes();
      renderPlayer();
      try {
        const resolvedUrl = yield resolvePlaybackUrl(state.detail, safeIndex);
        if (resolveToken !== playbackResolveToken) {
          return;
        }
        state.playerUrl = resolvedUrl;
        state.isResolvingPlayback = false;
        renderPlayer();
        const key = buildStorageKey(state.detail.source, state.detail.id);
        const record = state.history[key];
        if (record && record.index === safeIndex + 1) {
          elements.resumeButton.classList.remove('hidden');
        }
        if (announce !== false) {
          setStatus('Ready to play episode ' + String(safeIndex + 1) + '.', 'good');
        }
      } catch (error) {
        if (resolveToken !== playbackResolveToken) {
          return;
        }
        pendingAutoplay = false;
        suppressResumeSeekForCurrentLoad = false;
        state.playerUrl = '';
        state.isResolvingPlayback = false;
        renderPlayer();
        setStatus(error.message || 'Failed to resolve playback URL.', 'error');
      }
    });
    return _selectEpisode.apply(this, arguments);
  }
  function resolvePlaybackUrl(_x16, _x17) {
    return _resolvePlaybackUrl.apply(this, arguments);
  }
  function _resolvePlaybackUrl() {
    _resolvePlaybackUrl = _asyncToGenerator(function* (detail, index) {
      let rawEpisodeUrl = detail.episodes[index];
      if (!rawEpisodeUrl) {
        return '';
      }
      rawEpisodeUrl = String(rawEpisodeUrl || '').trim();
      if (isLazyPlaybackUrl(rawEpisodeUrl)) {
        const response = yield apiFetch(appendQueryParam(rawEpisodeUrl, 'format', 'json'));
        const data = yield response.json();
        if (data && data.url) {
          rawEpisodeUrl = String(data.url).trim();
        }
      }
      if (!/^https?:\/\//i.test(rawEpisodeUrl)) {
        return state.isHostedOnSameOrigin ? rawEpisodeUrl : state.serverUrl + rawEpisodeUrl;
      }
      const looksLikeM3u8 = /\.m3u($|\?)/i.test(rawEpisodeUrl) || rawEpisodeUrl.toLowerCase().indexOf('.m3u8') !== -1 || !/\.(mp4|webm|m4v|mov|avi|flv)(\?|$)/i.test(rawEpisodeUrl);
      if (detail.proxyMode && looksLikeM3u8 && state.isHostedOnSameOrigin) {
        return '/api/proxy/vod/m3u8?url=' + encodeURIComponent(rawEpisodeUrl) + '&source=' + encodeURIComponent(detail.source);
      }
      return rawEpisodeUrl;
    });
    return _resolvePlaybackUrl.apply(this, arguments);
  }
  function isLazyPlaybackUrl(url) {
    const path = getUrlPath(url);
    return ['/api/xiaoya/play', '/api/openlist/play', '/api/netdisk/115/play', '/api/netdisk/123/play', '/api/netdisk/quark/play', '/api/netdisk/uc/play', '/api/netdisk/baidu/play', '/api/source-script/play'].some(function (prefix) {
      return path.indexOf(prefix) === 0;
    });
  }
  function appendQueryParam(url, key, value) {
    const separator = url.indexOf('?') === -1 ? '?' : '&';
    return url + separator + encodeURIComponent(key) + '=' + encodeURIComponent(value);
  }
  function getUrlPath(url) {
    const raw = String(url || '').trim();
    if (!/^https?:\/\//i.test(raw)) {
      return raw.split('?')[0];
    }
    const anchor = document.createElement('a');
    anchor.href = raw;
    return anchor.pathname || '/';
  }
  function onToggleFavorite() {
    return _onToggleFavorite.apply(this, arguments);
  }
  function _onToggleFavorite() {
    _onToggleFavorite = _asyncToGenerator(function* () {
      if (!state.detail) {
        return;
      }
      const key = buildStorageKey(state.detail.source, state.detail.id);
      const existing = state.favorites[key];
      const favorite = {
        source_name: state.detail.source_name || state.detail.source,
        total_episodes: Array.isArray(state.detail.episodes_titles) ? state.detail.episodes_titles.length : 0,
        title: state.detail.title,
        year: state.detail.year || '',
        cover: state.detail.poster || '',
        save_time: Date.now(),
        search_title: resolveSelectedSearchTitle()
      };
      if (!isSyncFeatureAvailable('favorites')) {
        if (existing) {
          delete state.favorites[key];
          setStatus('Favorite removed locally.', 'good');
        } else {
          state.favorites[key] = favorite;
          setStatus('Favorite saved locally.', 'good');
        }
        persistLocalSyncCache('favorites');
        renderFavorites();
        renderDetail();
        return;
      }
      try {
        if (existing) {
          yield apiFetch('/api/favorites?key=' + encodeURIComponent(key), {
            method: 'DELETE'
          });
          delete state.favorites[key];
          persistLocalSyncCache('favorites');
          setStatus('Favorite removed.', 'good');
        } else {
          yield apiFetch('/api/favorites', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              key: key,
              favorite: favorite
            })
          });
          state.favorites[key] = favorite;
          persistLocalSyncCache('favorites');
          setStatus('Favorite saved.', 'good');
        }
        renderFavorites();
        renderDetail();
      } catch (error) {
        if (isUnsupportedSyncError(error)) {
          markSyncFeatureUnsupported('favorites');
          if (existing) {
            delete state.favorites[key];
            setStatus('Favorite removed locally. ' + buildSyncUnavailableMessage('favorites'), 'info');
          } else {
            state.favorites[key] = favorite;
            setStatus('Favorite saved locally. ' + buildSyncUnavailableMessage('favorites'), 'info');
          }
          persistLocalSyncCache('favorites');
          renderFavorites();
          renderDetail();
          return;
        }
        setStatus(error.message || 'Favorite update failed.', 'error');
      }
    });
    return _onToggleFavorite.apply(this, arguments);
  }
  function onResumeFromRecord() {
    return _onResumeFromRecord.apply(this, arguments);
  }
  function _onResumeFromRecord() {
    _onResumeFromRecord = _asyncToGenerator(function* () {
      if (!state.detail) {
        return;
      }
      const key = buildStorageKey(state.detail.source, state.detail.id);
      const record = state.history[key];
      if (!record) {
        return;
      }
      yield selectEpisode(Math.max(0, (record.index || 1) - 1), false);
      if (elements.player.paused) {
        elements.player.play().catch(function () {
          return null;
        });
      }
      setStatus('Resuming from ' + formatTime(record.play_time) + '.', 'good');
    });
    return _onResumeFromRecord.apply(this, arguments);
  }
  function onPlayerLoadedMetadata() {
    if (!state.detail) {
      scheduleSubtitleRefresh();
      maybeRunPendingAutoplay();
      return;
    }
    if (pendingRemotePlaybackState) {
      applyPendingRemotePlaybackState();
    } else if (!suppressResumeSeekForCurrentLoad) {
      const key = buildStorageKey(state.detail.source, state.detail.id);
      const record = state.history[key];
      if (record && record.index === state.selectedEpisodeIndex + 1 && Number(record.play_time) > 5 && Number(record.total_time || 0) > Number(record.play_time)) {
        elements.player.currentTime = Number(record.play_time);
      }
    }
    scheduleSubtitleRefresh();
    maybeRunPendingAutoplay();
  }
  function maybeRunPendingAutoplay() {
    if (!pendingAutoplay || !state.playerUrl || elements.player.readyState < 1) {
      return;
    }
    pendingAutoplay = false;
    playPlayerSoon();
  }
  function onPlayerLoadStart() {
    resetSubtitleDefaults();
    renderSubtitleTracks();
    remoteDanmakuSpawned = {};
    remoteDanmakuLastTime = 0;
    clearRemoteDanmakuLayer();
  }
  function onPlayerTimeUpdate() {
    clearNativeHlsFallbackTimer();
    updateRemoteDanmakuOverlay();
    if (suppressResumeSeekForCurrentLoad && Number(elements.player.currentTime || 0) > 1) {
      suppressResumeSeekForCurrentLoad = false;
    }
    if (!state.detail || !elements.player.duration || !isFinite(elements.player.duration)) {
      return;
    }
    window.clearTimeout(saveProgressTimer);
    saveProgressTimer = window.setTimeout(function () {
      const now = Date.now();
      if (now - lastSavedProgressAt >= 10000) {
        persistPlayRecord(false).catch(function () {
          return null;
        });
      }
    }, 400);
  }
  function onPlayerEnded() {
    persistPlayRecord(true).catch(function () {
      return null;
    });
  }
  function onPlayerPause() {
    updateRemoteDanmakuAnimationState();
    if (elements.player.currentTime > 0 && !elements.player.ended) {
      persistPlayRecord(false).catch(function () {
        return null;
      });
    }
  }
  function onPlayerError() {
    updatePlayerOverlay();
    triggerHlsFallbackFromNative('Native HLS failed. Trying HLS fallback.');
  }
  function triggerHlsFallbackFromNative(message) {
    if (!state.playerUrl || activePlayerEngine !== 'native' || !canUseHlsJs(state.playerUrl) || forcedHlsSource === state.playerUrl || failedHlsSource === state.playerUrl || hlsJsUnavailable) {
      return;
    }
    const shouldResume = !elements.player.paused || pendingAutoplay;
    forcedHlsSource = state.playerUrl;
    elements.playerEngineBadge.textContent = 'HLS';
    setStatus(message, 'error');
    attachPlayerSource(state.playerUrl).then(function () {
      if (shouldResume) {
        playPlayerSoon();
      }
    }).catch(function (error) {
      setStatus(error.message || 'Playback setup failed.', 'error');
    });
  }
  function persistPlayRecord(_x18) {
    return _persistPlayRecord.apply(this, arguments);
  }
  function _persistPlayRecord() {
    _persistPlayRecord = _asyncToGenerator(function* (completed) {
      if (!state.detail || !hasAuthenticatedSession()) {
        return;
      }
      const key = buildStorageKey(state.detail.source, state.detail.id);
      const record = {
        title: state.detail.title,
        source_name: state.detail.source_name || state.detail.source,
        cover: state.detail.poster || '',
        year: state.detail.year || '',
        index: state.selectedEpisodeIndex + 1,
        total_episodes: Array.isArray(state.detail.episodes_titles) ? state.detail.episodes_titles.length : 0,
        play_time: completed ? Number(elements.player.duration || 0) : Number(elements.player.currentTime || 0),
        total_time: Number(elements.player.duration || 0),
        save_time: Date.now(),
        search_title: resolveSelectedSearchTitle()
      };
      lastSavedProgressAt = Date.now();
      state.history[key] = record;
      persistLocalSyncCache('playrecords');
      renderHistory();
      renderDetail();
      if (!isSyncFeatureAvailable('playrecords')) {
        return;
      }
      try {
        yield apiFetch('/api/playrecords', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            key: key,
            record: record
          })
        });
      } catch (error) {
        if (isUnsupportedSyncError(error)) {
          markSyncFeatureUnsupported('playrecords');
          setStatus(buildSyncUnavailableMessage('playrecords'), 'info');
          return;
        }
        throw error;
      }
    });
    return _persistPlayRecord.apply(this, arguments);
  }
  function refreshUserData() {
    return _refreshUserData.apply(this, arguments);
  }
  function _refreshUserData() {
    _refreshUserData = _asyncToGenerator(function* () {
      const issues = [];
      try {
        const playRecordResponse = yield apiFetch('/api/playrecords');
        state.history = yield playRecordResponse.json();
        state.syncSupport.playrecords = 'available';
        persistLocalSyncCache('playrecords');
      } catch (error) {
        if (isUnsupportedSyncError(error)) {
          markSyncFeatureUnsupported('playrecords');
          state.history = loadLocalSyncCache('playrecords');
          issues.push(buildSyncUnavailableMessage('playrecords'));
        } else {
          state.history = {};
          issues.push('Failed to load play history.');
        }
      }
      try {
        const favoriteResponse = yield apiFetch('/api/favorites');
        state.favorites = yield favoriteResponse.json();
        state.syncSupport.favorites = 'available';
        persistLocalSyncCache('favorites');
      } catch (error) {
        if (isUnsupportedSyncError(error)) {
          markSyncFeatureUnsupported('favorites');
          state.favorites = loadLocalSyncCache('favorites');
          issues.push(buildSyncUnavailableMessage('favorites'));
        } else {
          state.favorites = {};
          issues.push('Failed to load favorites.');
        }
      }
      renderHistory();
      renderFavorites();
      renderDetail();
      return issues;
    });
    return _refreshUserData.apply(this, arguments);
  }
  function onLogout() {
    return _onLogout.apply(this, arguments);
  }
  function _onLogout() {
    _onLogout = _asyncToGenerator(function* () {
      stopTVRemoteReceiver();
      try {
        if (state.serverUrl) {
          yield rawFetch('/api/logout', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            }
          });
        }
      } catch (error) {}
      state.authToken = '';
      state.authInfo = null;
      state.results = [];
      state.detail = null;
      state.selectedResult = null;
      state.selectedEpisodeIndex = 0;
      state.playerUrl = '';
      state.history = {};
      state.favorites = {};
      state.syncSupport.playrecords = 'unknown';
      state.syncSupport.favorites = 'unknown';
      persistSession();
      persistSelection();
      renderSession();
      renderHistory();
      renderFavorites();
      renderResults();
      renderDetail();
      renderEpisodes();
      renderPlayer();
      setStatus('Session cleared.', 'good');
      focusInitialElement();
    });
    return _onLogout.apply(this, arguments);
  }
  function apiFetch(_x19, _x20) {
    return _apiFetch.apply(this, arguments);
  }
  function _apiFetch() {
    _apiFetch = _asyncToGenerator(function* (path, options) {
      let response = yield rawFetch(path, options);
      if (response.status === 401) {
        const refreshed = yield attemptRefresh();
        if (refreshed) {
          response = yield rawFetch(path, options);
        }
        if (response.status === 401) {
          state.authToken = '';
          state.authInfo = null;
          persistSession();
          renderSession();
          throw new Error('Session expired. Sign in again.');
        }
      }
      if (!response.ok) {
        throw new Error(yield parseErrorMessage(response, 'Request failed.'));
      }
      return response;
    });
    return _apiFetch.apply(this, arguments);
  }
  function rawFetch(_x21, _x22) {
    return _rawFetch.apply(this, arguments);
  }
  function _rawFetch() {
    _rawFetch = _asyncToGenerator(function* (path, options) {
      if (!state.isHostedOnSameOrigin) {
        throw new Error(buildSameOriginRequiredMessage());
      }
      const finalOptions = Object.assign({
        credentials: 'include'
      }, options || {});
      finalOptions.headers = buildAuthHeaders(finalOptions.headers || {});
      return fetch(buildUrl(path), finalOptions);
    });
    return _rawFetch.apply(this, arguments);
  }
  function buildUrl(path) {
    if (!state.serverUrl || state.isHostedOnSameOrigin) {
      return path;
    }
    return state.serverUrl + path;
  }
  function buildAuthHeaders(inputHeaders) {
    const headers = normalizeHeaders(inputHeaders);
    const sessionToken = getSessionToken();
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken;
    }
    return headers;
  }
  function normalizeHeaders(inputHeaders) {
    const output = {};
    if (!inputHeaders) {
      return output;
    }
    if (typeof Headers !== 'undefined' && inputHeaders instanceof Headers) {
      inputHeaders.forEach(function (value, key) {
        output[key] = value;
      });
      return output;
    }
    if (Array.isArray(inputHeaders)) {
      inputHeaders.forEach(function (entry) {
        if (entry && entry.length >= 2) {
          output[entry[0]] = entry[1];
        }
      });
      return output;
    }
    for (const key in inputHeaders) {
      if (Object.prototype.hasOwnProperty.call(inputHeaders, key)) {
        output[key] = inputHeaders[key];
      }
    }
    return output;
  }
  function attemptRefresh() {
    return _attemptRefresh.apply(this, arguments);
  }
  function _attemptRefresh() {
    _attemptRefresh = _asyncToGenerator(function* () {
      if (!hasAuthenticatedSession()) {
        return false;
      }
      try {
        const response = yield rawFetch('/api/auth/refresh', {
          method: 'POST'
        });
        if (!response.ok) {
          return false;
        }
        const data = yield response.json();
        state.authToken = data.token || getSessionToken();
        state.authInfo = sanitizeAuthInfo(data.auth) || sanitizeAuthInfo(parseAuthToken(state.authToken)) || state.authInfo;
        if (!state.authToken || !state.authInfo) {
          hydrateAuthState();
        }
        persistSession();
        renderSession();
        return true;
      } catch (error) {
        return false;
      }
    });
    return _attemptRefresh.apply(this, arguments);
  }
  function parseErrorMessage(_x23, _x24) {
    return _parseErrorMessage.apply(this, arguments);
  }
  function _parseErrorMessage() {
    _parseErrorMessage = _asyncToGenerator(function* (response, fallback) {
      try {
        const data = yield response.json();
        if (data && typeof data.error === 'string' && data.error.trim()) {
          return data.error;
        }
      } catch (error) {
        try {
          const text = yield response.text();
          if (text && text.trim()) {
            return text;
          }
        } catch (subError) {
          return fallback;
        }
      }
      return fallback;
    });
    return _parseErrorMessage.apply(this, arguments);
  }
  function getTVRemoteDeviceId() {
    let id = localStorage.getItem(storageKeys.tvDeviceId);
    if (!id) {
      id = 'webos-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem(storageKeys.tvDeviceId, id);
    }
    return id;
  }
  function getTVRemoteDeviceName() {
    const ua = navigator.userAgent || '';
    if (/webos|web0s|webOS/i.test(ua)) {
      return 'LG webOS TV';
    }
    return 'MoonTVPlus webOS TV';
  }
  function startTVRemoteReceiver() {
    if (!state.isHostedOnSameOrigin || !hasAuthenticatedSession()) {
      return;
    }
    loadSocketIoLibrary().then(function () {
      if (!window.io || tvRemoteSocket) {
        return;
      }
      tvRemoteSocket = window.io({
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        auth: {
          token: getSessionToken()
        }
      });
      tvRemoteSocket.on('connect', registerTVRemoteDevice);
      tvRemoteSocket.on('tv-remote:key', dispatchSyntheticKey);
      tvRemoteSocket.on('tv-remote:text', applyRemoteText);
      tvRemoteSocket.on('tv-remote:play', handleRemotePlayCommand);
      tvRemoteSocket.on('tv-remote:sync', handleRemoteSyncCommand);
      window.clearInterval(tvRemoteStateTimer);
      tvRemoteStateTimer = window.setInterval(updateTVRemoteState, 10000);
      document.addEventListener('visibilitychange', updateTVRemoteState);
      window.addEventListener('focus', updateTVRemoteState);
    }).catch(function (error) {
      setStatus(error.message || 'TV remote receiver failed to start.', 'error');
    });
  }
  function stopTVRemoteReceiver() {
    window.clearInterval(tvRemoteStateTimer);
    tvRemoteStateTimer = 0;
    document.removeEventListener('visibilitychange', updateTVRemoteState);
    window.removeEventListener('focus', updateTVRemoteState);
    if (tvRemoteSocket) {
      tvRemoteSocket.disconnect();
      tvRemoteSocket = null;
    }
  }
  function loadSocketIoLibrary() {
    if (window.io) {
      return Promise.resolve(window.io);
    }
    if (socketIoLibraryPromise) {
      return socketIoLibraryPromise;
    }
    socketIoLibraryPromise = new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      script.src = '/socket.io/socket.io.js';
      script.async = true;
      script.onload = function () {
        if (window.io) {
          resolve(window.io);
          return;
        }
        socketIoLibraryPromise = null;
        reject(new Error('Socket.IO client is unavailable.'));
      };
      script.onerror = function () {
        socketIoLibraryPromise = null;
        reject(new Error('Socket.IO client failed to load.'));
      };
      document.head.appendChild(script);
    });
    return socketIoLibraryPromise;
  }
  function registerTVRemoteDevice() {
    if (!tvRemoteSocket) {
      return;
    }
    tvRemoteSocket.timeout(5000).emit('tv-remote:register-tv', buildTVRemoteStatePayload(), function (error, response) {
      if (error || !response || !response.success) {
        setStatus('TV remote registration failed.', 'error');
        return;
      }
      updateTVRemoteState();
    });
  }
  function updateTVRemoteState() {
    if (!tvRemoteSocket || typeof document.hidden === 'boolean' && document.hidden) {
      return;
    }
    tvRemoteSocket.emit('tv-remote:tv-state', buildTVRemoteStatePayload());
  }
  function buildTVRemoteStatePayload() {
    return {
      deviceId: getTVRemoteDeviceId(),
      deviceName: getTVRemoteDeviceName(),
      currentPath: window.location.pathname,
      title: document.title || 'MoonTVPlus TV'
    };
  }
  function handleRemotePlayCommand(_x25) {
    return _handleRemotePlayCommand.apply(this, arguments);
  }
  function _handleRemotePlayCommand() {
    _handleRemotePlayCommand = _asyncToGenerator(function* (command) {
      try {
        if (shouldReloadForRemotePlay(command || {})) {
          scheduleRemotePlayReload(command || {});
          return;
        }
        yield openRemotePlayCommand(command || {});
      } catch (error) {
        pendingAutoplay = false;
        state.isResolvingPlayback = false;
        renderPlayer();
        setStatus(error.message || 'Failed to cast video to TV.', 'error');
      }
    });
    return _handleRemotePlayCommand.apply(this, arguments);
  }
  function handleRemoteSyncCommand(_x26) {
    return _handleRemoteSyncCommand.apply(this, arguments);
  }
  function _handleRemoteSyncCommand() {
    _handleRemoteSyncCommand = _asyncToGenerator(function* (command) {
      try {
        command = command || {};
        if (!state.detail || isDifferentRemoteVideo(command)) {
          yield handleRemotePlayCommand(command);
          return;
        }
        applyRemoteDanmakuPayload(command);
        const requestedIndex = Number(command.index);
        if (isFinite(requestedIndex) && Math.floor(requestedIndex) !== state.selectedEpisodeIndex && Array.isArray(state.detail.episodes)) {
          pendingRemotePlaybackState = normalizeRemotePlaybackState(command);
          yield selectEpisode(Math.floor(requestedIndex), false, {
            autoplay: pendingRemotePlaybackState.paused !== true,
            resume: false
          });
        } else {
          applyRemotePlaybackState(command);
        }
        setStatus('TV playback synced.', 'good');
      } catch (error) {
        setStatus(error.message || 'Failed to sync TV playback.', 'error');
      }
    });
    return _handleRemoteSyncCommand.apply(this, arguments);
  }
  function isDifferentRemoteVideo(command) {
    const commandSource = String(command && command.source || '').trim();
    const commandId = String(command && command.id || '').trim();
    if (!commandSource && !commandId) {
      return false;
    }
    return commandSource && commandSource !== String(state.detail && state.detail.source || '') || commandId && commandId !== String(state.detail && state.detail.id || '');
  }
  function normalizeRemotePlaybackState(command) {
    const playback = command && command.playback ? command.playback : command || {};
    const currentTime = Number(playback.currentTime || 0);
    const duration = Number(playback.duration || 0);
    const playbackRate = Number(playback.playbackRate || 1);
    return {
      currentTime: isFinite(currentTime) && currentTime >= 0 ? currentTime : 0,
      duration: isFinite(duration) && duration >= 0 ? duration : 0,
      playbackRate: isFinite(playbackRate) && playbackRate > 0 ? Math.max(0.5, Math.min(4, playbackRate)) : 1,
      paused: playback.paused === true,
      updatedAt: Number(playback.updatedAt || Date.now())
    };
  }
  function applyRemotePlaybackState(command) {
    const playback = normalizeRemotePlaybackState(command);
    pendingRemotePlaybackState = playback;
    applyPendingRemotePlaybackState();
  }
  function applyPendingRemotePlaybackState() {
    if (!pendingRemotePlaybackState || !elements.player) {
      return false;
    }
    const playback = pendingRemotePlaybackState;
    try {
      elements.player.playbackRate = playback.playbackRate || 1;
    } catch (error) {}
    if (elements.player.readyState < 1) {
      return false;
    }
    const currentTime = Number(elements.player.currentTime || 0);
    const duration = Number(elements.player.duration || 0);
    if (playback.currentTime > 0 && Math.abs(currentTime - playback.currentTime) > 1.2) {
      try {
        elements.player.currentTime = duration > 0 && isFinite(duration) ? Math.max(0, Math.min(duration, playback.currentTime)) : playback.currentTime;
      } catch (error) {
        return false;
      }
    }
    if (playback.paused) {
      elements.player.pause();
    } else {
      elements.player.play().catch(function () {
        setPlayerHint('Press OK', 1200);
      });
    }
    pendingRemotePlaybackState = null;
    updatePlayerOverlay();
    return true;
  }
  function normalizeRemoteDanmakuItems(items) {
    if (!Array.isArray(items)) {
      return [];
    }
    return items.map(function (item) {
      return {
        text: String(item && item.text || '').slice(0, 240),
        time: Number(item && item.time || 0),
        color: String(item && item.color || '#ffffff'),
        mode: Number(item && item.mode || 0)
      };
    }).filter(function (item) {
      return item.text && isFinite(item.time) && item.time >= 0;
    }).slice(0, 3000);
  }
  function applyRemoteDanmakuPayload(command) {
    const danmaku = command && command.danmaku;
    if (!danmaku) {
      return;
    }
    remoteDanmakuEnabled = danmaku.enabled !== false;
    if (danmaku.settings) {
      const fontSize = Number(danmaku.settings.fontSize || remoteDanmakuSettings.fontSize);
      const opacity = Number(danmaku.settings.opacity || remoteDanmakuSettings.opacity);
      remoteDanmakuSettings = {
        fontSize: isFinite(fontSize) ? Math.max(20, Math.min(46, fontSize)) : remoteDanmakuSettings.fontSize,
        opacity: isFinite(opacity) ? Math.max(0.25, Math.min(1, opacity)) : remoteDanmakuSettings.opacity
      };
    }
    const comments = normalizeRemoteDanmakuItems(danmaku.comments);
    if (comments.length > 0) {
      remoteDanmakuItems = comments;
      remoteDanmakuSpawned = {};
      remoteDanmakuLastTime = Math.max(0, Number(elements.player && elements.player.currentTime || 0) - 9);
      clearRemoteDanmakuLayer();
    } else if (!remoteDanmakuEnabled) {
      clearRemoteDanmakuLayer();
    }
  }
  function clearRemoteDanmakuLayer() {
    if (elements.playerDanmakuLayer) {
      elements.playerDanmakuLayer.innerHTML = '';
    }
  }
  function updateRemoteDanmakuAnimationState() {
    if (!elements.playerDanmakuLayer) {
      return;
    }
    const stateValue = elements.player.paused ? 'paused' : 'running';
    Array.from(elements.playerDanmakuLayer.children).forEach(function (node) {
      if (node && node.style) {
        node.style.animationPlayState = stateValue;
      }
    });
  }
  function getRemoteDanmakuDuration(text) {
    return Math.max(6, 12 - Math.min(6, String(text || '').length / 6));
  }
  function updateRemoteDanmakuOverlay() {
    if (!remoteDanmakuEnabled || !remoteDanmakuItems.length || !elements.playerDanmakuLayer) {
      return;
    }
    const current = Number(elements.player.currentTime || 0);
    const previous = remoteDanmakuLastTime;
    const jumped = current < previous - 1 || current - previous > 2;
    const spawnWindow = jumped ? 8 : Math.max(0.6, current - previous + 0.2);
    const laneCount = 8;
    if (jumped) {
      remoteDanmakuSpawned = {};
      clearRemoteDanmakuLayer();
    }
    remoteDanmakuItems.map(function (item, index) {
      return {
        id: String(index) + '-' + String(item.time) + '-' + item.text,
        text: item.text,
        time: item.time,
        color: item.color,
        lane: index % laneCount
      };
    }).filter(function (item) {
      const delta = jumped ? Math.abs(item.time - current) : current - item.time;
      return delta >= 0 && delta <= spawnWindow && !remoteDanmakuSpawned[item.id];
    }).slice(0, laneCount).forEach(function (item) {
      const node = document.createElement('div');
      node.className = 'player-danmaku-item';
      node.textContent = item.text;
      node.style.top = String(item.lane * 12) + '%';
      node.style.color = item.color || '#ffffff';
      node.style.fontSize = String(remoteDanmakuSettings.fontSize) + 'px';
      node.style.opacity = String(remoteDanmakuSettings.opacity);
      node.style.animation = 'webos-danmaku ' + String(getRemoteDanmakuDuration(item.text)) + 's linear forwards';
      node.style.animationPlayState = elements.player.paused ? 'paused' : 'running';
      node.addEventListener('animationend', function () {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      });
      remoteDanmakuSpawned[item.id] = true;
      elements.playerDanmakuLayer.appendChild(node);
    });
    remoteDanmakuLastTime = current;
  }
  function shouldReloadForRemotePlay(command) {
    if (!isWebOSBrowser() || !state.isHostedOnSameOrigin || !command || command.__reloaded) {
      return false;
    }
    return true;
  }
  function scheduleRemotePlayReload(command) {
    const nextCommand = Object.assign({}, command, {
      __reloaded: true,
      __createdAt: Date.now()
    });
    localStorage.setItem(storageKeys.pendingRemotePlay, JSON.stringify(nextCommand));
    setStatus('Opening cast on TV...', 'info');
    releasePlayerBeforeRemoteReload();
    window.setTimeout(function () {
      if (window.location.pathname === publicAppPath && !window.location.search) {
        window.location.reload();
        return;
      }
      window.location.replace(publicAppPath);
    }, 500);
  }
  function releasePlayerBeforeRemoteReload() {
    if (!elements.player) {
      return;
    }
    if (!(elements.player.currentSrc || elements.player.src || activePlayerSource)) {
      return;
    }
    try {
      elements.player.pause();
    } catch (error) {
      return;
    }
    try {
      detachHlsInstance();
      elements.player.removeAttribute('src');
      elements.player.load();
    } catch (error) {
      return;
    }
  }
  function hasPendingRemotePlayCommand() {
    return Boolean(localStorage.getItem(storageKeys.pendingRemotePlay));
  }
  function consumePendingRemotePlayCommand(delayMs) {
    const raw = localStorage.getItem(storageKeys.pendingRemotePlay);
    if (!raw) {
      return;
    }
    localStorage.removeItem(storageKeys.pendingRemotePlay);
    window.setTimeout(function () {
      try {
        const command = JSON.parse(raw);
        if (!command || Date.now() - Number(command.__createdAt || 0) > 30000) {
          return;
        }
        handleRemotePlayCommand(command);
      } catch (error) {
        setStatus('Saved cast request is invalid.', 'error');
      }
    }, typeof delayMs === 'number' ? delayMs : isWebOSBrowser() ? 1000 : 250);
  }
  function consumeRestoreAutoplayRequest() {
    const raw = localStorage.getItem(storageKeys.restoreAutoplay);
    const fallback = {
      autoplay: false,
      delayMs: 0
    };
    if (!raw) {
      return fallback;
    }
    localStorage.removeItem(storageKeys.restoreAutoplay);
    try {
      const payload = JSON.parse(raw);
      if (payload && Date.now() - Number(payload.__createdAt || 0) > 30000) {
        return fallback;
      }
      return {
        autoplay: true,
        delayMs: Math.max(0, Math.min(Number(payload.delayMs || 0), 10000))
      };
    } catch (error) {
      return {
        autoplay: raw === '1' || raw === 'true',
        delayMs: 0
      };
    }
  }
  function scheduleRestoredSelectionReload() {
    localStorage.setItem(storageKeys.restoreAutoplay, JSON.stringify({
      __createdAt: Date.now(),
      delayMs: 3500
    }));
    setStatus('Opening cast on TV...', 'info');
    releasePlayerBeforeRemoteReload();
    window.setTimeout(function () {
      if (window.location.pathname === publicAppPath && !window.location.search) {
        window.location.reload();
        return;
      }
      window.location.replace(publicAppPath);
    }, 500);
  }
  function decodeDirectPlayCastUrl(command) {
    if (!command || String(command.source || '').trim() !== 'directplay') {
      return '';
    }
    const directUrl = decodeBase58Utf8(command.id || '').trim();
    if (!/^https?:\/\//i.test(directUrl)) {
      throw new Error('Cast direct-play URL is invalid.');
    }
    return directUrl;
  }
  function openDirectPlayCommand(_x27) {
    return _openDirectPlayCommand.apply(this, arguments);
  }
  function _openDirectPlayCommand() {
    _openDirectPlayCommand = _asyncToGenerator(function* (command) {
      const source = 'directplay';
      const id = String(command.id || '').trim();
      const title = String(command.title || command.searchTitle || 'Direct play').trim();
      const searchTitle = String(command.searchTitle || title).trim();
      const directUrl = decodeDirectPlayCastUrl(command);
      if (!id || !directUrl) {
        return false;
      }
      state.selectedEpisodeIndex = 0;
      state.isResolvingPlayback = false;
      state.playerUrl = '';
      state.detail = {
        id: id,
        title: title || 'Direct play',
        poster: '',
        episodes: [directUrl],
        episodes_titles: ['Direct link'],
        source: source,
        source_name: 'Direct link',
        class: '',
        year: '',
        desc: '',
        type_name: '',
        douban_id: 0,
        subtitles: [],
        proxyMode: false,
        initialEpisodeIndex: 0
      };
      state.selectedResult = {
        source: source,
        id: id,
        title: state.detail.title,
        searchTitle: searchTitle || state.detail.title
      };
      rememberSavedItemContext({
        source: state.selectedResult.source,
        id: state.selectedResult.id,
        title: state.selectedResult.title,
        searchTitle: state.selectedResult.searchTitle
      });
      persistSelection();
      if (command.__reloaded && isWebOSBrowser() && state.isHostedOnSameOrigin) {
        scheduleRestoredSelectionReload();
        return true;
      }
      renderResults();
      renderDetail();
      renderEpisodes();
      applyRemoteDanmakuPayload(command);
      pendingRemotePlaybackState = normalizeRemotePlaybackState(command);
      yield selectEpisode(0, false, {
        autoplay: pendingRemotePlaybackState.paused !== true,
        resume: false
      });
      setStatus('Casting ' + state.detail.title + ' to TV.', 'good');
      if (elements.player && typeof elements.player.focus === 'function') {
        elements.player.focus();
      }
      return true;
    });
    return _openDirectPlayCommand.apply(this, arguments);
  }
  function openRemotePlayCommand(_x28) {
    return _openRemotePlayCommand.apply(this, arguments);
  }
  function _openRemotePlayCommand() {
    _openRemotePlayCommand = _asyncToGenerator(function* (command) {
      if (!hasAuthenticatedSession()) {
        throw new Error('TV is not signed in.');
      }
      if (yield openDirectPlayCommand(command || {})) {
        return;
      }
      const source = String(command.source || '').trim();
      const id = String(command.id || '').trim();
      const title = String(command.title || command.searchTitle || '').trim();
      const fileName = String(command.fileName || '').trim();
      const requestedIndex = Number(command.index || 0);
      let detail = null;
      let searchTitle = String(command.searchTitle || title).trim();
      setStatus('Receiving cast request...', 'info');
      revealPlayerControls();
      setPlayerHint('Casting', 1200);
      if (source && id) {
        const response = yield apiFetch(buildSourceDetailUrl(source, id, title || 'Cast title', fileName));
        detail = yield response.json();
      } else if (title) {
        const response = yield apiFetch('/api/search?q=' + encodeURIComponent(title));
        const data = yield response.json();
        const results = Array.isArray(data.results) ? data.results : [];
        if (!results.length) {
          throw new Error('No playable source found for cast request.');
        }
        state.results = results;
        const first = results[0];
        searchTitle = first.title || title;
        const detailResponse = yield apiFetch(buildSourceDetailUrl(first.source, first.id, searchTitle, first.fileName));
        detail = yield detailResponse.json();
        state.selectedResult = Object.assign({}, first, {
          searchTitle: searchTitle
        });
      } else {
        throw new Error('Cast request is missing video information.');
      }
      if (!detail || !Array.isArray(detail.episodes) || !detail.episodes.length) {
        throw new Error('Cast target has no playable episodes.');
      }
      state.detail = detail;
      state.selectedResult = {
        source: detail.source || source,
        id: detail.id || id,
        title: detail.title || title || searchTitle,
        searchTitle: searchTitle || detail.title || title
      };
      if (fileName) {
        state.selectedResult.fileName = fileName;
      }
      rememberSavedItemContext({
        source: state.selectedResult.source,
        id: state.selectedResult.id,
        title: state.selectedResult.title,
        searchTitle: state.selectedResult.searchTitle,
        fileName: fileName
      });
      const safeIndex = Math.max(0, Math.min(detail.episodes.length - 1, isFinite(requestedIndex) ? Math.floor(requestedIndex) : 0));
      persistSelection();
      renderResults();
      renderDetail();
      renderEpisodes();
      applyRemoteDanmakuPayload(command);
      pendingRemotePlaybackState = normalizeRemotePlaybackState(command);
      yield selectEpisode(safeIndex, false, {
        autoplay: pendingRemotePlaybackState.paused !== true,
        resume: false
      });
      setStatus('Casting ' + (state.detail.title || state.selectedResult.title || 'video') + ' to TV.', 'good');
      if (elements.player && typeof elements.player.focus === 'function') {
        elements.player.focus();
      }
    });
    return _openRemotePlayCommand.apply(this, arguments);
  }
  function updatePlayerOverlay() {
    const duration = Number(elements.player.duration || 0);
    const current = Number(elements.player.currentTime || 0);
    const hasDuration = duration > 0 && isFinite(duration);
    const percent = hasDuration ? Math.max(0, Math.min(100, current / duration * 100)) : 0;
    elements.playerProgressFill.style.width = percent + '%';
    elements.playerCurrentTime.textContent = formatTime(current);
    elements.playerDuration.textContent = hasDuration ? formatTime(duration) : '0:00';
    elements.playerPlayButton.textContent = elements.player.paused ? 'Play' : 'Pause';
    if (elements.playerShell) {
      elements.playerShell.dataset.playerMode = state.isResolvingPlayback ? 'loading' : state.playerUrl ? elements.player.paused ? 'paused' : 'playing' : 'idle';
    }
  }
  function onPlayerStateChange() {
    updatePlayerOverlay();
    updateRemoteDanmakuAnimationState();
    if (!elements.player.paused && state.playerUrl) {
      revealPlayerControls();
    }
  }
  function setPlayerControlsOpen(open) {
    playerControlsOpen = Boolean(open);
    if (elements.playerShell) {
      elements.playerShell.dataset.controlsOpen = playerControlsOpen ? 'true' : 'false';
    }
  }
  function revealPlayerControls() {
    setPlayerControlsOpen(true);
    window.clearTimeout(playerIdleTimer);
    if (state.playerUrl && !elements.player.paused) {
      playerIdleTimer = window.setTimeout(function () {
        setPlayerControlsOpen(false);
      }, 10000);
    }
  }
  function togglePlayerControls() {
    setPlayerControlsOpen(!playerControlsOpen);
    if (playerControlsOpen) {
      revealPlayerControls();
    }
  }
  function setPlayerHint(message, durationMs) {
    elements.playerCenterHint.textContent = message;
    elements.playerCenterHint.classList.remove('hidden');
    window.clearTimeout(playerHintTimer);
    if (durationMs > 0) {
      playerHintTimer = window.setTimeout(hidePlayerHint, durationMs);
    }
  }
  function hidePlayerHint() {
    window.clearTimeout(playerHintTimer);
    elements.playerCenterHint.classList.add('hidden');
    elements.playerCenterHint.textContent = '';
  }
  function showDigitHint(value) {
    elements.playerDigitHint.textContent = 'Episode ' + value;
    elements.playerDigitHint.classList.remove('hidden');
    window.clearTimeout(playerDigitTimer);
    playerDigitTimer = window.setTimeout(function () {
      elements.playerDigitHint.classList.add('hidden');
    }, 1200);
  }
  function playPlayerSoon() {
    window.setTimeout(function () {
      if (!state.playerUrl) {
        return;
      }
      elements.player.play().catch(function () {
        setPlayerHint('Press OK', 1200);
      });
    }, 80);
  }
  function togglePlayerPlayback() {
    revealPlayerControls();
    if (!state.playerUrl) {
      setPlayerHint(state.isResolvingPlayback ? 'Loading' : 'No stream', 1200);
      return;
    }
    if (elements.player.paused) {
      elements.player.play().catch(function () {
        setPlayerHint('Press OK', 1200);
      });
    } else {
      elements.player.pause();
    }
    updatePlayerOverlay();
  }
  function seekPlayerBy(delta, announce) {
    const duration = Number(elements.player.duration || 0);
    if (!state.playerUrl || !duration || !isFinite(duration)) {
      return;
    }
    const nextTime = Math.max(0, Math.min(duration, Number(elements.player.currentTime || 0) + delta));
    elements.player.currentTime = nextTime;
    updatePlayerOverlay();
    revealPlayerControls();
    if (announce) {
      setPlayerHint((delta > 0 ? '+' : '') + String(delta) + 's', 900);
    }
  }
  function changePlayerVolume(delta) {
    const current = typeof elements.player.volume === 'number' ? elements.player.volume : 1;
    const next = Math.max(0, Math.min(1, current + delta));
    elements.player.volume = next;
    elements.player.muted = next <= 0;
    revealPlayerControls();
    setPlayerHint('Volume ' + Math.round(next * 100) + '%', 900);
    updatePlayerOverlay();
  }
  function isTextInputActive() {
    const active = document.activeElement;
    return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
  }
  function isPlayerControlActive() {
    const active = document.activeElement;
    return Boolean(active && elements.playerShell && active instanceof HTMLElement && elements.playerShell.contains(active));
  }
  function handleEpisodeDigit(digit) {
    if (!state.detail || !Array.isArray(state.detail.episodes) || !state.detail.episodes.length) {
      return false;
    }
    playerDigitBuffer = (playerDigitBuffer + digit).slice(-3);
    showDigitHint(playerDigitBuffer);
    window.clearTimeout(playerDigitTimer);
    playerDigitTimer = window.setTimeout(function () {
      const target = Number(playerDigitBuffer);
      playerDigitBuffer = '';
      elements.playerDigitHint.classList.add('hidden');
      if (target > 0) {
        selectEpisode(Math.max(0, Math.min(state.detail.episodes.length - 1, target - 1)), true, {
          autoplay: true
        });
      }
    }, 850);
    return true;
  }
  function isMenuKey(key, code) {
    return key === 'ContextMenu' || key === 'Menu' || key === 'BrowserContextMenu' || code === 93 || code === 82;
  }
  function normalizeRemoteKey(key, code) {
    if (key) {
      return key;
    }
    if (code === 13) return 'Enter';
    if (code === 27 || code === 461) return 'Escape';
    if (code === 33) return 'PageUp';
    if (code === 34) return 'PageDown';
    if (code === 36) return 'Home';
    if (code >= 48 && code <= 57) return String(code - 48);
    return keyFromCode(code);
  }
  function dispatchSyntheticKey(command) {
    const normalized = typeof command === 'string' ? {
      key: command
    } : command || {};
    const keyMap = {
      up: ['ArrowUp', 'ArrowUp', 38],
      down: ['ArrowDown', 'ArrowDown', 40],
      left: ['ArrowLeft', 'ArrowLeft', 37],
      right: ['ArrowRight', 'ArrowRight', 39],
      ok: ['Enter', 'Enter', 13],
      back: ['Escape', 'Escape', 27],
      menu: ['ContextMenu', 'ContextMenu', 93],
      home: ['Home', 'Home', 36],
      playPause: ['Enter', 'Enter', 13],
      pageUp: ['PageUp', 'PageUp', 33],
      pageDown: ['PageDown', 'PageDown', 34]
    };
    let config = keyMap[normalized.key] || keyMap.ok;
    if (normalized.key === 'digit') {
      const digit = /^[0-9]$/.test(normalized.digit || '') ? normalized.digit : '0';
      config = [digit, 'Digit' + digit, 48 + Number(digit)];
    }
    ['keydown', 'keyup'].forEach(function (type) {
      const event = new KeyboardEvent(type, {
        key: config[0],
        code: config[1],
        repeat: Boolean(normalized.repeat),
        bubbles: true,
        cancelable: true
      });
      Object.defineProperty(event, 'keyCode', {
        get: function () {
          return config[2];
        }
      });
      Object.defineProperty(event, 'which', {
        get: function () {
          return config[2];
        }
      });
      document.dispatchEvent(event);
    });
  }
  function applyRemoteText(command) {
    const target = getTextInputTarget();
    if (!target) {
      return false;
    }
    target.focus();
    const start = target.selectionStart == null ? target.value.length : target.selectionStart;
    const end = target.selectionEnd == null ? target.value.length : target.selectionEnd;
    const text = command && command.text ? String(command.text) : '';
    let next = target.value;
    let caret = start;
    if (command.mode === 'replace') {
      next = text;
      caret = next.length;
    } else if (command.mode === 'append') {
      next = target.value.slice(0, start) + text + target.value.slice(end);
      caret = start + text.length;
    } else if (command.mode === 'backspace') {
      if (start !== end) {
        next = target.value.slice(0, start) + target.value.slice(end);
        caret = start;
      } else if (start > 0) {
        next = target.value.slice(0, start - 1) + target.value.slice(end);
        caret = start - 1;
      }
    } else if (command.mode === 'clear') {
      next = '';
      caret = 0;
    }
    target.value = next;
    if (target.setSelectionRange) {
      target.setSelectionRange(caret, caret);
    }
    target.dispatchEvent(new Event('input', {
      bubbles: true
    }));
    target.dispatchEvent(new Event('change', {
      bubbles: true
    }));
    return true;
  }
  function getTextInputTarget() {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      return active;
    }
    return document.querySelector('input:not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly])');
  }
  function onGlobalKeyDown(event) {
    const key = normalizeRemoteKey(event.key || '', event.keyCode || 0);
    const code = event.keyCode || 0;
    if (key === 'F5') {
      event.preventDefault();
      window.location.reload();
      return;
    }
    if (isMenuKey(key, code)) {
      event.preventDefault();
      const now = Date.now();
      if (now - lastMenuKeyAt < 350) {
        return;
      }
      lastMenuKeyAt = now;
      togglePlayerControls();
      return;
    }
    if (/^[0-9]$/.test(key) && !isTextInputActive()) {
      if (handleEpisodeDigit(key)) {
        event.preventDefault();
        return;
      }
    }
    if (key === 'Enter' && !isTextInputActive()) {
      if (isPlayerControlActive() || state.playerUrl || state.isResolvingPlayback) {
        event.preventDefault();
        togglePlayerPlayback();
        return;
      }
      const active = document.activeElement;
      if (active instanceof HTMLElement && typeof active.click === 'function') {
        event.preventDefault();
        active.click();
        return;
      }
    }
    if (key === 'PageUp' || key === 'PageDown') {
      if (state.detail && Array.isArray(state.detail.episodes) && state.detail.episodes.length) {
        event.preventDefault();
        selectEpisode(state.selectedEpisodeIndex + (key === 'PageUp' ? -1 : 1), true, {
          autoplay: true
        });
        return;
      }
    }
    if (key === 'Home') {
      event.preventDefault();
      focusInitialElement();
      window.scrollTo(0, 0);
      return;
    }
    if (key === 'Escape' || code === 461) {
      if (isPlayerControlActive() || !playerControlsOpen) {
        if (!playerControlsOpen) {
          revealPlayerControls();
        } else {
          setPlayerControlsOpen(false);
        }
        const fallback = elements.resumeButton.classList.contains('hidden') ? elements.searchInput : elements.resumeButton;
        fallback.focus();
        event.preventDefault();
        return;
      }
    }
    if (!playerControlsOpen && state.playerUrl && (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown')) {
      event.preventDefault();
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        seekPlayerBy(key === 'ArrowLeft' ? -10 : 10, true);
      } else {
        changePlayerVolume(key === 'ArrowUp' ? 0.05 : -0.05);
      }
      return;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown' || code === 37 || code === 38 || code === 39 || code === 40) {
      if (isPlayerControlActive() && !playerControlsOpen) {
        return;
      }
      revealPlayerControls();
      handleDirectionalFocus(key || keyFromCode(code));
      event.preventDefault();
    }
  }
  function keyFromCode(code) {
    if (code === 37) return 'ArrowLeft';
    if (code === 38) return 'ArrowUp';
    if (code === 39) return 'ArrowRight';
    if (code === 40) return 'ArrowDown';
    return '';
  }
  function handleDirectionalFocus(direction) {
    const focusables = Array.from(document.querySelectorAll('button:not(.hidden), input:not(.hidden), video:not(.hidden)')).filter(function (element) {
      return element.offsetParent !== null;
    });
    if (!focusables.length) {
      return;
    }
    const current = document.activeElement;
    if (!current || focusables.indexOf(current) === -1) {
      focusables[0].focus();
      return;
    }
    const currentRect = current.getBoundingClientRect();
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;
    focusables.forEach(function (candidate) {
      if (candidate === current) {
        return;
      }
      const rect = candidate.getBoundingClientRect();
      const candidateCenterX = rect.left + rect.width / 2;
      const candidateCenterY = rect.top + rect.height / 2;
      const currentCenterX = currentRect.left + currentRect.width / 2;
      const currentCenterY = currentRect.top + currentRect.height / 2;
      const deltaX = candidateCenterX - currentCenterX;
      const deltaY = candidateCenterY - currentCenterY;
      if (direction === 'ArrowLeft' && deltaX >= -10) return;
      if (direction === 'ArrowRight' && deltaX <= 10) return;
      if (direction === 'ArrowUp' && deltaY >= -10) return;
      if (direction === 'ArrowDown' && deltaY <= 10) return;
      const primaryDistance = direction === 'ArrowLeft' || direction === 'ArrowRight' ? Math.abs(deltaX) : Math.abs(deltaY);
      const secondaryDistance = direction === 'ArrowLeft' || direction === 'ArrowRight' ? Math.abs(deltaY) : Math.abs(deltaX);
      const score = primaryDistance * 2 + secondaryDistance;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    });
    if (best) {
      best.focus();
      if (typeof best.scrollIntoView === 'function') {
        best.scrollIntoView({
          block: 'nearest',
          inline: 'nearest'
        });
      }
    }
  }
  init();
})();
