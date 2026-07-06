import { Injectable } from "@nestjs/common";
import { prisma, type User } from "@relay/db";

@Injectable()
export class UsersService {
  findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  create(data: { email: string; displayName: string; passwordHash: string }): Promise<User> {
    return prisma.user.create({ data });
  }
}
