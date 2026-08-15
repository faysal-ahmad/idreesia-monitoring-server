import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import { AlertService } from './alert.service';

@Controller('alerts')
export class AlertController {
  constructor(private readonly service: AlertService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id/image')
  @Header('Content-Type', 'image/jpeg')
  async getImage(@Param('id') id: string): Promise<StreamableFile> {
    const image = await this.service.getImage(id);
    return new StreamableFile(image);
  }
}
