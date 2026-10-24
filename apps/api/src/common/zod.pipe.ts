import { PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from './errors';

/** Validates a body or query with a Zod schema; failures become VALIDATION_FAILED with `details.fields`. */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 400, 'Invalid input', { fields: z.flattenError(parsed.error).fieldErrors });
    }
    return parsed.data;
  }
}
