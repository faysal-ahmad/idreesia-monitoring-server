import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
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
}
