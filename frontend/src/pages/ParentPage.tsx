import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Socket } from "socket.io-client";

import { StatusChip } from "../components/StatusChip";
import { StreamCard } from "../components/StreamCard";
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

interface AnswerPayload {
  sdp: string;
}

interface MotionUpdatePayload {
  detected: boolean;
  score: number;
  detectedAt: number | null;
}

interface MotionSettingsPayload {
  roomCode: string;
  enabled: boolean;
}

const streamModeLabels: Record<StreamMode, string> = {
  video: "Video + audio",
  "audio-only": "Audio only",
};

export function ParentPage() {
  const [searchParams] = useSearchParams();
  const initialRoom = searchParams.get("room")?.toUpperCase() ?? "";

  const videoFrameRef = useRef<HTMLDivElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const roomCodeRef = useRef(initialRoom);
  const iceServersRef = useRef<RTCIceServer[]>(fallbackIceServers);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const streamModeRef = useRef<StreamMode>("video");

  const [roomCode, setRoomCode] = useState(initialRoom);
  const [status, setStatus] = useState(
    "Enter the room code from the baby device to begin.",
  );
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isInRoom, setIsInRoom] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [motionDetected, setMotionDetected] = useState(false);
  const [motionScore, setMotionScore] = useState(0);
  const [lastMotionAt, setLastMotionAt] = useState<number | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [streamMode, setStreamMode] = useState<StreamMode>("video");

  const hasRemoteVideo = Boolean(
    remoteStream && remoteStream.getVideoTracks().length > 0,
  );

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

    socket.on("signal:answer", async ({ sdp }: AnswerPayload) => {
      const peer = peerRef.current;

      if (!peer) {
        return;
      }

      try {
        await peer.setRemoteDescription({ type: "answer", sdp });
        await flushPendingCandidates(peer);
        setStatus(
          streamModeRef.current === "audio-only"
            ? "The baby device is sending live audio only."
            : "The baby device is sending live video and audio.",
        );
      } catch {
        setError("Could not establish the media session.");
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

    socket.on(
      "motion:update",
      ({ detected, score, detectedAt }: MotionUpdatePayload) => {
        setMotionDetected(detected);
        setMotionScore(score);
        setLastMotionAt(detectedAt);
      },
    );

    socket.on("motion:settings", ({ enabled }: MotionSettingsPayload) => {
      setMotionEnabled(enabled);

      if (!enabled) {
        resetMotionState();
      }
    });

    socket.on("room:peer-left", () => {
      destroyPeerConnection();
      setRemoteStream(null);
      setIsConnected(false);
      setIsInRoom(false);
      resetMotionState();
      setStatus("Baby device disconnected. Rejoin when it comes back online.");
    });

    return () => {
      socket.emit("room:leave");
      socket.disconnect();
      destroyPeerConnection();
    };
  }, []);

  useEffect(() => {
    if (!remoteVideoRef.current) {
      return;
    }

    remoteVideoRef.current.srcObject = remoteStream;
    remoteVideoRef.current.muted = true;

    if (hasRemoteVideo) {
      void remoteVideoRef.current.play().catch(() => undefined);
    }
  }, [hasRemoteVideo, remoteStream]);

  useEffect(() => {
    if (!remoteAudioRef.current) {
      return;
    }

    remoteAudioRef.current.srcObject = remoteStream;

    if (remoteStream) {
      void remoteAudioRef.current.play().catch(() => undefined);
    }
  }, [remoteStream]);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === videoFrameRef.current);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

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

  function resetMotionState() {
    setMotionDetected(false);
    setMotionScore(0);
    setLastMotionAt(null);
  }

  function createReceivingPeer(mode: StreamMode) {
    destroyPeerConnection();

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
              ? "Audio-only stream connected."
              : "Live stream connected.",
          );
          return;
        }

        if (
          connectionState === "failed" ||
          connectionState === "disconnected"
        ) {
          setIsConnected(false);
          setStatus("Connection dropped. Try joining again.");
        }
      },
      onTrack: (event) => {
        const [firstStream] = event.streams;

        if (firstStream) {
          setRemoteStream(firstStream);
        }
      },
    });

    peer.addTransceiver("audio", { direction: "recvonly" });

    if (mode === "video") {
      peer.addTransceiver("video", { direction: "recvonly" });
    }

    peerRef.current = peer;

    return peer;
  }

  async function negotiateStream(targetRoomCode: string, mode: StreamMode) {
    const socket = socketRef.current;

    if (!socket) {
      throw new Error("Signaling server is unavailable.");
    }

    setError(null);
    setIsConnected(false);
    setRemoteStream(null);
    setStatus(
      mode === "audio-only"
        ? "Switching to audio-only mode and pausing the crib camera..."
        : "Requesting the live camera and microphone feed...",
    );

    socket.emit("stream:mode", {
      roomCode: targetRoomCode,
      mode,
    });

    const peer = createReceivingPeer(mode);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    socket.emit("signal:offer", {
      roomCode: targetRoomCode,
      sdp: offer.sdp,
    });

    setStatus(
      mode === "audio-only"
        ? "Waiting for the baby device to switch into audio-only mode..."
        : "Waiting for the baby device to answer...",
    );
  }

  async function handleJoin() {
    const normalizedRoomCode = roomCode.trim().toUpperCase();

    if (!normalizedRoomCode) {
      setError("Enter a valid room code.");
      return;
    }

    if (isJoining) {
      return;
    }

    setIsJoining(true);
    setError(null);
    resetMotionState();
    setStatus("Joining room and requesting the live feed...");

    try {
      const socket = socketRef.current;

      if (!socket) {
        throw new Error("Signaling server is unavailable.");
      }

      setRoomCode(normalizedRoomCode);

      const response = await new Promise<RoomResponse>((resolve) => {
        socket.emit(
          "room:join",
          { roomCode: normalizedRoomCode, role: "parent" },
          resolve,
        );
      });

      if (!response.ok) {
        throw new Error(response.error ?? "Could not join the room.");
      }

      setIsInRoom(true);
      setMotionEnabled(response.motionEnabled ?? true);
      await negotiateStream(normalizedRoomCode, streamModeRef.current);
    } catch (joinError) {
      setError(
        readableError(joinError, "Could not connect to the baby device."),
      );
      setIsInRoom(false);
      setStatus("Join failed. Double-check the room code and try again.");
      destroyPeerConnection();
    } finally {
      setIsJoining(false);
    }
  }

  function handleLeave() {
    socketRef.current?.emit("room:leave");
    destroyPeerConnection();
    setRemoteStream(null);
    setIsConnected(false);
    setIsInRoom(false);
    resetMotionState();
    setError(null);
    setStatus("You have left the room.");
  }

  async function handleStreamModeChange(mode: StreamMode) {
    const previousMode = streamModeRef.current;

    if (mode === previousMode) {
      return;
    }

    streamModeRef.current = mode;
    setStreamMode(mode);
    setError(null);

    const activeRoomCode = roomCodeRef.current.trim().toUpperCase();

    if (!activeRoomCode || !isInRoom) {
      return;
    }

    try {
      await negotiateStream(activeRoomCode, mode);
    } catch (modeError) {
      streamModeRef.current = previousMode;
      setStreamMode(previousMode);
      setError(
        readableError(modeError, "Could not switch the stream mode."),
      );
      setStatus("Mode switch failed. Try again.");
      destroyPeerConnection();
      setRemoteStream(null);
      setIsConnected(false);
    }
  }

  function handleMotionToggle() {
    if (!isInRoom || streamMode === "audio-only") {
      return;
    }

    socketRef.current?.emit("motion:toggle", {
      roomCode: roomCodeRef.current,
      enabled: !motionEnabled,
    });
  }

  async function handleFullscreenToggle() {
    const videoFrame = videoFrameRef.current;

    if (!videoFrame) {
      return;
    }

    try {
      if (document.fullscreenElement === videoFrame) {
        await document.exitFullscreen();
        return;
      }

      await videoFrame.requestFullscreen();
    } catch {
      setError("Fullscreen mode is not available in this browser.");
    }
  }

  return (
    <div>
      <StreamCard
        title="Parent Device"
        description="Receive the live nursery feed and switch to audio-only mode when you want lower bandwidth and battery use."
        footer={
          <div className="flex flex-wrap gap-3">
            <button className="warm-button" onClick={handleJoin} type="button">
              {isJoining ? "Joining room..." : "Join room"}
            </button>
            <button
              className="ghost-button"
              onClick={handleLeave}
              type="button"
            >
              Leave room
            </button>
          </div>
        }
      >
        <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <audio ref={remoteAudioRef} autoPlay playsInline />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <StatusChip
                  label={
                    isConnected
                      ? "Connected"
                      : remoteStream
                        ? "Receiving stream"
                        : "Waiting to join"
                  }
                  tone={
                    isConnected ? "live" : remoteStream ? "warning" : "neutral"
                  }
                />
                {roomCode ? (
                  <StatusChip label={`Room ${roomCode}`} tone="neutral" />
                ) : null}
              </div>
              <button
                className="rounded-full border border-white/16 bg-white/7 px-4 py-2 text-sm font-medium text-white transition hover:border-white/28 hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-45"
                onClick={handleFullscreenToggle}
                type="button"
                disabled={!hasRemoteVideo || streamMode === "audio-only"}
              >
                {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              </button>
            </div>
            <div
              ref={videoFrameRef}
              className="mt-4 overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/70"
            >
              <video
                ref={remoteVideoRef}
                className={
                  hasRemoteVideo && streamMode === "video"
                    ? "aspect-video h-full w-full object-cover"
                    : "hidden"
                }
                autoPlay
                playsInline
                controls={false}
                muted
              />
              {hasRemoteVideo && streamMode === "video" ? null : (
                <div className="flex aspect-video items-center justify-center px-6 text-center text-sm leading-6 text-white/55">
                  {streamMode === "audio-only"
                    ? "Audio-only mode is active. The crib camera is paused on the baby device to save bandwidth and battery while the microphone stays live."
                    : "The live stream will appear here once the baby device answers the WebRTC offer."}
                </div>
              )}
            </div>
            <p className="mt-4 text-sm leading-6 text-white/72">{status}</p>
            {error ? (
              <p className="mt-3 text-sm leading-6 text-rose-200">{error}</p>
            ) : null}
          </div>

          <div className="space-y-4">
            <div className="rounded-[24px] border border-white/10 bg-white/6 p-5">
              <label className="eyebrow" htmlFor="room-code">
                Room code
              </label>
              <input
                id="room-code"
                value={roomCode}
                onChange={(event) =>
                  setRoomCode(event.target.value.toUpperCase())
                }
                className="mt-4 w-full rounded-[20px] border border-white/12 bg-slate-950/65 px-4 py-4 font-mono text-lg tracking-[0.28em] text-white outline-none placeholder:text-white/25 focus:border-[#7fe9d0]"
                maxLength={6}
                placeholder="ABC123"
                inputMode="text"
                autoCapitalize="characters"
              />
              <p className="mt-3 text-sm leading-6 text-white/68">
                Use the six-character pairing code shown on the baby device, or
                open the QR link there to prefill it.
              </p>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/6 p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="eyebrow">Listening mode</p>
                <StatusChip label={streamModeLabels[streamMode]} tone="neutral" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  className={
                    streamMode === "video"
                      ? "rounded-[20px] border border-[#ffc76d] bg-[#ffc76d] px-4 py-3 text-sm font-semibold text-slate-950 transition"
                      : "rounded-[20px] border border-white/12 bg-slate-950/55 px-4 py-3 text-sm font-semibold text-white/78 transition hover:border-white/28 hover:bg-slate-950/75"
                  }
                  onClick={() => void handleStreamModeChange("video")}
                  type="button"
                  disabled={isJoining}
                >
                  Video + audio
                </button>
                <button
                  className={
                    streamMode === "audio-only"
                      ? "rounded-[20px] border border-[#7fe9d0] bg-[#7fe9d0] px-4 py-3 text-sm font-semibold text-slate-950 transition"
                      : "rounded-[20px] border border-white/12 bg-slate-950/55 px-4 py-3 text-sm font-semibold text-white/78 transition hover:border-white/28 hover:bg-slate-950/75"
                  }
                  onClick={() => void handleStreamModeChange("audio-only")}
                  type="button"
                  disabled={isJoining}
                >
                  Audio only
                </button>
              </div>
              <p className="mt-3 text-sm leading-6 text-white/68">
                Audio-only mode pauses the baby device camera and motion analysis until video is requested again.
              </p>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/6 p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="eyebrow">Motion monitor</p>
                <button
                  className="rounded-full border border-white/16 bg-white/7 px-4 py-2 text-sm font-medium text-white transition hover:border-white/28 hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={handleMotionToggle}
                  type="button"
                  disabled={!isInRoom || streamMode === "audio-only"}
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
                          ? "Movement live"
                          : "Stillness"
                  }
                  tone={
                    streamMode === "audio-only"
                      ? "neutral"
                      : !motionEnabled
                        ? "neutral"
                        : motionDetected
                          ? "warning"
                          : "neutral"
                  }
                />
                <span className="text-xs text-white/55">
                  {streamMode === "audio-only"
                    ? "Camera paused for the room"
                    : motionEnabled
                      ? "Toggle from either device"
                      : "Paused across the room"}
                </span>
              </div>
              <p className="mt-4 text-sm leading-6 text-white/72">
                {streamMode === "audio-only"
                  ? "Motion events are paused because the baby device camera is off in audio-only mode."
                  : "Motion events are analyzed on the baby device camera feed and pushed here in real time."}
              </p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[#ffc76d] transition-[width] duration-300"
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
                        : "No movement reported yet"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </StreamCard>
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