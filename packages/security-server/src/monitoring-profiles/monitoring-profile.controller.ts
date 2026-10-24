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
import { Public } from '../auth/public.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CreateMonitoringProfileSchema, UpdateMonitoringProfileSchema } from './monitoring-profile.schema';
import { MonitoringProfileService } from './monitoring-profile.service';

@Controller('monitoring-profiles')
export class MonitoringProfileController {
  constructor(private readonly service: MonitoringProfileService) {}

  @Get()
  list() {
    return this.service.list();
  }

  // Public for the Alerts page's dialog, which shows the matched profile's photos.
  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateMonitoringProfileSchema)) dto: ReturnType<typeof CreateMonitoringProfileSchema.parse>,
  ) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateMonitoringProfileSchema)) dto: ReturnType<typeof UpdateMonitoringProfileSchema.parse>,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  // No app-enforced size cap per the plan — whatever the detection pipeline's decoder can
  // handle is accepted, so multer's own limits are left at their generous defaults here.
  @Post(':id/images')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  addImage(
    @Param('id') profileId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('acknowledgeWarning') acknowledgeWarning?: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file was uploaded.');
    }
    return this.service.addImage(profileId, file.buffer, acknowledgeWarning === 'true');
  }

  @Delete(':id/images/:imageId')
  @HttpCode(204)
  removeImage(@Param('id') profileId: string, @Param('imageId') imageId: string) {
    return this.service.removeImage(profileId, imageId);
  }
}
