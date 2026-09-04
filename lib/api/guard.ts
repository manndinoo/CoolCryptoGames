import { NextResponse } from "next/server";

/**
 * Wraps a route handler so an unhandled failure becomes a structured response
 * instead of an empty 500.
 *
 * The specific failure this was written for: with no DATABASE_URL configured,
 * every authenticated route threw before producing a body. The browser got a
 * 500 with nothing in it, `response.json()` threw on the client, and the catch
 * there treated it as the player dismissing their wallet — so a completely
 * broken sign-in looked like a button that did nothing at all. A route that
 * fails should say that it failed.
 *
 * Storage being unreachable is reported as 503 rather than 500: it is a
 * temporary condition of the deployment, the client can reasonably suggest
 * trying again, and it is worth distinguishing from a genuine bug in a handler.
 */
export function withRouteGuard<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (isStorageUnavailable(err)) {
        console.error("[ccg] storage unavailable:", describe(err));
        return NextResponse.json(
          { error: "service_unavailable", reason: "storage_unavailable" },
          { status: 503 },
        );
      }

      // Logged in full, reported in outline. Internal detail in a response body
      // tells an attacker about the stack behind it.
      console.error("[ccg] unhandled route error:", err);
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
  };
}

/** Configuration gaps and connection failures both mean "no database". */
function isStorageUnavailable(err: unknown): boolean {
  const message = describe(err).toLowerCase();
  return (
    message.includes("database_url") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("etimedout") ||
    message.includes("connection terminated") ||
    message.includes("could not connect")
  );
}

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
