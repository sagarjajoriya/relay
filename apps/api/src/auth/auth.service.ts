import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { prisma } from "@relay/db";
import type { AuthResponse, AuthTokens } from "@relay/contracts";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { UsersService } from "../users/users.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(input: { email: string; password: string; displayName: string }): Promise<AuthResponse> {
    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      throw new ConflictException("An account with this email already exists");
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const user = await this.users.create({
      email: input.email,
      displayName: input.displayName,
      passwordHash,
    });

    const tokens = await this.issueTokens(user.id, user.email);
    return { ...tokens, user: { id: user.id, email: user.email, displayName: user.displayName } };
  }

  async login(input: { email: string; password: string }): Promise<AuthResponse> {
    const user = await this.users.findByEmail(input.email);
    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const valid = await argon2.verify(user.passwordHash, input.password);
    if (!valid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const tokens = await this.issueTokens(user.id, user.email);
    return { ...tokens, user: { id: user.id, email: user.email, displayName: user.displayName } };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing || existing.expiresAt < new Date()) {
      throw new UnauthorizedException("Refresh token is invalid or expired");
    }

    // A token presented after it was already rotated means the refresh chain
    // was replayed (e.g. stolen and used by two parties) — treat that as a
    // compromise signal and revoke every outstanding token for this user.
    if (existing.revokedAt || existing.replacedBy) {
      await prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException("Refresh token reuse detected; all sessions revoked");
    }

    const user = await this.users.findById(existing.userId);
    if (!user) {
      throw new UnauthorizedException("Refresh token is invalid or expired");
    }

    const newRefreshToken = await this.createRefreshToken(user.id);
    await prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedBy: newRefreshToken.id },
    });

    const accessToken = this.signAccessToken(user.id, user.email);
    return { accessToken, refreshToken: newRefreshToken.plaintext };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(userId: string, email: string): Promise<AuthTokens> {
    const accessToken = this.signAccessToken(userId, email);
    const refreshToken = await this.createRefreshToken(userId);
    return { accessToken, refreshToken: refreshToken.plaintext };
  }

  private signAccessToken(userId: string, email: string): string {
    return this.jwt.sign(
      { sub: userId, email },
      {
        secret: this.config.get<string>("JWT_ACCESS_SECRET"),
        expiresIn: this.config.get<string>("JWT_ACCESS_TTL"),
      },
    );
  }

  private async createRefreshToken(userId: string) {
    const plaintext = randomBytes(64).toString("hex");
    const tokenHash = this.hashRefreshToken(plaintext);
    const ttlDays = this.config.get<number>("REFRESH_TOKEN_TTL_DAYS")!;
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    const row = await prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt },
    });

    return { id: row.id, plaintext };
  }

  // Refresh tokens are high-entropy random bytes, not low-entropy secrets
  // like passwords, so a fast cryptographic hash is sufficient here — no
  // need for argon2's memory-hardness, which exists to slow down brute
  // forcing of guessable inputs.
  private hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
