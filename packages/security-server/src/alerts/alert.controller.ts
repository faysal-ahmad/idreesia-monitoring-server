import { Body, Controller, Get, Header, HttpCode, Param, Patch, StreamableFile } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ReviewAlertSchema } from './alert.schema';
import { AlertService } from './alert.service';

@Controller('alerts')
export class AlertController {
  constructor(private readonly service: AlertService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Patch(':id/review')
  @HttpCode(204)
  review(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewAlertSchema)) dto: ReturnType<typeof ReviewAlertSchema.parse>,
  ) {
    return this.service.review(id, dto);
  }

  @Get(':id/image')
  @Header('Content-Type', 'image/jpeg')
  async getImage(@Param('id') id: string): Promise<StreamableFile> {
    const image = await this.service.getImage(id);
    return new StreamableFile(image);
  }
}
