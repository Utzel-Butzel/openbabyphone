export interface RuntimeConfig {
  iceServers: RTCIceServer[];
}

export const fallbackIceServers: RTCIceServer[] = [
  {
    urls: "stun:stun.l.google.com:19302",
  },
];

export async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const response = await fetch("/api/config");

    if (!response.ok) {
      throw new Error("Config request failed.");
    }

    const data = (await response.json()) as Partial<RuntimeConfig>;

    if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      return { iceServers: data.iceServers };
    }
  } catch {
    return { iceServers: fallbackIceServers };
  }

  return { iceServers: fallbackIceServers };
}
