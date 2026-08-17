import { randomUUID } from "crypto";
export const uuid = () => randomUUID();
export const nowIso = () => new Date().toISOString();
