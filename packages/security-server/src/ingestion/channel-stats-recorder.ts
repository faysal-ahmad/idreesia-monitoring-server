import { Injectable } from '@nestjs/common';

// Per-channel counters for one stats window, kept by each ingestion process (see
// process/channel-loop.service.ts) and collected by UsageStatsService at the end of each window.
// Recording is in-memory counter bumps only, cheap enough to call from the frame loop.
export type FrameSkipReason = 'fps' | 'busy';
export type InferenceKind = 'detect' | 'embed';
export type FaceSkipReason = 'size' | 'quality';

export interface ChannelWindow {
  frameWidth?: number;
  frameHeight?: number;
  framesRead: number;
  framesProcessed: number;
  skippedFps: number;
  skippedBusy: number;
  readFailures: number;
  reconnects: number;
  // Detected faces skipped before matching (see face-gate.ts).
  skippedFaceSize: number;
  skippedFaceQuality: number;
  detectMs: number;
  detectCount: number;
  // One per embedded face, so embedCount is the face count.
  embedMs: number;
  embedCount: number;
}

function emptyWindow(): ChannelWindow {
  return {
    framesRead: 0,
    framesProcessed: 0,
    skippedFps: 0,
    skippedBusy: 0,
    readFailures: 0,
    reconnects: 0,
    skippedFaceSize: 0,
    skippedFaceQuality: 0,
    detectMs: 0,
    detectCount: 0,
    embedMs: 0,
    embedCount: 0,
  };
}

@Injectable()
export class ChannelStatsRecorder {
  private windows = new Map<string, ChannelWindow>();

  // Hands over the window so far and starts a new one, so frames recorded afterwards land in the next.
  take(): Record<string, ChannelWindow> {
    const windows = this.windows;
    this.windows = new Map();
    return Object.fromEntries(windows);
  }

  frameRead(channelId: string, width: number, height: number) {
    const window = this.window(channelId);
    window.framesRead++;
    window.frameWidth = width;
    window.frameHeight = height;
  }

  frameProcessed(channelId: string) {
    this.window(channelId).framesProcessed++;
  }

  frameSkipped(channelId: string, reason: FrameSkipReason) {
    const window = this.window(channelId);
    if (reason === 'busy') window.skippedBusy++;
    else window.skippedFps++;
  }

  faceSkipped(channelId: string, reason: FaceSkipReason) {
    const window = this.window(channelId);
    if (reason === 'size') window.skippedFaceSize++;
    else window.skippedFaceQuality++;
  }

  readFailure(channelId: string) {
    this.window(channelId).readFailures++;
  }

  reconnect(channelId: string) {
    this.window(channelId).reconnects++;
  }

  inference(channelId: string, kind: InferenceKind, ms: number) {
    const window = this.window(channelId);
    if (kind === 'detect') {
      window.detectMs += ms;
      window.detectCount++;
    } else {
      window.embedMs += ms;
      window.embedCount++;
    }
  }

  private window(channelId: string): ChannelWindow {
    let window = this.windows.get(channelId);
    if (!window) {
      window = emptyWindow();
      this.windows.set(channelId, window);
    }
    return window;
  }
}
