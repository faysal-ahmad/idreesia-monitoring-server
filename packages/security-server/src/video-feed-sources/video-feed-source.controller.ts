import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  CreateVideoFeedSourceSchema,
  UpdateVideoFeedSourceSchema,
  VerifyVideoFeedSourceSchema,
} from './video-feed-source.schema';
import { VideoFeedSourceService } from './video-feed-source.service';

@Controller('video-feed-sources')
export class VideoFeedSourceController {
  constructor(private readonly service: VideoFeedSourceService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateVideoFeedSourceSchema))
    dto: ReturnType<typeof CreateVideoFeedSourceSchema.parse>,
  ) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateVideoFeedSourceSchema))
    dto: ReturnType<typeof UpdateVideoFeedSourceSchema.parse>,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  // Checks unsaved connection details from the add/edit form, so they can be tested before saving.
  @Post('verify')
  @HttpCode(200)
  verify(
    @Body(new ZodValidationPipe(VerifyVideoFeedSourceSchema))
    dto: ReturnType<typeof VerifyVideoFeedSourceSchema.parse>,
  ) {
    return this.service.verify(dto);
  }

  @Post(':id/test-match')
  testMatch(@Param('id') id: string) {
    return this.service.testMatch(id);
  }

  // A frame the admin captured from the live view, as an image file.
  @Post(':id/analyze-frame')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  analyzeFrame(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file was uploaded.');
    }
    return this.service.analyzeFrame(id, file.buffer);
  }
}
