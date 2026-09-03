import { seekAndPlayMedia } from "../lib/playback";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

{
  let plays = 0;
  const media = {
    currentTime: 0,
    paused: true,
    play: async () => {
      plays++;
    },
  };
  void seekAndPlayMedia(media, 4.25);
  assert(media.currentTime === 4.25, "word click seeks to its timestamp");
  assert(plays === 1, "word click starts paused media");
}

{
  let plays = 0;
  const media = {
    currentTime: 1,
    paused: false,
    play: async () => {
      plays++;
    },
  };
  seekAndPlayMedia(media, 7.5);
  assert(media.currentTime === 7.5, "word click seeks while already playing");
  assert(plays === 0, "already-playing media is not restarted");
}

console.log("ALL PLAYBACK TESTS PASSED");
