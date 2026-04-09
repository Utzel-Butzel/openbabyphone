export type StreamMode = "video" | "audio-only";

interface PeerConnectionOptions {
  iceServers: RTCIceServer[];
  onIceCandidate: (candidate: RTCIceCandidate) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  onTrack?: (event: RTCTrackEvent) => void;
}

export function createPeerConnection({
  iceServers,
  onIceCandidate,
  onConnectionStateChange,
  onTrack,
}: PeerConnectionOptions): RTCPeerConnection {
  const peer = new RTCPeerConnection({
    iceServers,
    iceCandidatePoolSize: 10,
  });

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      onIceCandidate(event.candidate);
    }
  };

  peer.onconnectionstatechange = () => {
    onConnectionStateChange(peer.connectionState);
  };

  if (onTrack) {
    peer.ontrack = onTrack;
  }

  return peer;
}
