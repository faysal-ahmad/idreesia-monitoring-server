import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ConfigurationService } from './configuration.service';
import {
  ConfigValues,
  UpdateConfigurationSchema,
} from './configuration.schema';

// The ERP password stays on the server: the UI only learns whether one is set.
function withoutSecrets({ erpPassword, ...values }: ConfigValues) {
  return { ...values, hasErpPassword: erpPassword !== '' };
}

@Controller('configuration')
export class ConfigurationController {
  constructor(private readonly service: ConfigurationService) {}

  @Get()
  async get() {
    return withoutSecrets(await this.service.getAll());
  }

  @Patch()
  async update(
    @Body(new ZodValidationPipe(UpdateConfigurationSchema))
    dto: ReturnType<typeof UpdateConfigurationSchema.parse>,
  ) {
    // A blank password keeps the stored one, since the form never has it to send back.
    const { erpPassword, ...rest } = dto;
    return withoutSecrets(await this.service.update(erpPassword ? dto : rest));
  }
}
