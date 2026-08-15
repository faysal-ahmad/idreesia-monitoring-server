import { Module } from '@nestjs/common';
import { FaceDetectionService } from './face-detection.service';
import { FaceRecognitionService } from './face-recognition.service';
import { VideoCaptureService } from './video-capture.service';

@Module({
  providers: [FaceDetectionService, FaceRecognitionService, VideoCaptureService],
  exports: [FaceDetectionService, FaceRecognitionService, VideoCaptureService],
})
export class RecognitionModule {}
