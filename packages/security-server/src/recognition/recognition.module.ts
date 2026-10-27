import { Module } from '@nestjs/common';
import { FaceDetectionService } from './face-detection.service';
import { FaceQualityService } from './face-quality.service';
import { FaceRecognitionService } from './face-recognition.service';
import { VideoCaptureService } from './video-capture.service';

@Module({
  providers: [
    FaceDetectionService,
    FaceRecognitionService,
    FaceQualityService,
    VideoCaptureService,
  ],
  exports: [
    FaceDetectionService,
    FaceRecognitionService,
    FaceQualityService,
    VideoCaptureService,
  ],
})
export class RecognitionModule {}
