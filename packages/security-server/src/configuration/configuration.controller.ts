import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ConfigurationService } from './configuration.service';
import { UpdateConfigurationSchema } from './configuration.schema';

@Controller('configuration')
export class ConfigurationController {
  constructor(private readonly service: ConfigurationService) {}

  @Get()
  get() {
    return this.service.getAll();
  }

  @Patch()
  update(
    @Body(new ZodValidationPipe(UpdateConfigurationSchema)) dto: ReturnType<typeof UpdateConfigurationSchema.parse>,
  ) {
    return this.service.update(dto);
  }
}
