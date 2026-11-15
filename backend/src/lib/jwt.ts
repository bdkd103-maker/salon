import jwt from "jsonwebtoken";
import { userAuthVersion, validAuthVersion } from "./auth-version.js";

export function signAccessToken(payload: { sub: string; role: string; authVersion?: number }) {
  return jwt.sign({ sub: payload.sub, role: payload.role, av: userAuthVersion(payload) }, process.env.JWT_ACCESS_SECRET!, {
    expiresIn: "15m",
  });
}

export function signRefreshToken(payload: { sub: string; sid: string; jti: string }) {
  return jwt.sign(
    { ...payload, typ: "refresh" },
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn: "7d" },
  );
}

export function verifyAccessToken(token: string) {
  const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as {
    sub: string;
    role: string;
    av?: number;
  };
  if (!payload || typeof payload.sub !== "string" || !payload.sub || typeof payload.role !== "string" || !payload.role
      || (payload.av !== undefined && !validAuthVersion(payload.av))) throw new Error("Invalid access token claims");
  return payload;
}

export interface RefreshTokenPayload {
  sub: string;
  sid: string;
  jti: string;
  typ: string;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as RefreshTokenPayload;
  if (
    payload.typ !== "refresh" ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    typeof payload.sid !== "string" ||
    !payload.sid ||
    typeof payload.jti !== "string" ||
    !payload.jti
  ) {
    throw new Error("Invalid refresh token claims");
  }
  return payload;
}
