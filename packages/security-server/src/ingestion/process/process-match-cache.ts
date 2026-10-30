import { Injectable } from '@nestjs/common';
import { FaceRecognitionService } from '../../recognition/face-recognition.service';
import { CachedEmbedding } from './ingestion-protocol';

export interface MatchResult {
  profileId: string;
  profileName: string;
  score: number;
}

// This process's copy of the watch list. The main process loads it (FaceMatchCacheService) and
// sends it to every ingestion process whenever it changes. Brute-force cosine comparison against
// ~150 embeddings is on the order of microseconds, negligible next to detection and embedding.
@Injectable()
export class ProcessMatchCache {
  private entries: CachedEmbedding[] = [];

  constructor(private readonly faceRecognition: FaceRecognitionService) {}

  set(entries: CachedEmbedding[]) {
    this.entries = entries;
  }

  findBestMatch(embedding: number[], threshold: number): MatchResult | null {
    let best: MatchResult | null = null;
    for (const entry of this.entries) {
      const score = this.faceRecognition.cosineSimilarity(
        embedding,
        entry.embedding,
      );
      if (score >= threshold && (!best || score > best.score)) {
        best = {
          profileId: entry.profileId,
          profileName: entry.profileName,
          score,
        };
      }
    }
    return best;
  }
}
