import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role?: "ADMIN" | "DRIVER";
    locale?: string;
  }
  interface Session {
    user: { id: string; role: "ADMIN" | "DRIVER"; locale: string } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "ADMIN" | "DRIVER";
    locale?: string;
  }
}
