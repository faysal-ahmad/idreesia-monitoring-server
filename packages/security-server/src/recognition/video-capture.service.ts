import { Injectable, Logger } from '@nestjs/common';
import * as cv from '@u4/opencv4nodejs';
import { RtspConfig, UsbConfig, VideoFeedSourceConfig } from '../video-feed-sources/video-feed-source-config.schema';

export interface CaptureResult {
  reachable: boolean;
  frame?: cv.Mat;
  error?: string;
}

@Injectable()
export class VideoCaptureService {
  private readonly logger = new Logger(VideoCaptureService.name);

  buildSource(type: 'RTSP' | 'USB', config: VideoFeedSourceConfig): string | number {
    if (type === 'RTSP') {
      const { host, port, path, username, password } = config as RtspConfig;
      const auth = username ? `${encodeURIComponent(username)}${password ? ':' + encodeURIComponent(password) : ''}@` : '';
      const cleanPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
      return `rtsp://${auth}${host}:${port}${cleanPath}`;
    }
    return (config as UsbConfig).deviceIndex;
  }

  // Opens the feed, reads a single frame, and releases — the minimum verification bar
  // for both RTSP and USB per the plan (no deeper checks like face-sized-region resolvability).
  captureFrame(type: 'RTSP' | 'USB', config: VideoFeedSourceConfig): CaptureResult {
    const source = this.buildSource(type, config);
    let capture: cv.VideoCapture | undefined;
    try {
      capture = new cv.VideoCapture(source);
      const frame = capture.read();
      if (!frame || frame.empty) {
        return { reachable: false, error: 'Opened the source but could not read a frame from it.' };
      }
      return { reachable: true, frame };
    } catch (error) {
      this.logger.warn(`Failed to capture frame from ${type} source: ${error}`);
      return { reachable: false, error: error instanceof Error ? error.message : 'Unknown error opening video source.' };
    } finally {
      capture?.release();
    }
  }
}
