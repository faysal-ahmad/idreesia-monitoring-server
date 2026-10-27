import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  StreamableFile,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { AlertImageStorageService } from './alert-image-storage.service';

@Public()
@Controller('alert-images')
export class AlertImageController {
  constructor(private readonly storage: AlertImageStorageService) {}

  // File names are random UUIDs that are never reused, so the image behind a URL never changes
  // and browsers can cache it indefinitely.
  @Get(':fileName')
  @Header('Content-Type', 'image/jpeg')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async get(@Param('fileName') fileName: string): Promise<StreamableFile> {
    const stream = await this.storage.open(fileName);
    if (!stream) throw new NotFoundException('Image not found.');
    return new StreamableFile(stream);
  }
}
