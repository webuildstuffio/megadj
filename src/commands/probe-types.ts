/** Shared audio-file probe shape (ffprobe result). */
export interface Probe {
  ok: boolean;
  durationS: number | null;
  bitrateKbps: number | null;
  sampleRate: number | null;
  codec: string | null;
  hasArt: boolean;
  tags: Record<string, string>;
}
