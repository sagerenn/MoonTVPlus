'use client';

import { useEffect } from 'react';
import { type Socket,io } from 'socket.io-client';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import {
  applyTVRemoteText,
  fireTVRemoteKey,
} from '@/lib/tv-remote-core';
import type {
  TVRemoteKeyCommand,
  TVRemotePlayCommand,
  TVRemoteTextCommand,
} from '@/lib/tv-remote-types';

const DEVICE_ID_KEY = 'moontv_tv_remote_device_id';

type TVRemoteReceiverSingleton = {
  socket: Socket | null;
  refCount: number;
  disconnectTimer: number | null;
};

const receiverState: TVRemoteReceiverSingleton = {
  socket: null,
  refCount: 0,
  disconnectTimer: null,
};

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `tv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function getDeviceName() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android TV Web';
  if (/Windows/i.test(ua)) return 'Windows TV Web';
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac TV Web';
  return 'Web TV';
}

function buildTVPlayUrl(command: TVRemotePlayCommand) {
  const params = new URLSearchParams();
  if (command.source) params.set('source', command.source);
  if (command.id) params.set('id', command.id);
  const title = command.source || command.id
    ? command.title
    : command.searchTitle || command.title;
  if (title) params.set('title', title);
  if (command.fileName) params.set('fileName', command.fileName);
  if (typeof command.index === 'number' && Number.isFinite(command.index)) {
    params.set('index', String(Math.max(0, Math.floor(command.index))));
  }
  return `/tv/play?${params.toString()}`;
}

export default function TVRemoteReceiver() {
  useEffect(() => {
    const auth = getAuthInfoFromBrowserCookie();
    if (!auth?.username) return;

    receiverState.refCount += 1;
    if (receiverState.disconnectTimer) {
      window.clearTimeout(receiverState.disconnectTimer);
      receiverState.disconnectTimer = null;
    }

    if (!receiverState.socket) {
      receiverState.socket = io({
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });
    }

    const socket = receiverState.socket;

    const register = () => {
      socket.timeout(5000).emit(
        'tv-remote:register-tv',
        {
          deviceId: getDeviceId(),
          deviceName: getDeviceName(),
          currentPath: window.location.pathname,
          title: document.title,
        },
        (error: Error | null, response?: { success: boolean; error?: string }) => {
          if (error || !response?.success) {
            // eslint-disable-next-line no-console
            console.warn('[TVRemote] TV registration failed:', error || response?.error);
          }
        }
      );
    };

    const updateState = () => {
      socket.emit('tv-remote:tv-state', {
        deviceId: getDeviceId(),
        currentPath: window.location.pathname,
        title: document.title,
      });
    };

    socket.on('connect', register);
    socket.on('tv-remote:key', (command: TVRemoteKeyCommand) => {
      fireTVRemoteKey(command);
    });
    socket.on('tv-remote:text', (command: TVRemoteTextCommand) => {
      applyTVRemoteText(command);
    });
    socket.on('tv-remote:play', (command: TVRemotePlayCommand) => {
      if (!command?.title && !command?.id) return;
      window.location.href = buildTVPlayUrl(command);
    });

    const interval = window.setInterval(updateState, 10000);
    const onVisibilityChange = () => {
      if (!document.hidden) updateState();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', updateState);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', updateState);
      socket.off('connect', register);
      socket.off('tv-remote:key');
      socket.off('tv-remote:text');
      socket.off('tv-remote:play');
      receiverState.refCount = Math.max(0, receiverState.refCount - 1);
      if (receiverState.refCount === 0) {
        receiverState.disconnectTimer = window.setTimeout(() => {
          if (receiverState.refCount > 0) return;
          receiverState.socket?.disconnect();
          receiverState.socket = null;
          receiverState.disconnectTimer = null;
        }, 1000);
      }
    };
  }, []);

  return null;
}
