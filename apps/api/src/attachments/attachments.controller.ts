import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { requestUploadSchema, type RequestUploadInput } from "@relay/contracts";
import { CurrentUser, type RequestUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AttachmentsService } from "./attachments.service";

@Controller("channels/:channelId/attachments")
@UseGuards(JwtAuthGuard)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  requestUpload(
    @CurrentUser() user: RequestUser,
    @Param("channelId") channelId: string,
    @Body(new ZodValidationPipe(requestUploadSchema)) body: RequestUploadInput,
  ) {
    return this.attachments.requestUpload(user.userId, channelId, body);
  }
}
