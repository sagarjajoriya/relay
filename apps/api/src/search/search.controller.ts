import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { searchQuerySchema, type SearchQuery } from "@relay/contracts";
import { CurrentUser, type RequestUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { SearchService } from "./search.service";

@Controller("workspaces/:workspaceId/search")
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  run(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQuery,
  ) {
    return this.search.search(user.userId, workspaceId, query);
  }
}
