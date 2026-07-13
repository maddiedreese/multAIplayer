import { z } from "zod";
export const PublicKeyFingerprint = z.string().regex(/^sha256:[a-f0-9]{4}(?::[a-f0-9]{4}){15}$/);
