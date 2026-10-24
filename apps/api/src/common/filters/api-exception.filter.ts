import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { SplitError } from '@settled/core';
import type { Request, Response } from 'express';
import { AppError, ErrorCode } from '../errors';

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  429: 'RATE_LIMITED',
};

/** Maps every thrown error to the envelope in design §4.4. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = String(req.id ?? req.headers['x-request-id'] ?? '');

    let status = 500;
    let code: ErrorCode = 'INTERNAL';
    let message = 'Internal server error';
    let details: Record<string, unknown> | undefined;

    if (exception instanceof AppError) {
      ({ status, code, message, details } = exception);
    } else if (exception instanceof SplitError) {
      status = 400;
      ({ code, message, details } = exception);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODES[status] ?? 'INTERNAL';
      message = exception.message;
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).json({ error: { code, message, ...(details && { details }), requestId } });
  }
}
