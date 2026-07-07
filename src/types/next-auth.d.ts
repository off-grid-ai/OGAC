import { type DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface User {
    role?: string;
    org?: string;
  }
  interface Session {
    user: { role?: string; org?: string } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: string;
    org?: string;
  }
}
