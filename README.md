# OpenBabyPhone

OpenBabyPhone is a browser-based baby monitor built with a Vite + React frontend and a Node.js signaling backend, both written in TypeScript. The baby device publishes live camera video and microphone audio, runs lightweight crib motion detection on the camera feed, and the parent device receives both the stream and live movement alerts over WebRTC and Socket.IO. The parent can also switch the session into audio-only mode to reduce bandwidth use and pause the baby device camera for lower battery drain.

## Stack

- Frontend: React, Vite, TypeScript, Tailwind CSS, React Router, Socket.IO client
- Backend: Node.js, Express, TypeScript, Socket.IO
- Streaming: WebRTC with configurable STUN and TURN servers
- Deployment: Single Dockerized Node service that also serves the built frontend

## Project layout

```text
.
├── backend
│   ├── src
│   │   └── server.ts
│   ├── package.json
│   └── tsconfig.json
├── frontend
│   ├── src
│   │   ├── components
│   │   ├── lib
│   │   ├── pages
│   │   ├── App.tsx
│   │   ├── index.css
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── Dockerfile
├── package.json
└── README.md
```

## Local development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start both services in development mode:

   ```bash
   npm run dev
   ```

3. Open the app:
   - Frontend: http://localhost:5173
   - Backend health check: http://localhost:3001/health

The Vite dev server proxies `/api` and `/socket.io` traffic to the backend, so the frontend can use same-origin URLs in both development and production.

## Environment variables

Copy `.env.example` and adjust values as needed.

```bash
PORT=3001
CORS_ORIGIN=http://localhost:5173
ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]
```

### ICE server configuration

`ICE_SERVERS` expects JSON that can be passed directly to the WebRTC `RTCPeerConnection` constructor.

Example with TURN support:

```bash
ICE_SERVERS=[
  {"urls":"stun:stun.l.google.com:19302"},
  {
    "urls":["turn:turn.example.com:3478?transport=udp","turn:turn.example.com:3478?transport=tcp"],
    "username":"turn-user",
    "credential":"turn-password"
  }
]
```

## Production build

```bash
npm run build
npm run start
```

The backend serves `frontend/dist` in production, so you only need one deployed service.

## Coolify deployment

This repository is set up for a Dockerfile-based deployment in Coolify.

1. Create a new application from the repository.
2. Select Dockerfile build mode.
3. Expose port `3001`.
4. Set the health check path to `/health`.
5. Configure these environment variables in Coolify:
   - `PORT=3001`
   - `ICE_SERVERS=...` with your STUN/TURN JSON when needed
   - `CORS_ORIGIN=https://your-domain.example` if you want to restrict non-same-origin access
6. Enable HTTPS in Coolify. Browser camera and microphone access requires a secure origin outside localhost.

### Coolify notes

- If frontend and backend run under the same domain, the default same-origin Socket.IO setup works without extra client configuration.
- For monitoring across different networks, add a TURN service. STUN alone is often not enough through mobile carriers or strict NATs.
- Keep the baby device awake and connected to power during longer sessions.

## Pairing flow

1. Open the Baby Device view.
2. Allow camera and microphone access.
3. Share the generated room code or QR link.
4. Open the Parent Device view on another browser.
5. Enter the room code or use the QR-generated link.
6. Choose between Video + audio or Audio only on the parent device.
7. The parent browser creates a WebRTC offer, the baby browser answers, and the signaling server relays ICE candidates until the direct media path is established.

## Verification

The current implementation has been validated with:

- `npm install`
- `npm run build`
- `GET /health`
- `GET /api/config`
- Rendering the built landing page through the backend server
