// SFace's documented reference default (cosine similarity) for the sface_2021dec model.
// Used whenever a channel's similarityThreshold hasn't been calibrated (null).
export const DEFAULT_SIMILARITY_THRESHOLD = 0.36;

export function resolveSimilarityThreshold(
  channelThreshold: number | null,
): number {
  return channelThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
}
