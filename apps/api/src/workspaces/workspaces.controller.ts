import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import {
  createWorkspaceSchema,
  joinWorkspaceSchema,
  type CreateWorkspaceInput,
  type JoinWorkspaceInput,
} from "@relay/contracts";
import { CurrentUser, type RequestUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { WorkspacesService } from "./workspaces.service";

@Controller("workspaces")
@UseGuards(JwtAuthGuard)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createWorkspaceSchema)) body: CreateWorkspaceInput,
  ) {
    return this.workspaces.create(user.userId, body);
  }

  @Post("join")
  join(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(joinWorkspaceSchema)) body: JoinWorkspaceInput,
  ) {
    return this.workspaces.join(user.userId, body.slug);
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.workspaces.listForUser(user.userId);
  }
}
