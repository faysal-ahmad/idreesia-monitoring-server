import { ArgumentsHost, Catch, ConflictException, ExceptionFilter, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

// Translates Prisma's error codes into clean HTTP responses instead of a raw 500 —
// P2003: FK constraint violation (e.g. deleting a VideoFeedSource with Alert history)
// P2025: record required for the operation was not found
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception.code === 'P2003') {
      const httpException = new ConflictException(
        'This record cannot be deleted because other records still reference it.',
      );
      response.status(httpException.getStatus()).json(httpException.getResponse());
      return;
    }

    if (exception.code === 'P2025') {
      const httpException = new NotFoundException('Record not found.');
      response.status(httpException.getStatus()).json(httpException.getResponse());
      return;
    }

    throw exception;
  }
}
