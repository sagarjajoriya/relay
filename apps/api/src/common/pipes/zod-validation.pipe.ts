import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

// Validates against the same zod schema the frontend uses for form validation
// (from @relay/contracts), instead of maintaining parallel class-validator
// DTOs that could drift from what the client actually sends.
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
