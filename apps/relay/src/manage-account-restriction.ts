import { resolve } from "node:path";
import { isRecord } from "@multaiplayer/protocol";
import { createRelayPersistence } from "./persistence.js";
import type { AccountRestriction } from "./state.js";
import { validateAccountRestriction } from "./auth/account-restrictions.js";

const parsed = parseArguments(process.argv.slice(2));
const persistence = createRelayPersistence({ dataPath: parsed.dataPath });

try {
  const loaded = await persistence.load();
  if (!isRecord(loaded) || loaded.version !== 1) {
    throw new Error("Relay store must exist and use version 1. Refusing to create or replace an unknown store.");
  }
  const restrictions = new Map<string, AccountRestriction>();
  if (Array.isArray(loaded.accountRestrictions)) {
    for (const item of loaded.accountRestrictions) {
      if (isRecord(item) && typeof item.userId === "string")
        restrictions.set(item.userId, item as unknown as AccountRestriction);
    }
  }

  if (parsed.action === "restrict") {
    const restriction: AccountRestriction = {
      userId: parsed.userId,
      reasonCode: parsed.reasonCode,
      createdAt: new Date().toISOString(),
      ...(parsed.expiresAt ? { expiresAt: parsed.expiresAt } : {})
    };
    validateAccountRestriction(restriction);
    restrictions.set(parsed.userId, restriction);
  } else {
    restrictions.delete(parsed.userId);
  }

  await persistence.save({ ...loaded, accountRestrictions: Array.from(restrictions.values()) });
  process.stdout.write(
    `${JSON.stringify({ ok: true, action: parsed.action, userId: parsed.userId, restrictions: restrictions.size })}\n`
  );
} finally {
  persistence.close();
}

function parseArguments(args: string[]): {
  action: "restrict" | "unrestrict";
  userId: string;
  reasonCode: string;
  expiresAt?: string;
  dataPath: string;
} {
  if (!args.includes("--confirm-relay-stopped")) {
    usage("--confirm-relay-stopped is required because the CLI must not race the single relay writer");
  }
  const [action, userId, reason = "operator_restriction"] = args.filter((arg) => !arg.startsWith("--"));
  if (action !== "restrict" && action !== "unrestrict") usage("action must be restrict or unrestrict");
  if (!userId) usage("user id is required");
  const dataPathValue = option(args, "data-path") ?? process.env.MULTAIPLAYER_RELAY_DATA_PATH;
  if (!dataPathValue) usage("--data-path or MULTAIPLAYER_RELAY_DATA_PATH is required");
  const expiresAt = option(args, "expires-at");
  return {
    action,
    userId,
    reasonCode: reason,
    ...(expiresAt ? { expiresAt } : {}),
    dataPath: resolve(dataPathValue)
  };
}

function option(args: string[], name: string) {
  return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function usage(message: string): never {
  throw new Error(
    `${message}. Usage: restrictions:manage -- restrict <user-id> [reason_code] --data-path=<path> --confirm-relay-stopped [--expires-at=<ISO>]`
  );
}
