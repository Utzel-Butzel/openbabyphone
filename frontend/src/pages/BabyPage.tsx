import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import type { Socket } from "socket.io-client";

import { StatusChip } from "../components/StatusChip";
import { StreamCard } from "../components/StreamCard";
import { analyzeMotionFrame } from "../lib/motion-detection";
import { createSignalingSocket } from "../lib/socket";
import { fallbackIceServers, fetchRuntimeConfig } from "../lib/runtime-config";
import { createPeerConnection, type StreamMode } from "../lib/webrtc";

interface RoomResponse {
  ok: boolean;
  roomCode?: string;
  motionEnabled?: boolean;
  error?: string;
}

interface CandidatePayload {
  candidate: RTCIceCandidateInit;
}

interface SdpPayload {
  sdp: string;
}

interface MotionUpdatePayload {
  roomCode: string;
  detected: boolean;
  score: number;
  detectedAt: number | null;
}

interface MotionSettingsPayload {
  roomCode: string;
  enabled: boolean;
}

interface StreamModePayload {
  mode: StreamMode;
}

const motionSampleIntervalMs = 850;
const motionHoldMs = 2500;
const motionBroadcastIntervalMs = 2000;
const motionFrameWidth = 160;
const motionFrameHeight = 90;

const videoMediaConstraints: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

const audioOnlyMediaConstraints: MediaStreamConstraints = {
  video: false,
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

export function BabyPage() {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const motionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const motionIntervalRef = useRef<number | null>(null);
  const previousMotionFrameRef = useRef<Uint8ClampedArray | null>(null);
  const motionEnabledRef = useRef(true);
  const motionDetectedRef = useRef(false);
  const motionScoreRef = useRef(0);
  const lastMotionAtRef = useRef<number | null>(null);
  const lastMotionBroadcastAtRef = useRef(0);
  const socketRef = useRef<Socket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const roomCodeRef = useRef("");
  const iceServersRef = useRef<RTCIceServer[]>(fallbackIceServers);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const streamModeRef = useRef<StreamMode>("video");
  const mediaSyncRef = useRef<Promise<void>>(Promise.resolve());

  const [roomCode, setRoomCode] = useState("");
  const [status, setStatus] = useState(
    "Grant camera and microphone access to publish the nursery stream.",
  );
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [hasStream, setHasStream] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [motionDetected, setMotionDetected] = useState(false);
  const [motionScore, setMotionScore] = useState(0);
  const [lastMotionAt, setLastMotionAt] = useState<number | null>(null);
  const [streamMode, setStreamMode] = useState<StreamMode>("video");

  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  useEffect(() => {
    streamModeRef.current = streamMode;
  }, [streamMode]);

  useEffect(() => {
    void fetchRuntimeConfig().then((config) => {
      iceServersRef.current = config.iceServers;
    });
  }, []);

  useEffect(() => {
    const socket = createSignalingSocket();
    socketRef.current = socket;

    socket.on("connect_error", () => {
      setError("Could not reach the signaling server.");
    });

    socket.on("room:peer-ready", () => {
      setStatus(
        streamModeRef.current === "audio-only"
          ? "Parent device is present. Negotiating the live audio feed now."
          : "Parent device is present. Negotiating the live stream now.",
      );
      emitMotionUpdate(
        motionDetectedRef.current,
        motionScoreRef.current,
        lastMotionAtRef.current,
      );
    });

    socket.on("motion:settings", ({ enabled }: MotionSettingsPayload) => {
      applyMotionEnabled(enabled, { broadcast: false });
    });

    socket.on("stream:mode", ({ mode }: StreamModePayload) => {
      const nextMode = mode ?? "video";

      streamModeRef.current = nextMode;
      setStreamMode(nextMode);
      setStatus(
        nextMode === "audio-only"
          ? "Parent requested audio-only mode. Pausing the crib camera to save battery."
          : "Parent requested video mode. Restarting the crib camera now.",
      );

      void syncLocalStreamMode(nextMode).catch((streamError) => {
        setError(
          readableError(streamError, "Could not switch the local stream mode."),
        );
      });
    });

    socket.on("signal:offer", async ({ sdp }: SdpPayload) => {
      try {
        await syncLocalStreamMode(streamModeRef.current);

        const peer = createPublishingPeer();

        await peer.setRemoteDescription({ type: "offer", sdp });
        await flushPendingCandidates(peer);

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        socket.emit("signal:answer", {
          roomCode: roomCodeRef.current,
          sdp: answer.sdp,
        });

        setError(null);
        setStatus(
          streamModeRef.current === "audio-only"
            ? "Audio-only monitoring is online."
            : "Live stream is online.",
        );
      } catch (streamError) {
        setError(
          readableError(streamError, "Could not answer the parent device."),
        );
      }
    });

    socket.on(
      "signal:ice-candidate",
      async ({ candidate }: CandidatePayload) => {
        const peer = peerRef.current;

        if (!peer || !peer.remoteDescription) {
          pendingCandidatesRef.current.push(candidate);
          return;
        }

        try {
          await peer.addIceCandidate(candidate);
        } catch {
          setError("A network candidate could not be applied.");
        }
      },
    );

    socket.on("room:peer-left", () => {
      destroyPeerConnection();
      setIsConnected(false);
      setStatus(
        "Parent disconnected. The room remains active for the next connection.",
      );
    });

    return () => {
      socket.emit("room:leave");
      socket.disconnect();
      stopLocalStream();
      destroyPeerConnection();
    };
  }, []);

  const pairingUrl = useMemo(() => {
    if (!roomCode) {
      return "";
    }

    return `${window.location.origin}/parent?room=${roomCode}`;
  }, [roomCode]);

  async function flushPendingCandidates(peer: RTCPeerConnection) {
    const queuedCandidates = [...pendingCandidatesRef.current];
    pendingCandidatesRef.current = [];

    for (const candidate of queuedCandidates) {
      await peer.addIceCandidate(candidate);
    }
  }

  function destroyPeerConnection() {
    pendingCandidatesRef.current = [];
    peerRef.current?.close();
    peerRef.current = null;
  }

  function emitMotionUpdate(
    detected: boolean,
    score: number,
    detectedAt: number | null,
  ) {
    const normalizedRoomCode = roomCodeRef.current.trim();

    if (!normalizedRoomCode) {
      return;
    }

    const payload: MotionUpdatePayload = {
      roomCode: normalizedRoomCode,
      detected,
      score: Number(score.toFixed(4)),
      detectedAt,
    };

    socketRef.current?.emit("motion:update", payload);
  }

  function emitMotionSetting(enabled: boolean) {
    const normalizedRoomCode = roomCodeRef.current.trim();

    if (!normalizedRoomCode) {
      return;
    }

    socketRef.current?.emit("motion:toggle", {
      roomCode: normalizedRoomCode,
      enabled,
    });
  }

  function resetMotionState() {
    motionDetectedRef.current = false;
    motionScoreRef.current = 0;
    lastMotionAtRef.current = null;
    lastMotionBroadcastAtRef.current = 0;

    setMotionDetected(false);
    setMotionScore(0);
    setLastMotionAt(null);
  }

  function stopMotionDetection(forceBroadcast = false) {
    if (motionIntervalRef.current !== null) {
      window.clearInterval(motionIntervalRef.current);
      motionIntervalRef.current = null;
    }

    motionCanvasRef.current = null;
    previousMotionFrameRef.current = null;

    if (forceBroadcast || motionDetectedRef.current || lastMotionAtRef.current) {
      emitMotionUpdate(false, 0, null);
    }

    resetMotionState();
  }

  function applyMotionEnabled(
    enabled: boolean,
    options: { broadcast: boolean },
  ) {
    motionEnabledRef.current = enabled;
    setMotionEnabled(enabled);

    if (!enabled) {
      stopMotionDetection(true);
    } else if (
      streamModeRef.current === "video" &&
      localStreamRef.current &&
      localVideoRef.current
    ) {
      startMotionDetection(localVideoRef.current);
    }

    if (options.broadcast) {
      emitMotionSetting(enabled);
    }
  }

  function startMotionDetection(video: HTMLVideoElement) {
    stopMotionDetection();

    const motionCanvas = document.createElement("canvas");
    motionCanvas.width = motionFrameWidth;
    motionCanvas.height = motionFrameHeight;

    const context = motionCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    if (!context) {
      setError("Motion detection is not available in this browser.");
      return;
    }

    motionCanvasRef.current = motionCanvas;

    motionIntervalRef.current = window.setInterval(() => {
      if (
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.videoWidth === 0 ||
        video.videoHeight === 0
      ) {
        return;
      }

      context.drawImage(video, 0, 0, motionFrameWidth, motionFrameHeight);

      const currentFrame = context.getImageData(
        0,
        0,
        motionFrameWidth,
        motionFrameHeight,
      );
      const analysis = analyzeMotionFrame(
        previousMotionFrameRef.current,
        currentFrame.data,
      );

      previousMotionFrameRef.current = new Uint8ClampedArray(currentFrame.data);

      if (!analysis) {
        return;
      }

      const now = Date.now();

      if (analysis.detected) {
        lastMotionAtRef.current = now;
        setLastMotionAt(now);
      }

      const effectiveMotionDetected =
        lastMotionAtRef.current !== null &&
        now - lastMotionAtRef.current < motionHoldMs;
      const roundedScore = Number(analysis.score.toFixed(4));
      const motionStateChanged =
        motionDetectedRef.current !== effectiveMotionDetected;

      motionScoreRef.current = roundedScore;
      setMotionScore(roundedScore);

      if (motionStateChanged) {
        motionDetectedRef.current = effectiveMotionDetected;
        setMotionDetected(effectiveMotionDetected);
      }

      if (
        motionStateChanged ||
        (analysis.detected &&
          now - lastMotionBroadcastAtRef.current >= motionBroadcastIntervalMs)
      ) {
        lastMotionBroadcastAtRef.current = now;
        emitMotionUpdate(
          effectiveMotionDetected,
          roundedScore,
          lastMotionAtRef.current,
        );
      }
    }, motionSampleIntervalMs);
  }

  function stopLocalStream() {
    stopMotionDetection();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setHasStream(false);

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
  }

  function streamMatchesMode(stream: MediaStream | null, mode: StreamMode) {
    if (!stream) {
      return false;
    }

    const hasVideoTrack = stream.getVideoTracks().length > 0;

    return mode === "video" ? hasVideoTrack : !hasVideoTrack;
  }

  function syncLocalStreamMode(mode: StreamMode) {
    const scheduledSync = mediaSyncRef.current.then(async () => {
      if (streamMatchesMode(localStreamRef.current, mode)) {
        return;
      }

      const nextStream = await navigator.mediaDevices.getUserMedia(
        mode === "audio-only"
          ? audioOnlyMediaConstraints
          : videoMediaConstraints,
      );

      stopLocalStream();

      localStreamRef.current = nextStream;
      streamModeRef.current = mode;
      setStreamMode(mode);
      setHasStream(true);

      if (localVideoRef.current) {
        if (mode === "video") {
          localVideoRef.current.srcObject = nextStream;
          void localVideoRef.current.play().catch(() => undefined);

          if (motionEnabledRef.current) {
            startMotionDetection(localVideoRef.current);
          }
        } else {
          localVideoRef.current.srcObject = null;
        }
      }
    });

    mediaSyncRef.current = scheduledSync.catch(() => undefined);

    return scheduledSync;
  }

  function createPublishingPeer() {
    destroyPeerConnection();

    const stream = localStreamRef.current;

    if (!stream) {
      throw new Error("Local media has not been started.");
    }

    const peer = createPeerConnection({
      iceServers: iceServersRef.current,
      onIceCandidate: (candidate) => {
        socketRef.current?.emit("signal:ice-candidate", {
          roomCode: roomCodeRef.current,
          candidate: candidate.toJSON(),
        });
      },
      onConnectionStateChange: (connectionState) => {
        if (connectionState === "connected") {
          setIsConnected(true);
          setStatus(
            streamModeRef.current === "audio-only"
              ? "Audio-only monitoring is online."
              : "Live stream is online.",
          );
          return;
        }

        if (
          connectionState === "failed" ||
          connectionState === "disconnected"
        ) {
          setIsConnected(false);
          setStatus(
            "Connection dropped. Waiting for the parent device to reconnect.",
          );
        }
      },
    });

    stream.getTracks().forEach((track) => {
      peer.addTrack(track, stream);
    });

    peerRef.current = peer;

    return peer;
  }

  async function handleStart() {
    if (isStarting) {
      return;
    }

    setIsStarting(true);
    setError(null);
    setStatus("Requesting camera and microphone access...");

    try {
      const socket = socketRef.current;

      if (!socket) {
        throw new Error("Signaling server is unavailable.");
      }

      stopLocalStream();
      destroyPeerConnection();
      streamModeRef.current = "video";
      setStreamMode("video");

      await syncLocalStreamMode("video");

      const response = await new Promise<RoomResponse>((resolve) => {
        socket.emit(
          "room:create",
          { role: "baby", motionEnabled: motionEnabledRef.current },
          resolve,
        );
      });

      if (!response.ok || !response.roomCode) {
        throw new Error(response.error ?? "Could not create a room.");
      }

      roomCodeRef.current = response.roomCode;
      setRoomCode(response.roomCode);
      applyMotionEnabled(response.motionEnabled ?? motionEnabledRef.current, {
        broadcast: false,
      });
      setStatus(
        "Room ready. Share the code or the QR link with the parent device.",
      );
    } catch (streamError) {
      setError(
        readableError(streamError, "Could not start the nursery stream."),
      );
      stopLocalStream();
      roomCodeRef.current = "";
      setRoomCode("");
      setStatus("Start failed. Check permissions and try again.");
    } finally {
      setIsStarting(false);
    }
  }

  async function handleReset() {
    socketRef.current?.emit("room:leave");
    destroyPeerConnection();
    stopLocalStream();
    roomCodeRef.current = "";
    setRoomCode("");
    streamModeRef.current = "video";
    setStreamMode("video");
    setIsConnected(false);
    setError(null);
    setStatus("Session cleared. Start again when the baby device is ready.");
  }

  async function handleCopyLink() {
    if (!pairingUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(pairingUrl);
      setStatus("Pairing link copied to the clipboard.");
    } catch {
      setError("Copy failed. Share the room code manually instead.");
    }
  }

  function handleMotionToggle() {
    if (streamMode === "audio-only") {
      return;
    }

    applyMotionEnabled(!motionEnabledRef.current, { broadcast: true });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
      <StreamCard
        title="Baby Device"
        description="Broadcast the crib-side stream and automatically pause the camera when the parent switches to audio-only mode."
        footer={
          <div className="flex flex-wrap items-center gap-3">
            <button className="warm-button" onClick={handleStart} type="button">
              {isStarting
                ? "Starting stream..."
                : roomCode
                  ? "Restart room"
                  : "Start baby stream"}
            </button>
            <button
              className="ghost-button"
              onClick={handleReset}
              type="button"
            >
              Clear session
            </button>
          </div>
        }
      >
        <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <StatusChip
                label={
                  isConnected
                    ? "Parent connected"
                    : hasStream
                      ? "Ready to pair"
                      : "Idle"
                }
                tone={isConnected ? "live" : hasStream ? "warning" : "neutral"}
              />
              {roomCode ? (
                <StatusChip label={`Room ${roomCode}`} tone="neutral" />
              ) : null}
            </div>
            <div className="mt-4 overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/70">
              <video
                ref={localVideoRef}
                className={
                  streamMode === "video"
                    ? "aspect-video h-full w-full object-cover"
                    : "hidden"
                }
                autoPlay
                muted
                playsInline
              />
              {streamMode === "audio-only" ? (
                <div className="flex aspect-video items-center justify-center px-6 text-center text-sm leading-6 text-white/55">
                  Audio-only mode is active. The camera preview and motion detection are paused to reduce battery drain.
                </div>
              ) : null}
            </div>
            <p className="mt-4 text-sm leading-6 text-white/72">{status}</p>
            {error ? (
              <p className="mt-3 text-sm leading-6 text-rose-200">{error}</p>
            ) : null}
          </div>

          <div className="space-y-4">
            <div className="rounded-[24px] border border-white/10 bg-white/6 p-5">
              <p className="eyebrow">Pairing</p>
              <p className="mt-3 text-sm leading-6 text-white/72">
                Share the room code or let the parent device scan the QR link.
              </p>
              <div className="mt-5 rounded-[22px] border border-dashed border-white/15 bg-slate-950/45 p-4 text-center">
                <div className="font-mono text-3xl font-semibold tracking-[0.35em] text-white">
                  {roomCode || "------"}
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/6 p-5">
              <p className="eyebrow">QR Link</p>
              <div className="mt-4 flex justify-center rounded-[22px] bg-white p-4">
                {pairingUrl ? (
                  <QRCode size={176} value={pairingUrl} />
                ) : (
                  <div className="flex h-44 w-44 items-center justify-center rounded-[18px] border border-slate-300 bg-slate-100 px-4 text-center text-sm text-slate-500">
                    Start the room to generate a QR code.
                  </div>
                )}
              </div>
              <button
                className="ghost-button mt-4 w-full"
                onClick={handleCopyLink}
                type="button"
              >
                Copy pairing link
              </button>
            </div>
          </div>
        </div>
      </StreamCard>

      <div className="space-y-6">
        <section className="glass-panel p-6">
          <div className="flex items-center justify-between gap-3">
            <p className="eyebrow">Stream mode</p>
            <StatusChip
              label={streamMode === "audio-only" ? "Audio only" : "Video + audio"}
              tone={streamMode === "audio-only" ? "warning" : "live"}
            />
          </div>
          <p className="mt-4 text-sm leading-6 text-white/72">
            The parent device controls this automatically. Audio-only mode turns off the camera and pauses motion detection until video is requested again.
          </p>
        </section>

        <section className="glass-panel p-6">
          <div className="flex items-center justify-between gap-3">
            <p className="eyebrow">Motion detection</p>
            <button
              className="rounded-full border border-white/16 bg-white/7 px-4 py-2 text-sm font-medium text-white transition hover:border-white/28 hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={handleMotionToggle}
              type="button"
              disabled={streamMode === "audio-only"}
            >
              {streamMode === "audio-only"
                ? "Unavailable"
                : motionEnabled
                  ? "Turn off"
                  : "Turn on"}
            </button>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <StatusChip
              label={
                streamMode === "audio-only"
                  ? "Detection paused"
                  : !motionEnabled
                    ? "Detection off"
                    : motionDetected
                      ? "Movement detected"
                      : hasStream
                        ? "Monitoring crib"
                        : "Standby"
              }
              tone={
                streamMode === "audio-only"
                  ? "neutral"
                  : !motionEnabled
                    ? "neutral"
                    : motionDetected
                      ? "warning"
                      : hasStream
                        ? "live"
                        : "neutral"
              }
            />
            <span className="text-xs text-white/55">
              {streamMode === "audio-only"
                ? "Camera paused for the room"
                : motionEnabled
                  ? "Shared with the parent device"
                  : "Detection paused for both devices"}
            </span>
          </div>
          <p className="mt-4 text-sm leading-6 text-white/72">
            {streamMode === "audio-only"
              ? "The parent requested audio-only mode, so camera sampling is paused to save battery."
              : "The baby device samples the live camera feed and flags visible movement in the crib area."}
          </p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[#7fe9d0] transition-[width] duration-300"
              style={{
                width: `${
                  streamMode === "audio-only"
                    ? 0
                    : motionEnabled
                      ? Math.min(100, motionScore * 2200)
                      : 0
                }%`,
              }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-white/55">
            <span className="font-mono uppercase tracking-[0.24em]">
              {streamMode === "audio-only"
                ? "Activity paused"
                : motionEnabled
                  ? `Activity ${(motionScore * 100).toFixed(2)}%`
                  : "Activity paused"}
            </span>
            <span>
              {streamMode === "audio-only"
                ? "Motion monitor paused"
                : !motionEnabled
                  ? "Motion detection is disabled"
                  : lastMotionAt
                    ? `Last movement ${formatMotionTime(lastMotionAt)}`
                    : "No movement captured yet"}
            </span>
          </div>
        </section>

        <section className="glass-panel p-6">
          <p className="eyebrow">Placement tips</p>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-white/72">
            <li>
              Keep the device plugged into power and disable auto-lock where
              possible.
            </li>
            <li>
              Use the rear camera for better low-light quality and a wider view
              of the crib.
            </li>
            <li>
              For audio monitoring, keep the microphone unobstructed and reduce
              background noise.
            </li>
          </ul>
        </section>

        <section className="glass-panel p-6">
          <p className="eyebrow">Connection notes</p>
          <p className="mt-4 text-sm leading-6 text-white/72">
            WebRTC works best on the same network with STUN only. Add TURN
            credentials on the backend when you need reliable connections across
            different networks or strict NATs.
          </p>
        </section>
      </div>
    </div>
  );
}

function readableError(cause: unknown, fallback: string) {
  if (cause instanceof Error) {
    return cause.message;
  }

  return fallback;
}

function formatMotionTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}