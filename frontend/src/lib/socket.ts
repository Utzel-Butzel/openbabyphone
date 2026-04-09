import { io, type Socket } from "socket.io-client";

export function createSignalingSocket(): Socket {
  return io({
    autoConnect: true,
    transports: ["websocket", "polling"],
    reconnectionAttempts: 5,
  });
}
