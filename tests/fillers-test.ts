import {
  findDeletedFillerWordIds,
  findFillerWordIds,
  isFillerWord,
} from "../lib/fillers";
import type { Word } from "../lib/types";

function w(text: string, id: number, deleted = false): Word {
  return { id, text, start: id, end: id + 0.2, speaker: 0, deleted };
}

{
  const words = [
    w("I", 1),
    w("was", 2),
    w("like,", 3),
    w("you", 4),
    w("know", 5),
    w("ready", 6),
  ];
  const ids = findFillerWordIds(words, ["like", "you know"]);
  if (ids.join(",") !== "3,4,5") {
    throw new Error(`unexpected custom filler ids: ${ids.join(",")}`);
  }
}

{
  const words = [w("you", 1, true), w("know", 2, true), w("why", 3)];
  const ids = findDeletedFillerWordIds(words, ["you know"]);
  if (ids.join(",") !== "1,2") {
    throw new Error(`unexpected deleted custom filler ids: ${ids.join(",")}`);
  }
}

{
  const germanFillers = ["äh", "Ähm,", "öhm", "mhh"];
  for (const word of germanFillers) {
    if (!isFillerWord(word)) throw new Error(`expected ${word} to be a filler`);
  }
}

{
  const frenchFillers = ["euh", "Euhm,", "heu", "euuuh"];
  for (const word of frenchFillers) {
    if (!isFillerWord(word)) throw new Error(`expected ${word} to be a filler`);
  }
}

{
  const spanishFillers = ["em", "Emm,", "eee"];
  for (const word of spanishFillers) {
    if (!isFillerWord(word)) throw new Error(`expected ${word} to be a filler`);
  }
}

{
  const portugueseFillers = ["hã", "Ahn,", "ãhm", "éhh"];
  for (const word of portugueseFillers) {
    if (!isFillerWord(word)) throw new Error(`expected ${word} to be a filler`);
  }
}

{
  const chineseFillers = ["嗯", "呃", "额", "唔", "嗯嗯"];
  for (const word of chineseFillers) {
    if (!isFillerWord(word)) throw new Error(`expected ${word} to be a filler`);
  }
}

{
  const meaningfulWords = ["also", "genau", "ja", "bonjour", "hola", "olá", "这个"];
  for (const word of meaningfulWords) {
    if (isFillerWord(word)) throw new Error(`did not expect ${word} to be a filler`);
  }
}

{
  const words = [w("Hello", 1), w("ähm", 2), w("uh", 3, true), w("öhm.", 4), w("euh", 5), w("嗯", 6)];
  const ids = findFillerWordIds(words);
  if (ids.join(",") !== "2,4,5,6") throw new Error(`unexpected filler ids: ${ids.join(",")}`);
}

{
  if (!isFillerWord("...")) throw new Error('expected "..." to be a filler');
  const words = [w("Hello", 1), w("...", 2), w("um", 3), w("...", 4, true)];
  const ids = findFillerWordIds(words);
  if (ids.join(",") !== "2,3") {
    throw new Error(`unexpected filler ids with placeholders: ${ids.join(",")}`);
  }
}

console.log("ALL FILLER TESTS PASSED");
