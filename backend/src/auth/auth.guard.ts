import fs from "node:fs";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { AppConfig } from "../common/config";
import type { AuthUser } from "../common/current-user";
import { IS_PUBLIC } from "../common/public";
import { APP_CONFIG } from "../common/tokens";
import { PrismaService } from "../database/prisma.service";

interface AuthenticatedRequest extends FastifyRequest { user: AuthUser }

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const claims = this.config.authMode === "development" ? this.developmentClaims() : await this.firebaseClaims(request);
    const user = await this.prisma.user.upsert({
      where: { firebaseUid: claims.uid },
      update: {
        email: claims.email ?? null,
        emailVerified: claims.emailVerified,
        displayName: claims.displayName ?? null,
        photoUrl: claims.photoUrl ?? null,
        authProvider: claims.provider
      },
      create: {
        firebaseUid: claims.uid,
        email: claims.email ?? null,
        emailVerified: claims.emailVerified,
        displayName: claims.displayName ?? null,
        photoUrl: claims.photoUrl ?? null,
        authProvider: claims.provider
      }
    });
    request.user = { id: user.id, firebaseUid: user.firebaseUid, email: user.email, displayName: user.displayName };
    return true;
  }

  private developmentClaims() {
    return {
      uid: "development-user",
      email: "developer@easy-latex.local",
      emailVerified: true,
      displayName: "Development User",
      photoUrl: undefined,
      provider: "development"
    };
  }

  private async firebaseClaims(request: FastifyRequest) {
    const value = request.headers.authorization;
    if (!value?.startsWith("Bearer ")) throw new UnauthorizedException("A Firebase bearer token is required");
    const token = value.slice(7).trim();
    if (!token) throw new UnauthorizedException("A Firebase bearer token is required");
    try {
      if (!getApps().length) {
        const json = process.env.FIREBASE_CREDENTIALS_JSON;
        const credentialsPath = process.env.FIREBASE_CREDENTIALS_PATH;
        const credential = json
          ? cert(JSON.parse(json))
          : credentialsPath && fs.existsSync(credentialsPath)
            ? cert(JSON.parse(fs.readFileSync(credentialsPath, "utf8")))
            : applicationDefault();
        initializeApp({ credential, projectId: process.env.FIREBASE_PROJECT_ID });
      }
      const decoded = await getAuth().verifyIdToken(token, true);
      return {
        uid: decoded.uid,
        email: decoded.email,
        emailVerified: decoded.email_verified ?? false,
        displayName: decoded.name,
        photoUrl: decoded.picture,
        provider: decoded.firebase.sign_in_provider
      };
    } catch {
      throw new UnauthorizedException("The Firebase token is invalid or expired");
    }
  }
}
