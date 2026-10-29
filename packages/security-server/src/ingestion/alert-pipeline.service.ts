import { Injectable, Logger } from '@nestjs/common';
import { VideoFeedSource } from '@prisma/client';
import * as cv from '@u4/opencv4nodejs';
import { AlertService } from '../alerts/alert.service';
import { FaceDetectionService } from '../recognition/face-detection.service';
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

@Injectable()
export class AlertPipelineService {
  private readonly logger = new Logger(AlertPipelineService.name);
  private readonly lastAlertAt = new Map<string, number>();

  constructor(
    private readonly alerts: AlertService,
    private readonly faceDetection: FaceDetectionService,
    private readonly faceRecognition: FaceRecognitionService,
    private readonly matchCache: FaceMatchCacheService,
    private readonly stats: UsageStatsService,
  ) {}

  async processFrame(channel: VideoFeedSource, frame: cv.Mat) {
    const detectStartedAt = performance.now();
    const faces = this.faceDetection.detect(frame);
    this.stats.inference(
      channel.id,
      'detect',
      performance.now() - detectStartedAt,
    );
    if (faces.length === 0) return;

    const threshold = resolveSimilarityThreshold(channel.similarityThreshold);

    for (const face of faces) {
      const aligned = this.faceRecognition.align(frame, face.landmarks);
      let embedding: number[];
      try {
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
      image = cv.imencode('.jpg', annotated);
    } finally {
      annotated.release();
    }
    await this.alerts.create(
      {
        monitoringProfileId: profileId,
        channelId: channel.id,
        similarityScore: score,
      },
      image,
    );
    this.logger.log(
      `ALERT: "${profileName}" detected on channel "${channel.name}" (cosine similarity ${score.toFixed(3)})`,
    );
  }

  // Draws on a copy: the same frame is still being iterated for other faces in processFrame, and
  // two profiles matched in one frame must each get a snapshot marking only their own face.
  private annotateMatchedFace(frame: cv.Mat, box: DetectedFace['box']): cv.Mat {
    const annotated = frame.copy();
    // YuNet boxes are float and can extend past the frame edge for faces partly out of shot.
    const x1 = Math.max(0, Math.round(box.x));
    const y1 = Math.max(0, Math.round(box.y));
    const x2 = Math.min(frame.cols - 1, Math.round(box.x + box.width));
    const y2 = Math.min(frame.rows - 1, Math.round(box.y + box.height));
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
