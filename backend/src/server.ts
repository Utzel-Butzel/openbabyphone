import "dotenv/config";

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";
import { Server } from "socket.io";

type ParticipantRole = "baby" | "parent";
type StreamMode = "video" | "audio-only";

interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

interface Room {
  code: string;
  babySocketId?: string;
  parentSocketId?: string;
  motionEnabled: boolean;
  createdAt: number;
}

interface CreatePayload {
  role: ParticipantRole;
  motionEnabled?: boolean;
}

interface Participant {
  roomCode: string;
  role: ParticipantRole;
}

interface JoinPayload {
  roomCode: string;
  role: ParticipantRole;
}

interface SignalPayload {
  roomCode: string;
  sdp: string;
}

interface MotionPayload {
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
  roomCode: string;
  mode: StreamMode;
}

interface CandidatePayload {
  roomCode: string;
  candidate: RTCIceCandidateInit | IceCandidatePayload;
}

interface IceCandidatePayload {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

interface RoomResponse {
  ok: boolean;
  roomCode?: string;
  motionEnabled?: boolean;
  error?: string;
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "../../");
const frontendDist = path.join(projectRoot, "frontend", "dist");
const frontendIndex = path.join(frontendDist, "index.html");

const port = Number(process.env.PORT ?? 3001);
const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGIN);
const iceServers = parseIceServers(process.env.ICE_SERVERS);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  },
});

const rooms = new Map<string, Room>();
const participants = new Map<string, Participant>();

app.use(express.json());
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  }),
);

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/api/config", (_request, response) => {
  response.json({ iceServers });
});

if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));

  app.use((request, response, next) => {
    if (request.method !== "GET") {
      next();
      return;
    }

    if (
      request.path.startsWith("/api") ||
      request.path === "/health" ||
      request.path.startsWith("/socket.io")
    ) {
      next();
      return;
    }

    response.sendFile(frontendIndex);
  });
}

io.on("connection", (socket) => {
  socket.on(
    "room:create",
    (
      payload: CreatePayload,
      acknowledge: (response: RoomResponse) => void,
    ) => {
      leaveRoom(socket.id, { notifyPeer: true, disconnecting: false });

      const roomCode = createRoomCode();

      rooms.set(roomCode, {
        code: roomCode,
        babySocketId: socket.id,
        motionEnabled: payload.motionEnabled ?? true,
        createdAt: Date.now(),
      });

      participants.set(socket.id, { roomCode, role: "baby" });
      socket.join(roomCode);

      acknowledge({
        ok: true,
        roomCode,
        motionEnabled: payload.motionEnabled ?? true,
      });
    },
  );

  socket.on(
    "room:join",
    (payload: JoinPayload, acknowledge: (response: RoomResponse) => void) => {
      const roomCode = payload.roomCode.trim().toUpperCase();
      const room = rooms.get(roomCode);

      if (payload.role !== "parent") {
        acknowledge({
          ok: false,
          error: "Only the parent device can join an existing room.",
        });
        return;
      }

      if (!room || !room.babySocketId) {
        acknowledge({
          ok: false,
          error: "Room not found or baby device is offline.",
        });
        return;
      }

      if (room.parentSocketId && room.parentSocketId !== socket.id) {
        acknowledge({
          ok: false,
          error: "This room already has a parent device connected.",
        });
        return;
      }

      leaveRoom(socket.id, { notifyPeer: true, disconnecting: false });

      room.parentSocketId = socket.id;
      participants.set(socket.id, { roomCode, role: "parent" });
      socket.join(roomCode);

      io.to(room.babySocketId).emit("room:peer-ready");
      acknowledge({ ok: true, roomCode, motionEnabled: room.motionEnabled });
    },
  );

  socket.on("signal:offer", (payload: SignalPayload) => {
    relaySignal(socket.id, payload.roomCode, "signal:offer", {
      sdp: payload.sdp,
    });
  });

  socket.on("signal:answer", (payload: SignalPayload) => {
    relaySignal(socket.id, payload.roomCode, "signal:answer", {
      sdp: payload.sdp,
    });
  });

  socket.on("signal:ice-candidate", (payload: CandidatePayload) => {
    relaySignal(socket.id, payload.roomCode, "signal:ice-candidate", {
      candidate: payload.candidate,
    });
  });

  socket.on("motion:update", (payload: MotionPayload) => {
    relaySignal(socket.id, payload.roomCode, "motion:update", {
      detected: payload.detected,
      score: payload.score,
      detectedAt: payload.detectedAt,
    });
  });

  socket.on("motion:toggle", (payload: MotionSettingsPayload) => {
    const participant = participants.get(socket.id);

    if (!participant) {
      return;
    }

    const roomCode = payload.roomCode.trim().toUpperCase();

    if (participant.roomCode !== roomCode) {
      return;
    }

    const room = rooms.get(roomCode);

    if (!room) {
      return;
    }

    room.motionEnabled = payload.enabled;

    io.to(roomCode).emit("motion:settings", {
      roomCode,
      enabled: room.motionEnabled,
    });
  });

  socket.on("stream:mode", (payload: StreamModePayload) => {
    relaySignal(socket.id, payload.roomCode, "stream:mode", {
      mode: payload.mode,
    });
  });

  socket.on("room:leave", () => {
    leaveRoom(socket.id, { notifyPeer: true, disconnecting: false });
  });

  socket.on("disconnect", () => {
    leaveRoom(socket.id, { notifyPeer: true, disconnecting: true });
  });
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`OpenBabyPhone signaling server listening on :${port}`);
});

function relaySignal(
  socketId: string,
  requestedRoomCode: string,
  eventName: string,
  payload: Record<string, unknown>,
) {
  const participant = participants.get(socketId);

  if (!participant) {
    return;
  }

  const roomCode = requestedRoomCode.trim().toUpperCase();

  if (participant.roomCode !== roomCode) {
    return;
  }

  const room = rooms.get(roomCode);

  if (!room) {
    return;
  }

  const targetSocketId =
    participant.role === "baby" ? room.parentSocketId : room.babySocketId;

  if (targetSocketId) {
    io.to(targetSocketId).emit(eventName, payload);
  }
}

function leaveRoom(
  socketId: string,
  options: { notifyPeer: boolean; disconnecting: boolean },
) {
  const participant = participants.get(socketId);

  if (!participant) {
    return;
  }

  participants.delete(socketId);

  const room = rooms.get(participant.roomCode);

  if (!room) {
    return;
  }

  const socket = io.sockets.sockets.get(socketId);

  if (socket && !options.disconnecting) {
    void socket.leave(participant.roomCode);
  }

  if (participant.role === "baby") {
    room.babySocketId = undefined;

    if (options.notifyPeer && room.parentSocketId) {
      io.to(room.parentSocketId).emit("room:peer-left");
    }

    if (room.parentSocketId) {
      participants.delete(room.parentSocketId);
      const parentSocket = io.sockets.sockets.get(room.parentSocketId);

      if (parentSocket && !options.disconnecting) {
        void parentSocket.leave(room.code);
      }
    }

    rooms.delete(room.code);
    return;
  }

  room.parentSocketId = undefined;

  if (options.notifyPeer && room.babySocketId) {
    io.to(room.babySocketId).emit("room:peer-left");
  }

  if (!room.babySocketId) {
    rooms.delete(room.code);
  }
}

function createRoomCode() {
  let roomCode = "";

  do {
    roomCode = randomBytes(4).toString("base64url").slice(0, 6).toUpperCase();
  } while (rooms.has(roomCode));

  return roomCode;
}

function parseAllowedOrigins(value: string | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseIceServers(value: string | undefined): IceServerConfig[] {
  if (!value) {
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (Array.isArray(parsed) && parsed.every(isIceServer)) {
      return parsed;
    }
  } catch {
    console.warn(
      "ICE_SERVERS is not valid JSON. Falling back to the default public STUN server.",
    );
  }

  return [{ urls: "stun:stun.l.google.com:19302" }];
}

function isIceServer(value: unknown): value is IceServerConfig {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<IceServerConfig>;

  return typeof candidate.urls === "string" || Array.isArray(candidate.urls);
}
