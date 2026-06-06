export type TVRemoteKey =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'ok'
  | 'back'
  | 'menu'
  | 'home'
  | 'playPause'
  | 'pageUp'
  | 'pageDown'
  | 'digit';

export type TVRemoteTextMode = 'replace' | 'append' | 'backspace' | 'clear';

export interface TVRemoteDevice {
  deviceId: string;
  deviceName: string;
  currentPath: string;
  title?: string;
  lastActiveAt: number;
}

export interface TVRemoteKeyCommand {
  key: TVRemoteKey;
  repeat?: boolean;
  digit?: string;
}

export interface TVRemoteTextCommand {
  mode: TVRemoteTextMode;
  text?: string;
}

export interface TVRemoteDanmakuItem {
  text: string;
  time: number;
  color?: string;
  mode?: number;
}

export interface TVRemoteDanmakuPayload {
  enabled?: boolean;
  selection?: {
    animeId?: number;
    episodeId?: number;
    animeTitle?: string;
    episodeTitle?: string;
    searchKeyword?: string;
  };
  settings?: {
    opacity?: number;
    fontSize?: number;
    speed?: number;
    marginTop?: number;
    marginBottom?: number | string;
    synchronousPlayback?: boolean;
  };
  comments?: TVRemoteDanmakuItem[];
}

export interface TVRemotePlaybackState {
  currentTime?: number;
  duration?: number;
  playbackRate?: number;
  paused?: boolean;
  updatedAt?: number;
}

export interface TVRemotePlayCommand {
  source?: string;
  id?: string;
  title: string;
  searchTitle?: string;
  fileName?: string;
  index?: number;
  playback?: TVRemotePlaybackState;
  danmaku?: TVRemoteDanmakuPayload;
}

export interface TVRemoteSyncCommand extends TVRemotePlaybackState {
  source?: string;
  id?: string;
  index?: number;
  title?: string;
  danmaku?: TVRemoteDanmakuPayload;
}
