import { Injectable, Logger } from '@nestjs/common';
import { Prisma, VideoFeedSource } from '@prisma/client';
import * as cv from '@u4/opencv4nodejs';
import { AlertService } from '../alerts/alert.service';
import { encodeJpeg } from '../common/jpeg.util';
import { FaceDetectionService } from '../recognition/face-detection.service';
import {
  faceSizePx,
  resolveMinFaceQuality,
  resolveMinFaceSize,
  unscaleFace,
} from '../recognition/face-gate';
import {
  FaceQuality,
  FaceQualityService,
} from '../recognition/face-quality.service';
import { FaceRecognitionService } from '../recognition/face-recognition.service';
import { DetectedFace } from '../recognition/recognition.types';
import { resolveSimilarityThreshold } from '../recognition/similarity-threshold';
import { UsageStatsService } from './usage-stats.service';
import { FaceMatchCacheService } from './face-match-cache.service';

// Without this, one person standing in front of a camera for a few seconds would insert
// dozens of near-duplicate Alert rows (one per processed frame) for the same detection event —
// not called out explicitly in the plan, but needed for the Alerts page to stay a usable log
// rather than a flood of duplicates from a single physical event.
const ALERT_COOLDOWN_MS = 60_000;

// YuNet boxes hug the face (brow to chin), so a box drawn on them covers the very features a
// reviewer needs to see. Pad each side by this fraction of the face's width/height.
const FACE_BOX_PADDING_RATIO = 0.35;

// Snapshots are drawn on the full-resolution frame; capped so 4K cameras don't fill the disk.
const SNAPSHOT_MAX_SIDE = 1920;

@Injectable()
export class AlertPipelineService {
  private readonly logger = new Logger(AlertPipelineService.name);
  private readonly lastAlertAt = new Map<string, number>();

  constructor(
    private readonly alerts: AlertService,
    private readonly faceDetection: FaceDetectionService,
    private readonly faceRecognition: FaceRecognitionService,
    private readonly faceQuality: FaceQualityService,
    private readonly matchCache: FaceMatchCacheService,
    private readonly stats: UsageStatsService,
  ) {}

  // Faces are found on detectionFrame (the full frame scaled by `scale`, to keep detection cheap)
  // and mapped back to the full frame, where everything else happens: the size and quality checks,
  // alignment and embedding, and the alert snapshot. So face sizes are always in native pixels.
  async processFrame(
    channel: VideoFeedSource,
    frame: cv.Mat,
    detectionFrame: cv.Mat,
    scale: number,
  ) {
    const detectStartedAt = performance.now();
    const faces = this.faceDetection
      .detect(detectionFrame, undefined, undefined, false)
      .map((face) => unscaleFace(face, scale));
    this.stats.inference(
      channel.id,
      'detect',
      performance.now() - detectStartedAt,
    );
    if (faces.length === 0) return;

    const threshold = resolveSimilarityThreshold(channel.similarityThreshold);
    const minFaceSize = resolveMinFaceSize(channel.minFaceSizePx);
    const minFaceQuality = resolveMinFaceQuality(channel.minFaceQuality);

    for (const face of faces) {
      // Checked before alignment, so a face too small to match costs nothing more.
      const size = faceSizePx(face);
      if (size < minFaceSize) {
        this.stats.faceSkipped(channel.id, 'size');
        continue;
      }

      const aligned = this.faceRecognition.align(frame, face.landmarks);
      let quality: FaceQuality;
      let embedding: number[];
      try {
        quality = this.faceQuality.assess(face, aligned);
        if (quality.score < minFaceQuality) {
          this.stats.faceSkipped(channel.id, 'quality');
          continue;
        }
        const embedStartedAt = performance.now();
        embedding = this.faceRecognition.embed(aligned);
        this.stats.inference(
          channel.id,
          'embed',
          performance.now() - embedStartedAt,
        );
      } finally {
        aligned.release();
      }
      const match = this.matchCache.findBestMatch(embedding, threshold);
      if (match) {
        await this.triggerAlert(
          channel,
          frame,
          face.box,
          size,
          quality,
          match.profileId,
          match.profileName,
          match.score,
        );
      }
    }
  }

  private async triggerAlert(
    channel: VideoFeedSource,
    frame: cv.Mat,
    faceBox: DetectedFace['box'],
    faceSize: number,
    quality: FaceQuality,
    profileId: string,
    profileName: string,
    score: number,
  ) {
    const cooldownKey = `${channel.id}:${profileId}`;
    const now = Date.now();
    const last = this.lastAlertAt.get(cooldownKey);
    if (last && now - last < ALERT_COOLDOWN_MS) return;
    this.lastAlertAt.set(cooldownKey, now);

    const annotated = this.annotateMatchedFace(frame, faceBox);
    let image: Buffer;
    try {
      image = encodeJpeg(annotated, SNAPSHOT_MAX_SIDE);
    } finally {
      annotated.release();
    }
    await this.alerts.create(
      {
        monitoringProfileId: profileId,
        channelId: channel.id,
        similarityScore: score,
        faceSizePx: faceSize,
        faceQuality: quality as unknown as Prisma.InputJsonValue,
      },
      image,
    );
    this.logger.log(
      `ALERT: "${profileName}" detected on channel "${channel.name}" (cosine similarity ${score.toFixed(3)}, face ${faceSize}px, quality ${quality.score})`,
    );
  }

  // Draws on a copy: the same frame is still being iterated for other faces in processFrame, and
  // two profiles matched in one frame must each get a snapshot marking only their own face.
  private annotateMatchedFace(frame: cv.Mat, box: DetectedFace['box']): cv.Mat {
    const annotated = frame.copy();
    const padX = box.width * FACE_BOX_PADDING_RATIO;
    const padY = box.height * FACE_BOX_PADDING_RATIO;
    // YuNet boxes are float and, once padded, can extend past the frame edge for faces near it.
    const x1 = Math.max(0, Math.round(box.x - padX));
    const y1 = Math.max(0, Math.round(box.y - padY));
    const x2 = Math.min(frame.cols - 1, Math.round(box.x + box.width + padX));
    const y2 = Math.min(frame.rows - 1, Math.round(box.y + box.height + padY));
    // Scale the stroke with resolution so the box stays visible on 4K frames without being heavy on 480p.
    const thickness = Math.max(
      2,
      Math.round(Math.max(frame.cols, frame.rows) / 400),
    );
    annotated.drawRectangle(
      new cv.Point2(x1, y1),
      new cv.Point2(x2, y2),
      new cv.Vec3(0, 0, 255),
      thickness,
    );
    return annotated;
  }
}
