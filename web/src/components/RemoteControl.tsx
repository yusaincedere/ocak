import {
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
  VideoTrack,
  type TrackReference,
} from '@livekit/components-react';
import { RoomEvent, Track, type RemoteParticipant } from 'livekit-client';
import { useCallback, useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { CONTROL_ATTRIBUTE, CONTROL_TOPIC, endReasonText, isControllable, parseControl, sendControl } from '../control';
import { desktop, type ControlInput } from '../desktop-bridge';
import { useStore } from '../store';
import { X } from './Icons';

// ======================================================================================
// Sharer side (desktop app only): advertise, ask for consent, forward input to the app.
// ======================================================================================

export function SharerControl() {
  const room = useRoomContext();
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  const [controller, setController] = useState<{ id: string; name: string } | null>(null);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  // Advertise "my whole screen can be controlled" while sharing a screen (not a window).
  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    void (async () => {
      const kind = isScreenShareEnabled ? await desktop!.getShareKind() : null;
      if (cancelled) return;
      if (!isScreenShareEnabled) desktop!.shareStopped();
      await localParticipant.setAttributes({ [CONTROL_ATTRIBUTE]: kind === 'screen' ? 'screen' : '' }).catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [isScreenShareEnabled, localParticipant]);

  // Leaving the call ends everything.
  useEffect(() => () => desktop?.stopControl(), []);

  // The app ended the session (Stop button, shortcut, timeout, share stopped).
  useEffect(
    () =>
      desktop?.onControlEnded((reason) => {
        const c = controllerRef.current;
        if (c) void sendControl(localParticipant, c.id, { t: 'ended', reason });
        setController(null);
        useStore.getState().setNotice(c ? `Remote control by ${c.name} ended.` : 'Remote control ended.');
      }),
    [localParticipant],
  );

  useEffect(() => {
    if (!desktop) return;
    const onData = async (payload: Uint8Array, from?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (topic !== CONTROL_TOPIC || !from) return;
      const msg = parseControl(payload);
      if (!msg) return;
      const current = controllerRef.current;

      if (msg.t === 'input') {
        if (current?.id === from.identity) desktop!.injectInput(from.identity, msg.e);
      } else if (msg.t === 'request') {
        if (current) return void sendControl(localParticipant, from.identity, { t: 'denied', reason: 'busy' });
        const name = from.name || 'Someone';
        const res = await desktop!.confirmControl(from.identity, name);
        if (res.allow) {
          setController({ id: from.identity, name });
          void sendControl(localParticipant, from.identity, { t: 'granted', until: res.until });
        } else {
          if (res.error) useStore.getState().setNotice(res.error);
          void sendControl(localParticipant, from.identity, { t: 'denied', reason: res.error });
        }
      } else if (msg.t === 'ended' && current?.id === from.identity) {
        desktop!.stopControl(); // onControlEnded clears our state
      }
    };
    const onLeft = (p: RemoteParticipant) => {
      if (controllerRef.current?.id === p.identity) desktop!.stopControl();
    };
    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.ParticipantDisconnected, onLeft);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.ParticipantDisconnected, onLeft);
    };
  }, [room, localParticipant]);

  if (!controller) return null;
  return (
    <div className="control-banner sharer">
      <span className="rec-dot" />
      <span>
        <strong>{controller.name}</strong> is controlling your screen
      </span>
      <button className="btn small-btn" onClick={() => desktop?.stopControl()}>
        Stop
      </button>
    </div>
  );
}

// ======================================================================================
// Viewer side (browser or desktop): request control, then drive the remote screen.
// ======================================================================================

type ViewerState =
  | { s: 'idle' }
  | { s: 'asking'; id: string; name: string }
  | { s: 'controlling'; id: string; name: string; until: number | null };

export function ViewerControl() {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const screenTracks = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }], {
    onlySubscribed: true,
  }).filter((t): t is TrackReference => !!t.publication && !t.participant.isLocal);
  const [state, setState] = useState<ViewerState>({ s: 'idle' });
  const stateRef = useRef(state);
  stateRef.current = state;

  const target = screenTracks.find((t) => isControllable(t.participant));
  const activeTrack = state.s === 'idle' ? undefined : screenTracks.find((t) => t.participant.identity === state.id);

  // Replies from the sharer.
  useEffect(() => {
    const onData = (payload: Uint8Array, from?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (topic !== CONTROL_TOPIC || !from) return;
      const st = stateRef.current;
      if (st.s === 'idle' || st.id !== from.identity) return;
      const msg = parseControl(payload);
      if (!msg) return;
      if (msg.t === 'granted' && st.s === 'asking') setState({ s: 'controlling', id: st.id, name: st.name, until: msg.until });
      else if (msg.t === 'denied') {
        setState({ s: 'idle' });
        useStore
          .getState()
          .setNotice(msg.reason === 'busy' ? `Someone else is already controlling ${st.name}'s screen.` : `${st.name} didn't allow remote control.`);
      } else if (msg.t === 'ended') {
        setState({ s: 'idle' });
        useStore.getState().setNotice(`${st.name} ${endReasonText[msg.reason ?? 'stopped'] ?? 'ended remote control'}.`);
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room]);

  // The sharer stopped sharing, left, or is no longer controllable.
  useEffect(() => {
    if (state.s === 'idle') return;
    const p = participants.find((x) => x.identity === state.id);
    if (!p || !activeTrack || !isControllable(p)) {
      setState({ s: 'idle' });
      if (state.s === 'controlling') useStore.getState().setNotice(`Remote control of ${state.name}'s screen ended.`);
    }
  }, [participants, activeTrack, state]);

  // Give up waiting after a while (their dialog times out too).
  useEffect(() => {
    if (state.s !== 'asking') return;
    const t = setTimeout(() => {
      setState({ s: 'idle' });
      useStore.getState().setNotice(`${state.name} didn't answer.`);
    }, 50_000);
    return () => clearTimeout(t);
  }, [state]);

  const stop = useCallback(() => {
    const st = stateRef.current;
    if (st.s !== 'idle') void sendControl(localParticipant, st.id, { t: 'ended', reason: 'cancelled' });
    setState({ s: 'idle' });
  }, [localParticipant]);

  if (state.s === 'controlling' && activeTrack)
    return <ControlSurface track={activeTrack} name={state.name} until={state.until} onStop={stop} />;

  if (state.s === 'asking')
    return (
      <div className="control-pill">
        <span>Waiting for {state.name} to allow…</span>
        <button className="icon-btn small" title="Cancel" onClick={stop}>
          <X size={14} />
        </button>
      </div>
    );

  if (!target) return null;
  const name = target.participant.name || 'Someone';
  return (
    <button
      className="control-pill request"
      onClick={() => {
        setState({ s: 'asking', id: target.participant.identity, name });
        void sendControl(localParticipant, target.participant.identity, { t: 'request' });
      }}
    >
      <PointerIcon /> Request control of {name}'s screen
    </button>
  );
}

/** Full-stage view of the remote screen that captures mouse and keyboard and forwards them. */
function ControlSurface({
  track,
  name,
  until,
  onStop,
}: {
  track: TrackReference;
  name: string;
  until: number | null;
  onStop: () => void;
}) {
  const { localParticipant } = useLocalParticipant();
  const video = useRef<HTMLVideoElement>(null);
  const to = track.participant.identity;
  const pendingMove = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef(0);
  const [left, setLeft] = useState<number | null>(null);

  const send = useCallback((e: ControlInput) => void sendControl(localParticipant, to, { t: 'input', e }), [localParticipant, to]);

  /** Pointer position → 0..1 within the actual picture (the video is letterboxed). */
  const toNormalized = (clientX: number, clientY: number) => {
    const v = video.current;
    if (!v || !v.videoWidth) return null;
    const r = v.getBoundingClientRect();
    const scale = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
    const w = v.videoWidth * scale;
    const h = v.videoHeight * scale;
    const x = (clientX - (r.left + (r.width - w) / 2)) / w;
    const y = (clientY - (r.top + (r.height - h) / 2)) / h;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  };

  const onMove = (e: PointerEvent) => {
    const p = toNormalized(e.clientX, e.clientY);
    if (!p) return;
    pendingMove.current = p;
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (pendingMove.current) send({ t: 'move', ...pendingMove.current });
        pendingMove.current = null;
      });
  };
  const onButton = (e: PointerEvent, down: boolean) => {
    const p = toNormalized(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    // Keep receiving the drag even if the pointer leaves the video.
    if (down) e.currentTarget.setPointerCapture(e.pointerId);
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    send({ t: 'button', button, down, ...p });
  };

  // Wheel needs a non-passive listener to stop the page itself from scrolling.
  useEffect(() => {
    const el = video.current?.parentElement;
    if (!el) return;
    const onWheel = (e: globalThis.WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
      send({ t: 'wheel', dx: e.deltaX * unit, dy: e.deltaY * unit });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [send]);

  // Keyboard goes to the remote screen while this view is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent, down: boolean) => {
      // Typing in our own UI (chat, rename...) stays local.
      if ((e.target as HTMLElement | null)?.closest?.('.control-bar, input, textarea, [contenteditable]')) return;
      e.preventDefault();
      send({
        t: 'key',
        code: e.code,
        key: e.key,
        down,
        shift: e.shiftKey,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        meta: e.metaKey,
      });
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      cancelAnimationFrame(frame.current);
    };
  }, [send]);

  useEffect(() => {
    if (!until) return;
    const tick = () => setLeft(Math.max(0, Math.round((until - Date.now()) / 60_000)));
    tick();
    const t = setInterval(tick, 15_000);
    return () => clearInterval(t);
  }, [until]);

  return (
    <div className="control-surface">
      <div className="control-bar">
        <span className="rec-dot" />
        <span>
          You're controlling <strong>{name}</strong>'s screen
          {left !== null && <span className="muted"> · {left} min left</span>}
        </span>
        <button className="btn small-btn" onClick={onStop}>
          Stop
        </button>
      </div>
      <div
        className="control-video"
        onPointerMove={onMove}
        onPointerDown={(e) => onButton(e, true)}
        onPointerUp={(e) => onButton(e, false)}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={(e: WheelEvent) => e.preventDefault()}
      >
        <VideoTrack ref={video} trackRef={track} />
      </div>
    </div>
  );
}

function PointerIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="m4 4 7 17 2.5-7.5L21 11z" />
    </svg>
  );
}
