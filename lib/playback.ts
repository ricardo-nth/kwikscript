/** The small media surface needed to jump playback from transcript text. */
export interface SeekablePlayableMedia {
  currentTime: number;
  paused: boolean;
  play: () => Promise<unknown>;
}

/** Seek immediately and start playback when the media is currently paused. */
export function seekAndPlayMedia(
  media: SeekablePlayableMedia,
  time: number,
): Promise<unknown> | null {
  media.currentTime = time;
  return media.paused ? media.play() : null;
}
