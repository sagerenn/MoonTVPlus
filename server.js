// Next.js 自定义服务器 + Socket.IO
const crypto = require('crypto');
const dns = require('dns').promises;
const fs = require('fs');
const { createServer } = require('http');
const net = require('net');
const path = require('path');
const { parse } = require('url');
const { spawn } = require('child_process');
const next = require('next');
const { Server } = require('socket.io');
const {
  attachTVRemoteIO,
  cleanupTVRemoteDevices,
  clearTVRemoteHub,
  registerTVRemoteDevice,
  removeTVRemoteSocket,
  updateTVRemoteDevice,
} = require('./src/lib/tv-remote-hub.js');

function shouldInitSQLite() {
  const isCloudflare = process.env.CF_PAGES === '1' || process.env.BUILD_TARGET === 'cloudflare';
  return process.env.NEXT_PUBLIC_STORAGE_TYPE === 'd1' && !isCloudflare && process.env.MOONTV_LITE !== 'true';
}

function isTVModeEnabled() {
  return process.env.ENABLE_TV_MODE !== 'false';
}

function ensureSQLiteReady() {
  if (!shouldInitSQLite()) {
    return;
  }

  try {
    const { initSQLiteDatabase } = require('./scripts/init-sqlite.js');
    initSQLiteDatabase();
  } catch (error) {
    console.error('❌ Error initializing SQLite database:', error);
    throw error;
  }
}

ensureSQLiteReady();

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const webOSCompatibilityHlsRoot = process.env.WEBOS_HLS_CACHE_DIR || '/tmp/moontv-webos-hls';
const webOSCompatibilityHlsSessions = new Map();
const webOSCompatibilityProfileVersion = 'fmp4-360p-v2';

function setWebOSCompatibilityHeaders(res, contentType, extraHeaders = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (contentType) {
    res.setHeader('Content-Type', contentType);
  }
  Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
}

function sendWebOSCompatibilityJson(res, statusCode, payload) {
  setWebOSCompatibilityHeaders(res, 'application/json; charset=utf-8');
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIPAddress(ip) {
  if (!ip || !net.isIP(ip)) return true;
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);

  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::' || normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }
  if (normalized.startsWith('::ffff:')) {
    return isPrivateIPv4(normalized.slice(7));
  }
  return false;
}

async function assertPublicHttpUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch {
    throw new Error('Invalid source URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Unsupported source protocol');
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Local source URLs are not allowed');
  }

  if (net.isIP(hostname)) {
    if (isPrivateIPAddress(hostname)) {
      throw new Error('Private source URLs are not allowed');
    }
    return url;
  }

  const addresses = await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((address) => isPrivateIPAddress(address.address))) {
    throw new Error('Private source URLs are not allowed');
  }

  return url;
}

function resolveWebOSCompatibilityStart(value) {
  const start = Number(value || 0);
  if (!Number.isFinite(start) || start < 0) {
    return 0;
  }
  return Math.floor(Math.min(start, 24 * 60 * 60));
}

function buildWebOSCompatibilitySessionKey(sourceUrl, source, start) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([webOSCompatibilityProfileVersion, sourceUrl, source || '', start]))
    .digest('hex')
    .slice(0, 32);
}

function getWebOSCompatibilitySessionDir(key) {
  return path.join(webOSCompatibilityHlsRoot, key);
}

function getWebOSCompatibilitySessionLog(session) {
  try {
    return fs.readFileSync(path.join(session.dir, 'ffmpeg.log'), 'utf8').slice(-1200);
  } catch {
    return '';
  }
}

function getFirstPlaylistSegment(playlist) {
  const line = playlist
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith('#') && /^segment\d+\.(?:m4s|ts)$/.test(item));
  return line || '';
}

async function waitForWebOSCompatibilityFile(filePath, session, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size > 0) {
        return true;
      }
    } catch {
      // Wait until ffmpeg writes the file.
    }

    if (session?.ended && Date.now() > session.startedAt + 1500) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return false;
}

async function waitForWebOSCompatibilityPlaylist(session, timeoutMs = 45000) {
  const playlistPath = path.join(session.dir, 'index.m3u8');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const playlist = await fs.promises.readFile(playlistPath, 'utf8');
      const firstSegment = getFirstPlaylistSegment(playlist);
      if (firstSegment) {
        const segmentReady = await waitForWebOSCompatibilityFile(path.join(session.dir, firstSegment), session, 800);
        if (segmentReady) {
          return true;
        }
      }
    } catch {
      // Wait until ffmpeg writes the playlist.
    }

    if (session.ended && Date.now() > session.startedAt + 1500) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`webOS compatibility stream did not become ready. ${getWebOSCompatibilitySessionLog(session)}`);
}

function getWebOSCompatibilityRequestOrigin(req) {
  const host = req.headers.host;
  if (!host) {
    return '';
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || (req.socket && req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${host}`;
}

function buildWebOSCompatibilityMediaUrl(key, filename, origin) {
  const mediaPath = `/api/webos-hls/${key}/${filename}`;
  return origin ? `${origin}${mediaPath}` : mediaPath;
}

function rewriteWebOSCompatibilityPlaylistMapLine(line, key, origin) {
  return line.replace(/URI="([^"]+)"/i, (match, uri) => {
    if (!uri || /^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith('/')) {
      return match;
    }

    return `URI="${buildWebOSCompatibilityMediaUrl(key, uri, origin)}"`;
  });
}

function rewriteWebOSCompatibilityPlaylist(playlist, key, origin) {
  return playlist
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return line;
      }
      if (/^#EXT-X-VERSION:/i.test(trimmed)) {
        return '#EXT-X-VERSION:7';
      }
      if (/^#EXT-X-INDEPENDENT-SEGMENTS/i.test(trimmed)) {
        return '';
      }
      if (/^#EXT-X-MAP:/i.test(trimmed)) {
        return rewriteWebOSCompatibilityPlaylistMapLine(line, key, origin);
      }
      if (trimmed.startsWith('#')) {
        return line;
      }
      if (/^segment\d+\.(?:m4s|ts)$/.test(trimmed)) {
        return buildWebOSCompatibilityMediaUrl(key, trimmed, origin);
      }
      return line;
    })
    .join('\n');
}

function isWebOSCompatibilityMediaFilename(filename) {
  return filename === 'init.mp4' || /^segment\d+\.(?:m4s|ts)$/.test(filename);
}

function getWebOSCompatibilityMediaContentType(filename) {
  if (filename === 'init.mp4') {
    return 'video/mp4';
  }
  if (/\.m4s$/i.test(filename)) {
    return 'video/iso.segment';
  }
  return 'video/mp2t';
}

async function startWebOSCompatibilitySession(sourceUrl, source, start) {
  await assertPublicHttpUrl(sourceUrl);

  const key = buildWebOSCompatibilitySessionKey(sourceUrl, source, start);
  const existing = webOSCompatibilityHlsSessions.get(key);
  if (existing) {
    existing.lastAccess = Date.now();
    return existing;
  }

  const dir = getWebOSCompatibilitySessionDir(key);
  await fs.promises.rm(dir, { recursive: true, force: true });
  await fs.promises.mkdir(dir, { recursive: true });

  const session = {
    key,
    dir,
    sourceUrl,
    source,
    start,
    startedAt: Date.now(),
    lastAccess: Date.now(),
    ended: false,
    process: null,
  };
  webOSCompatibilityHlsSessions.set(key, session);

  const sourceOrigin = new URL(sourceUrl).origin + '/';
  const args = [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-y',
    '-user_agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    '-referer',
    sourceOrigin,
    '-reconnect',
    '1',
    '-reconnect_streamed',
    '1',
    '-reconnect_delay_max',
    '2',
  ];
  if (start > 0) {
    args.push('-ss', String(start));
  }
  args.push(
    '-i',
    sourceUrl,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    'scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS',
    '-af',
    'aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS',
    '-r',
    '24',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-profile:v',
    'baseline',
    '-level',
    '3.0',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-x264-params',
    'keyint=48:min-keyint=48:scenecut=0:ref=1:bframes=0:cabac=0',
    '-g',
    '48',
    '-keyint_min',
    '48',
    '-sc_threshold',
    '0',
    '-b:v',
    '700k',
    '-maxrate',
    '850k',
    '-bufsize',
    '1700k',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-ac',
    '2',
    '-ar',
    '44100',
    '-f',
    'hls',
    '-hls_time',
    '4',
    '-hls_playlist_type',
    'event',
    '-hls_segment_type',
    'fmp4',
    '-hls_fmp4_init_filename',
    'init.mp4',
    '-hls_flags',
    'independent_segments',
    '-hls_segment_filename',
    path.join(dir, 'segment%05d.m4s'),
    path.join(dir, 'index.m3u8')
  );

  const logStream = fs.createWriteStream(path.join(dir, 'ffmpeg.log'), { flags: 'a' });
  logStream.write(`\n[${new Date().toISOString()}] ffmpeg ${args.map((arg) => JSON.stringify(arg)).join(' ')}\n`);
  const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  session.process = child;
  child.stderr.pipe(logStream);
  child.on('exit', (code, signal) => {
    session.ended = true;
    session.exitCode = code;
    session.exitSignal = signal;
    logStream.end(`\n[${new Date().toISOString()}] ffmpeg exited code=${code} signal=${signal}\n`);
  });
  child.on('error', (error) => {
    session.ended = true;
    session.error = error.message;
    logStream.end(`\n[${new Date().toISOString()}] ffmpeg error ${error.message}\n`);
  });

  return session;
}

async function serveWebOSCompatibilityPlaylist(req, res, parsedUrl) {
  const sourceUrl = parsedUrl.query.url;
  const source = String(parsedUrl.query.source || 'directplay');
  const start = resolveWebOSCompatibilityStart(parsedUrl.query.start);

  if (!sourceUrl) {
    sendWebOSCompatibilityJson(res, 400, { error: 'Missing source URL' });
    return;
  }

  const session = await startWebOSCompatibilitySession(String(sourceUrl), source, start);
  await waitForWebOSCompatibilityPlaylist(session);
  const playlistPath = path.join(session.dir, 'index.m3u8');
  const playlist = await fs.promises.readFile(playlistPath, 'utf8');
  const body = rewriteWebOSCompatibilityPlaylist(playlist, session.key, getWebOSCompatibilityRequestOrigin(req));
  setWebOSCompatibilityHeaders(res, 'application/vnd.apple.mpegurl; charset=utf-8');
  res.statusCode = 200;
  res.end(body);
}

async function serveWebOSCompatibilityMedia(req, res, key, filename) {
  if (!/^[a-f0-9]{32}$/.test(key) || !isWebOSCompatibilityMediaFilename(filename)) {
    sendWebOSCompatibilityJson(res, 404, { error: 'Not found' });
    return;
  }

  const session = webOSCompatibilityHlsSessions.get(key) || {
    key,
    dir: getWebOSCompatibilitySessionDir(key),
    startedAt: Date.now(),
    ended: false,
  };
  const filePath = path.join(session.dir, filename);
  const ready = await waitForWebOSCompatibilityFile(filePath, session, 25000);
  if (!ready) {
    sendWebOSCompatibilityJson(res, 404, { error: 'Segment not ready' });
    return;
  }

  const stat = await fs.promises.stat(filePath);
  let start = 0;
  let end = stat.size - 1;
  let statusCode = 200;
  const range = req.headers.range || '';
  const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(range);
  const headers = {
    'Accept-Ranges': 'bytes',
  };

  if (rangeMatch) {
    start = rangeMatch[1] ? Number(rangeMatch[1]) : 0;
    end = rangeMatch[2] ? Number(rangeMatch[2]) : end;
    if (start >= stat.size || end < start) {
      setWebOSCompatibilityHeaders(res, getWebOSCompatibilityMediaContentType(filename), { 'Content-Range': `bytes */${stat.size}` });
      res.statusCode = 416;
      res.end();
      return;
    }
    end = Math.min(end, stat.size - 1);
    statusCode = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }

  headers['Content-Length'] = String(end - start + 1);
  setWebOSCompatibilityHeaders(res, getWebOSCompatibilityMediaContentType(filename), headers);
  res.statusCode = statusCode;
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

async function serveWebOSCompatibilityFile(req, res, filePath, contentType) {
  const stat = await fs.promises.stat(filePath);
  let start = 0;
  let end = stat.size - 1;
  let statusCode = 200;
  const headers = {
    'Accept-Ranges': 'bytes',
  };
  const range = req.headers.range || '';
  const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(range);

  if (rangeMatch) {
    start = rangeMatch[1] ? Number(rangeMatch[1]) : 0;
    end = rangeMatch[2] ? Number(rangeMatch[2]) : end;
    if (start >= stat.size || end < start) {
      setWebOSCompatibilityHeaders(res, contentType, { 'Content-Range': `bytes */${stat.size}` });
      res.statusCode = 416;
      res.end();
      return;
    }
    end = Math.min(end, stat.size - 1);
    statusCode = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }

  headers['Content-Length'] = String(end - start + 1);
  setWebOSCompatibilityHeaders(res, contentType, headers);
  res.statusCode = statusCode;
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

async function serveWebOSRenderedMjpeg(req, res, parsedUrl) {
  const sourceUrl = parsedUrl.query.url;
  const sourceName = String(parsedUrl.query.source || 'directplay');
  const start = resolveWebOSCompatibilityStart(parsedUrl.query.start);

  if (!sourceUrl) {
    sendWebOSCompatibilityJson(res, 400, { error: 'Missing source URL' });
    return;
  }

  const source = await assertPublicHttpUrl(String(sourceUrl));
  const sourceOrigin = source.origin + '/';
  const contentType = 'multipart/x-mixed-replace; boundary=ffmpeg';
  setWebOSCompatibilityHeaders(res, contentType, {
    'X-Accel-Buffering': 'no',
    Connection: 'close',
  });

  res.statusCode = 200;
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const args = [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-user_agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    '-referer',
    sourceOrigin,
    '-reconnect',
    '1',
    '-reconnect_streamed',
    '1',
    '-reconnect_delay_max',
    '2',
  ];

  if (start > 0) {
    args.push('-ss', String(start));
  }

  args.push(
    '-i',
    source.href,
    '-an',
    '-vf',
    'fps=8,scale=-2:540',
    '-q:v',
    '6',
    '-f',
    'mpjpeg',
    'pipe:1'
  );

  const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let closed = false;

  const stopChild = () => {
    if (closed) {
      return;
    }
    closed = true;
    if (child && !child.killed) {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 2000).unref?.();
    }
  };

  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-1600);
  });

  child.on('error', (error) => {
    console.error('[webOS MJPEG] ffmpeg failed to start:', error);
    if (!res.headersSent) {
      sendWebOSCompatibilityJson(res, 500, {
        error: 'webOS rendered stream failed',
        details: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    res.end();
  });

  child.on('exit', (code, signal) => {
    if (!closed && code !== 0) {
      console.error('[webOS MJPEG] ffmpeg exited:', { code, signal, source: sourceName, start, stderr });
    }
    if (!res.writableEnded) {
      res.end();
    }
  });

  req.on('close', stopChild);
  res.on('close', stopChild);
  child.stdout.pipe(res);
}

function getBoolQueryValue(query, name) {
  const expectedName = String(name || '').toLowerCase();
  for (const [key, value] of Object.entries(query || {})) {
    if (String(key || '').toLowerCase() !== expectedName) {
      continue;
    }

    const rawValue = Array.isArray(value) ? value[0] : value;
    return /^(1|true|yes|on)$/i.test(String(rawValue || '').trim());
  }

  return false;
}

function isWebOSTranscodeProxyRequest(parsedUrl) {
  return (
    (parsedUrl.pathname || '') === '/api/proxy/vod/m3u8' &&
    getBoolQueryValue(parsedUrl.query, 'Transcode')
  );
}

async function handleWebOSCompatibilityHls(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname || '';
  if (
    !pathname.startsWith('/api/webos-hls/') &&
    !pathname.startsWith('/api/webos-media/') &&
    !pathname.startsWith('/api/webos-mjpeg/') &&
    !isWebOSTranscodeProxyRequest(parsedUrl)
  ) {
    return false;
  }

  if (req.method === 'OPTIONS') {
    setWebOSCompatibilityHeaders(res);
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (!['GET', 'HEAD'].includes(req.method)) {
    sendWebOSCompatibilityJson(res, 405, { error: 'Method not allowed' });
    return true;
  }

  try {
    if (pathname === '/api/webos-media/test-ladies.mp4') {
      await serveWebOSCompatibilityFile(req, res, '/tmp/ladies-clip.mp4', 'video/mp4');
      return true;
    }

    if (pathname === '/api/webos-hls/stream.m3u8') {
      await serveWebOSCompatibilityPlaylist(req, res, parsedUrl);
      return true;
    }

    if (isWebOSTranscodeProxyRequest(parsedUrl)) {
      await serveWebOSCompatibilityPlaylist(req, res, parsedUrl);
      return true;
    }

    if (pathname === '/api/webos-mjpeg/stream.mjpg') {
      await serveWebOSRenderedMjpeg(req, res, parsedUrl);
      return true;
    }

    const mediaMatch = /^\/api\/webos-hls\/([a-f0-9]{32})\/(init\.mp4|segment\d+\.(?:m4s|ts))$/.exec(pathname);
    if (mediaMatch) {
      await serveWebOSCompatibilityMedia(req, res, mediaMatch[1], mediaMatch[2]);
      return true;
    }

    sendWebOSCompatibilityJson(res, 404, { error: 'Not found' });
    return true;
  } catch (error) {
    console.error('[webOS HLS] request failed:', error);
    sendWebOSCompatibilityJson(res, 500, {
      error: 'webOS compatibility stream failed',
      details: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of webOSCompatibilityHlsSessions.entries()) {
    if (now - session.lastAccess < 45 * 60 * 1000) {
      continue;
    }

    if (session.process && !session.ended) {
      session.process.kill('SIGTERM');
    }
    webOSCompatibilityHlsSessions.delete(key);
  }
}, 10 * 60 * 1000).unref?.();

// 读取观影室配置的辅助函数
async function getWatchRoomConfig() {
  // 观影室配置现在统一从环境变量读取
  const config = {
    enabled: process.env.WATCH_ROOM_ENABLED === 'true',
    serverType: (process.env.WATCH_ROOM_SERVER_TYPE || 'internal'),
    externalServerUrl: process.env.WATCH_ROOM_EXTERNAL_SERVER_URL,
    externalServerAuth: process.env.WATCH_ROOM_EXTERNAL_SERVER_AUTH,
  };

  console.log(`[WatchRoom] Watch room ${config.enabled ? 'enabled' : 'disabled'} via environment variable.`);
  return config;
}

// 观影室服务器类
class WatchRoomServer {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.members = new Map();
    this.socketToRoom = new Map();
    this.screenHelpers = new Map();
    this.helperToRoom = new Map();
    this.roomDeletionTimers = new Map(); // 房间延迟删除定时器
    this.cleanupInterval = null;
    this.setupEventHandlers();
    this.startCleanupTimer();
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`[WatchRoom] Client connected: ${socket.id}`);

      // 创建房间
      socket.on('room:create', (data, callback) => {
        try {
          const roomId = this.generateRoomId();
          const userId = socket.id;
          const ownerToken = this.generateRoomId(); // 生成房主令牌

          const room = {
            id: roomId,
            name: data.name,
            description: data.description,
            password: data.password,
            isPublic: data.isPublic,
            roomType: data.roomType || 'sync',
            ownerId: userId,
            ownerName: data.userName,
            ownerToken: ownerToken, // 保存房主令牌
            memberCount: 1,
            currentState: null,
            createdAt: Date.now(),
            lastOwnerHeartbeat: Date.now(),
          };

          const member = {
            id: userId,
            name: data.userName,
            isOwner: true,
            lastHeartbeat: Date.now(),
          };

          this.rooms.set(roomId, room);
          this.members.set(roomId, new Map([[userId, member]]));
          this.socketToRoom.set(socket.id, {
            roomId,
            userId,
            userName: data.userName,
            isOwner: true,
          });

          socket.join(roomId);

          console.log(`[WatchRoom] Room created: ${roomId} by ${data.userName}`);
          callback({ success: true, room });
        } catch (error) {
          console.error('[WatchRoom] Error creating room:', error);
          callback({ success: false, error: '创建房间失败' });
        }
      });

      // 加入房间
      socket.on('room:join', (data, callback) => {
        try {
          const room = this.rooms.get(data.roomId);
          if (!room) {
            return callback({ success: false, error: '房间不存在' });
          }

          if (room.password && room.password !== data.password) {
            return callback({ success: false, error: '密码错误' });
          }

          const userId = socket.id;
          let isOwner = false;

          // 检查是否是房主重连（通过 ownerToken 验证）
          if (data.ownerToken && data.ownerToken === room.ownerToken) {
            isOwner = true;
            // 更新房主的 socket.id
            room.ownerId = userId;
            room.lastOwnerHeartbeat = Date.now();
            this.rooms.set(data.roomId, room);
            console.log(`[WatchRoom] Owner ${data.userName} reconnected to room ${data.roomId}`);
          }

          // 取消房间的删除定时器（如果有人重连）
          if (this.roomDeletionTimers.has(data.roomId)) {
            console.log(`[WatchRoom] Cancelling deletion timer for room ${data.roomId}`);
            clearTimeout(this.roomDeletionTimers.get(data.roomId));
            this.roomDeletionTimers.delete(data.roomId);
          }

          const member = {
            id: userId,
            name: data.userName,
            isOwner: isOwner,
            lastHeartbeat: Date.now(),
          };

          const roomMembers = this.members.get(data.roomId);
          if (roomMembers) {
            if (isOwner) {
              Array.from(roomMembers.entries()).forEach(([memberId, existingMember]) => {
                if (existingMember.isOwner && memberId !== userId) {
                  roomMembers.delete(memberId);
                }
              });
            }

            roomMembers.set(userId, member);
            room.memberCount = roomMembers.size;
            this.rooms.set(data.roomId, room);
          }

          this.socketToRoom.set(socket.id, {
            roomId: data.roomId,
            userId,
            userName: data.userName,
            isOwner: isOwner,
          });

          socket.join(data.roomId);
          socket.to(data.roomId).emit('room:member-joined', member);

          console.log(`[WatchRoom] User ${data.userName} joined room ${data.roomId}${isOwner ? ' (as owner)' : ''}`);

          const members = Array.from(roomMembers?.values() || []);
          callback({ success: true, room, members });
        } catch (error) {
          console.error('[WatchRoom] Error joining room:', error);
          callback({ success: false, error: '加入房间失败' });
        }
      });

      // 离开房间
      socket.on('room:leave', () => {
        this.handleLeaveRoom(socket);
      });

      // 获取房间列表
      socket.on('room:list', (callback) => {
        const publicRooms = Array.from(this.rooms.values()).filter((room) => room.isPublic);
        callback(publicRooms);
      });

      // 播放状态更新（任何成员都可以触发同步）
      socket.on('play:update', (state) => {
        console.log(`[WatchRoom] Received play:update from ${socket.id}:`, state);
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo || !roomInfo.isOwner) {
          console.log('[WatchRoom] No room info for socket, ignoring play:update');
          return;
        }

        const room = this.rooms.get(roomInfo.roomId);
        if (room) {
          room.currentState = state;
          this.rooms.set(roomInfo.roomId, room);
          console.log(`[WatchRoom] Broadcasting play:update to room ${roomInfo.roomId} from ${roomInfo.userName}`);
          socket.to(roomInfo.roomId).emit('play:update', state);
        } else {
          console.log('[WatchRoom] Room not found for play:update');
        }
      });

      // 播放进度跳转
      socket.on('play:seek', (currentTime) => {
        console.log(`[WatchRoom] Received play:seek from ${socket.id}:`, currentTime);
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo || !roomInfo.isOwner) {
          console.log('[WatchRoom] No room info for socket, ignoring play:seek');
          return;
        }
        console.log(`[WatchRoom] Broadcasting play:seek to room ${roomInfo.roomId}`);
        socket.to(roomInfo.roomId).emit('play:seek', currentTime);
      });

      // 播放
      socket.on('play:play', () => {
        console.log(`[WatchRoom] Received play:play from ${socket.id}`);
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo || !roomInfo.isOwner) {
          console.log('[WatchRoom] No room info for socket, ignoring play:play');
          return;
        }
        console.log(`[WatchRoom] Broadcasting play:play to room ${roomInfo.roomId}`);
        socket.to(roomInfo.roomId).emit('play:play');
      });

      // 暂停
      socket.on('play:pause', () => {
        console.log(`[WatchRoom] Received play:pause from ${socket.id}`);
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo || !roomInfo.isOwner) {
          console.log('[WatchRoom] No room info for socket, ignoring play:pause');
          return;
        }
        console.log(`[WatchRoom] Broadcasting play:pause to room ${roomInfo.roomId}`);
        socket.to(roomInfo.roomId).emit('play:pause');
      });

      // 切换视频/集数
      socket.on('play:change', (state) => {
        console.log(`[WatchRoom] Received play:change from ${socket.id}:`, state);
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) {
          console.log('[WatchRoom] No room info for socket, ignoring play:change');
          return;
        }
        if (!roomInfo.isOwner) {
          console.log('[WatchRoom] User is not owner, ignoring play:change');
          return;
        }

        const room = this.rooms.get(roomInfo.roomId);
        if (room) {
          room.currentState = state;
          this.rooms.set(roomInfo.roomId, room);
          console.log(`[WatchRoom] Broadcasting play:change to room ${roomInfo.roomId}`);
          socket.to(roomInfo.roomId).emit('play:change', state);
        } else {
          console.log('[WatchRoom] Room not found for play:change');
        }
      });

      // 切换直播频道
      socket.on('live:change', (state) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo || !roomInfo.isOwner) return;

        const room = this.rooms.get(roomInfo.roomId);
        if (room) {
          room.currentState = state;
          this.rooms.set(roomInfo.roomId, room);
          socket.to(roomInfo.roomId).emit('live:change', state);
        }
      });

      socket.on('music:change', (state) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo || !roomInfo.isOwner) return;

        const room = this.rooms.get(roomInfo.roomId);
        if (room?.roomType === 'music') {
          room.currentState = state;
          this.rooms.set(roomInfo.roomId, room);
          socket.to(roomInfo.roomId).emit('music:change', state);
        }
      });

      socket.on('music:update', (state) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo || !roomInfo.isOwner) return;

        const room = this.rooms.get(roomInfo.roomId);
        if (room?.roomType === 'music') {
          room.currentState = state;
          this.rooms.set(roomInfo.roomId, room);
          socket.to(roomInfo.roomId).emit('music:update', state);
        }
      });

      socket.on('music:queue', (state) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo || !roomInfo.isOwner) return;

        const room = this.rooms.get(roomInfo.roomId);
        if (room?.roomType === 'music') {
          room.currentState = state;
          this.rooms.set(roomInfo.roomId, room);
          socket.to(roomInfo.roomId).emit('music:queue', state);
        }
      });

      socket.on('music:play', (state) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo || !roomInfo.isOwner) return;

        const room = this.rooms.get(roomInfo.roomId);
        if (room?.roomType === 'music') {
          room.currentState = { ...state, isPlaying: true };
          this.rooms.set(roomInfo.roomId, room);
          socket.to(roomInfo.roomId).emit('music:play', state);
        }
      });

      socket.on('music:pause', (state) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo || !roomInfo.isOwner) return;

        const room = this.rooms.get(roomInfo.roomId);
        if (room?.roomType === 'music') {
          room.currentState = { ...state, isPlaying: false };
          this.rooms.set(roomInfo.roomId, room);
          socket.to(roomInfo.roomId).emit('music:pause', state);
        }
      });

      socket.on('music:seek', (state) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo || !roomInfo.isOwner) return;

        const room = this.rooms.get(roomInfo.roomId);
        if (room?.roomType === 'music') {
          room.currentState = { ...state };
          this.rooms.set(roomInfo.roomId, room);
          socket.to(roomInfo.roomId).emit('music:seek', state);
        }
      });

      socket.on('screen:helper-register', (data, callback) => {
        try {
          const room = this.rooms.get(data.roomId);
          if (!room) {
            callback({ success: false, error: '房间不存在' });
            return;
          }

          if (room.ownerToken !== data.ownerToken) {
            callback({ success: false, error: '房主身份验证失败' });
            return;
          }

          const oldHelperSocketId = this.screenHelpers.get(data.roomId);
          if (oldHelperSocketId && oldHelperSocketId !== socket.id) {
            this.helperToRoom.delete(oldHelperSocketId);
          }

          this.screenHelpers.set(data.roomId, socket.id);
          this.helperToRoom.set(socket.id, data.roomId);
          callback({ success: true });
        } catch (error) {
          console.error('[WatchRoom] Error registering screen helper:', error);
          callback({ success: false, error: '注册共享控制窗口失败' });
        }
      });

      // 开始屏幕共享
      socket.on('screen:start', (state) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        const helperRoomId = this.helperToRoom.get(socket.id);
        const roomId = roomInfo?.roomId || helperRoomId;
        if (!roomId) return;
        if (helperRoomId && this.screenHelpers.get(helperRoomId) !== socket.id) return;
        if (roomInfo && !roomInfo.isOwner) return;

        const room = this.rooms.get(roomId);
        if (room) {
          room.currentState = state;
          this.rooms.set(roomId, room);
          this.io.to(roomId).emit('screen:start', state);
        }
      });

      // 停止屏幕共享
      socket.on('screen:stop', () => {
        const roomInfo = this.socketToRoom.get(socket.id);
        const helperRoomId = this.helperToRoom.get(socket.id);
        const roomId = roomInfo?.roomId || helperRoomId;
        if (!roomId) return;
        if (helperRoomId && this.screenHelpers.get(helperRoomId) !== socket.id) return;
        if (roomInfo && !roomInfo.isOwner) return;

        const room = this.rooms.get(roomId);
        if (room) {
          room.currentState = null;
          this.rooms.set(roomId, room);
          this.io.to(roomId).emit('screen:stop');
        }
      });

      socket.on('screen:viewer-ready', () => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) return;

        const room = this.rooms.get(roomInfo.roomId);
        if (!room || roomInfo.isOwner || room.currentState?.type !== 'screen') return;

        const targetSocketId = this.screenHelpers.get(roomInfo.roomId) || room.ownerId;
        this.io.to(targetSocketId).emit('screen:viewer-ready', {
          userId: socket.id,
        });
      });

      // 屏幕共享 WebRTC 信令
      socket.on('screen:offer', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        const helperRoomId = this.helperToRoom.get(socket.id);
        if (!roomInfo && !helperRoomId) return;

        this.io.to(data.targetUserId).emit('screen:offer', {
          userId: socket.id,
          offer: data.offer,
        });
      });

      socket.on('screen:answer', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        const helperRoomId = this.helperToRoom.get(socket.id);
        if (!roomInfo && !helperRoomId) return;

        this.io.to(data.targetUserId).emit('screen:answer', {
          userId: socket.id,
          answer: data.answer,
        });
      });

      socket.on('screen:ice', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        const helperRoomId = this.helperToRoom.get(socket.id);
        if (!roomInfo && !helperRoomId) return;

        this.io.to(data.targetUserId).emit('screen:ice', {
          userId: socket.id,
          candidate: data.candidate,
        });
      });

      // 聊天消息
      socket.on('chat:message', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) return;

        const message = {
          id: this.generateMessageId(),
          userId: roomInfo.userId,
          userName: roomInfo.userName,
          content: data.content,
          type: data.type,
          timestamp: Date.now(),
        };

        this.io.to(roomInfo.roomId).emit('chat:message', message);
      });

      // WebRTC 信令
      socket.on('voice:offer', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) return;
        this.io.to(data.targetUserId).emit('voice:offer', {
          userId: socket.id,
          offer: data.offer,
        });
      });

      socket.on('voice:answer', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) return;
        this.io.to(data.targetUserId).emit('voice:answer', {
          userId: socket.id,
          answer: data.answer,
        });
      });

      socket.on('voice:ice', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) return;
        this.io.to(data.targetUserId).emit('voice:ice', {
          userId: socket.id,
          candidate: data.candidate,
        });
      });

      // 语音聊天 - 服务器中转音频数据
      socket.on('voice:audio-chunk', (data) => {
        const roomInfo = this.socketToRoom.get(socket.id);
        if (!roomInfo) return;

        // 将音频数据转发给房间内的其他成员
        socket.to(roomInfo.roomId).emit('voice:audio-chunk', {
          userId: socket.id,
          audioData: data.audioData,
          sampleRate: data.sampleRate || 16000,
        });
      });

      // 心跳
      socket.on('heartbeat', () => {
        const roomInfo = this.socketToRoom.get(socket.id);

        // 如果用户在房间中，更新心跳时间
        if (roomInfo) {
          const roomMembers = this.members.get(roomInfo.roomId);
          const member = roomMembers?.get(roomInfo.userId);
          if (member) {
            member.lastHeartbeat = Date.now();
            roomMembers?.set(roomInfo.userId, member);
          }

          if (roomInfo.isOwner) {
            const room = this.rooms.get(roomInfo.roomId);
            if (room) {
              room.lastOwnerHeartbeat = Date.now();
              this.rooms.set(roomInfo.roomId, room);
            }
          }
        }

        // 无论是否在房间中，都响应心跳包（pong）
        socket.emit('heartbeat:pong', { timestamp: Date.now() });
      });

      // 断开连接
      socket.on('disconnect', () => {
        console.log(`[WatchRoom] Client disconnected: ${socket.id}`);
        const helperRoomId = this.helperToRoom.get(socket.id);
        if (helperRoomId) {
          this.helperToRoom.delete(socket.id);
          if (this.screenHelpers.get(helperRoomId) === socket.id) {
            this.screenHelpers.delete(helperRoomId);
            const room = this.rooms.get(helperRoomId);
            if (room && room.currentState?.type === 'screen') {
              room.currentState = null;
              this.rooms.set(helperRoomId, room);
              this.io.to(helperRoomId).emit('screen:stop');
            }
          }
        }
        this.handleLeaveRoom(socket);
      });
    });
  }

  handleLeaveRoom(socket) {
    const roomInfo = this.socketToRoom.get(socket.id);
    if (!roomInfo) return;

    const { roomId, userId, isOwner } = roomInfo;
    const room = this.rooms.get(roomId);
    const roomMembers = this.members.get(roomId);

    if (roomMembers) {
      roomMembers.delete(userId);

      if (room) {
        room.memberCount = roomMembers.size;
        this.rooms.set(roomId, room);
      }

      socket.to(roomId).emit('room:member-left', userId);

      // 如果是房主主动离开，解散房间并踢出所有成员
      if (isOwner) {
        console.log(`[WatchRoom] Owner actively left room ${roomId}, disbanding room`);

        // 通知所有成员房间被解散
        socket.to(roomId).emit('room:deleted', { reason: 'owner_left' });

        // 强制所有成员离开房间
        const members = Array.from(roomMembers.keys());
        members.forEach(memberId => {
          this.socketToRoom.delete(memberId);
        });

        // 立即删除房间（跳过通知，因为上面已经发送了）
        this.deleteRoom(roomId, true);

        // 清除可能存在的删除定时器
        if (this.roomDeletionTimers.has(roomId)) {
          clearTimeout(this.roomDeletionTimers.get(roomId));
          this.roomDeletionTimers.delete(roomId);
        }
      } else {
        // 普通成员离开，房间为空时延迟删除
        if (roomMembers.size === 0) {
          console.log(`[WatchRoom] Room ${roomId} is now empty, will delete in 30 seconds if no one rejoins`);

          const deletionTimer = setTimeout(() => {
            // 再次检查房间是否仍然为空
            const currentRoomMembers = this.members.get(roomId);
            if (currentRoomMembers && currentRoomMembers.size === 0) {
              console.log(`[WatchRoom] Room ${roomId} deletion timer expired, deleting room`);
              this.deleteRoom(roomId);
              this.roomDeletionTimers.delete(roomId);
            }
          }, 30000); // 30秒后删除

          this.roomDeletionTimers.set(roomId, deletionTimer);
        }
      }
    }

    socket.leave(roomId);
    this.socketToRoom.delete(socket.id);
  }

  deleteRoom(roomId, skipNotify = false) {
    console.log(`[WatchRoom] Deleting room ${roomId}`);

    // 如果不跳过通知，则发送 room:deleted 事件
    if (!skipNotify) {
      this.io.to(roomId).emit('room:deleted');
    }

    this.rooms.delete(roomId);
    this.members.delete(roomId);
    const helperSocketId = this.screenHelpers.get(roomId);
    if (helperSocketId) {
      this.helperToRoom.delete(helperSocketId);
      this.screenHelpers.delete(roomId);
    }
  }

  startCleanupTimer() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const deleteTimeout = 5 * 60 * 1000; // 5分钟 - 删除房间
      const clearStateTimeout = 30 * 1000; // 30秒 - 清除播放状态

      for (const [roomId, room] of this.rooms.entries()) {
        const timeSinceHeartbeat = now - room.lastOwnerHeartbeat;

        // 如果房主心跳超过30秒，清除播放状态
        if (timeSinceHeartbeat > clearStateTimeout && room.currentState !== null) {
          console.log(`[WatchRoom] Room ${roomId} owner inactive for 30s, clearing play state`);
          room.currentState = null;
          this.rooms.set(roomId, room);
          // 通知房间内所有成员状态已清除
          this.io.to(roomId).emit('state:cleared');
        }

        // 检查房主是否超时5分钟 - 删除房间
        if (timeSinceHeartbeat > deleteTimeout) {
          console.log(`[WatchRoom] Room ${roomId} owner timeout, deleting...`);
          this.deleteRoom(roomId);
        }
      }
    }, 10000); // 每10秒检查一次，确保更及时的清理
  }

  generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  generateMessageId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // 清理所有房间删除定时器
    for (const timer of this.roomDeletionTimers.values()) {
      clearTimeout(timer);
    }
    this.roomDeletionTimers.clear();
  }
}

function parseCookieHeader(cookieHeader) {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((acc, part) => {
    const index = part.indexOf('=');
    if (index <= 0) return acc;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) acc[key] = value;
    return acc;
  }, {});
}

function parseSocketAuth(socket) {
  const cookies = parseCookieHeader(socket.handshake.headers.cookie || '');
  const raw = cookies.auth || socket.handshake.auth?.token || '';
  if (!raw) return null;

  let decoded = raw;
  try {
    decoded = decodeURIComponent(decoded);
  } catch {}

  if (decoded.includes('%')) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {}
  }

  try {
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

class TVRemoteServer {
  constructor(io) {
    this.io = io;
    this.cleanupInterval = null;
    attachTVRemoteIO(io);
    this.setupEventHandlers();
    this.startCleanupTimer();
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      socket.on('tv-remote:register-tv', (data, callback) => {
        const auth = parseSocketAuth(socket);
        if (!auth?.username) {
          callback?.({ success: false, error: '未登录' });
          return;
        }

        const deviceId = String(data?.deviceId || '').slice(0, 128);
        if (!deviceId) {
          callback?.({ success: false, error: '缺少设备 ID' });
          return;
        }

        callback?.(registerTVRemoteDevice(socket.id, auth.username, data));
      });

      socket.on('tv-remote:tv-state', (data) => {
        const auth = parseSocketAuth(socket);
        if (!auth?.username) return;
        updateTVRemoteDevice(socket.id, auth.username, data);
      });

      socket.on('disconnect', () => {
        removeTVRemoteSocket(socket.id);
      });
    });
  }

  startCleanupTimer() {
    this.cleanupInterval = setInterval(() => {
      cleanupTVRemoteDevices();
    }, 30_000);
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    clearTVRemoteHub();
  }
}

app.prepare().then(async () => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      if (await handleWebOSCompatibilityHls(req, res, parsedUrl)) {
        return;
      }
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });

  // 读取观影室配置
  const watchRoomConfig = await getWatchRoomConfig();
  console.log('[WatchRoom] Config:', watchRoomConfig);

  let watchRoomServer = null;
  let tvRemoteServer = null;
  let io = null;

  const tvModeEnabled = isTVModeEnabled();
  const shouldStartInternalWatchRoom =
    watchRoomConfig.enabled && watchRoomConfig.serverType === 'internal';

  if (tvModeEnabled || shouldStartInternalWatchRoom) {
    io = new Server(httpServer, {
      path: '/socket.io',
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });
  }

  if (tvModeEnabled && io) {
    tvRemoteServer = new TVRemoteServer(io);
    console.log('[TVRemote] Socket.IO remote server initialized');
  } else {
    console.log('[TVRemote] TV mode disabled, remote server not initialized');
  }

  if (shouldStartInternalWatchRoom && io) {
    // 初始化观影室服务器
    watchRoomServer = new WatchRoomServer(io);
    console.log('[WatchRoom] Socket.IO server initialized');
  } else {
    if (!watchRoomConfig.enabled) {
      console.log('[WatchRoom] Watch room is disabled');
    } else if (watchRoomConfig.serverType === 'external') {
      console.log('[WatchRoom] Using external watch room server');
    }
  }

  httpServer
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
      if (io) {
        console.log(`> Socket.IO ready on ws://${hostname}:${port}`);
      } else {
        console.log('> Socket.IO disabled');
      }
    });

  const forceExit = (signal) => {
    console.log(`\n[Server] Received ${signal}, force exiting...`);
    process.exit(0);
  };

  process.on('SIGINT', () => forceExit('SIGINT'));
  process.on('SIGTERM', () => forceExit('SIGTERM'));
});
