import { Injectable, Logger } from '@nestjs/common';
import * as cv from '@u4/opencv4nodejs';
import { RtspConfig } from '../video-feed-sources/video-feed-source-config.schema';

export interface CaptureResult {
  reachable: boolean;
  frame?: cv.Mat;
  error?: string;
}

@Injectable()
export class VideoCaptureService {
  private readonly logger = new Logger(VideoCaptureService.name);

  buildRtspUrl({ host, port, path, username, password }: RtspConfig): string {
    const auth = username ? `${encodeURIComponent(username)}${password ? ':' + encodeURIComponent(password) : ''}@` : '';
    const cleanPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
    return `rtsp://${auth}${host}:${port}${cleanPath}`;
  }

  // Opens the stream, reads a single frame, and releases — the minimum verification bar
  // (no deeper checks like face-sized-region resolvability).
  captureFrame(url: string): CaptureResult {
    let capture: cv.VideoCapture | undefined;
    try {
      capture = new cv.VideoCapture(url);
      const frame = capture.read();
      if (!frame || frame.empty) {
        return { reachable: false, error: 'Opened the source but could not read a frame from it.' };
      }
      return { reachable: true, frame };
    } catch (error) {
      this.logger.warn(`Failed to capture frame from RTSP source: ${error}`);
      return { reachable: false, error: error instanceof Error ? error.message : 'Unknown error opening video source.' };
    } finally {
      capture?.release();
    }
  }
}
