"use client";

function getStringField(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : "";
}

function isErrorRecord(error: unknown): error is Record<string, unknown> {
  return typeof error === "object" && error !== null;
}

export function getSafeSupabaseErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Try again.",
) {
  if (error instanceof Error) {
    return error.message;
  }

  if (!isErrorRecord(error)) {
    return fallback;
  }

  const message = getStringField(error.message);

  if (!message) {
    return fallback;
  }

  if (process.env.NODE_ENV === "production") {
    return message;
  }

  const code = getStringField(error.code);
  const details = getStringField(error.details);
  const hint = getStringField(error.hint);
  const status = getStringField(error.status);
  const extraParts = [
    code ? `Code: ${code}` : "",
    details ? `Details: ${details}` : "",
    hint ? `Hint: ${hint}` : "",
    status ? `Status: ${status}` : "",
  ].filter(Boolean);

  return extraParts.length > 0
    ? `${message} (${extraParts.join(" ")})`
    : message;
}
