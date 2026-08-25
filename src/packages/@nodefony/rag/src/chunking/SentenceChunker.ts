// @nodefony/rag — src/chunking/SentenceChunker.ts
// Chunking par phrases (regroupées jusqu'à atteindre chunkSize)

import type { IChunker, IIndexOptions } from "../interfaces/IRagService.js";

export class SentenceChunker implements IChunker {
  chunk(text: string, options: IIndexOptions = {}): string[] {
    const chunkSize = options.chunkSize ?? 512;

    // Split par phrase — gère ., ?, !
    const sentences = text
      .split(/(?<=[.?!])\s+(?=[A-ZÉÈÊÀÙÔÎÏÇa-z])/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const chunks: string[] = [];
    let current: string[] = [];
    let currentSize = 0;

    for (const sentence of sentences) {
      const sentenceSize = sentence.split(/\s+/).length;
      if (currentSize + sentenceSize > chunkSize && current.length > 0) {
        chunks.push(current.join(" "));
        current = [sentence];
        currentSize = sentenceSize;
      } else {
        current.push(sentence);
        currentSize += sentenceSize;
      }
    }

    if (current.length > 0) chunks.push(current.join(" "));
    return chunks;
  }
}
