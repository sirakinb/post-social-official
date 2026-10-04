// Helpers for integration tests that run against the real InsForge dev branch.
// They refuse to run anywhere except the dev branch, because they create and delete
// users and workspaces.
import { readFileSync } from "node:fs";
import path from "node:path";

type ProjectLink = { project_name: string; oss_host: string; api_key: string };

export function devBackend() {
  const file = path.resolve(__dirname, "../../.insforge/project.json");
  const link = JSON.parse(readFileSync(file, "utf8")) as ProjectLink;
  if (link.project_name !== "dev") {
    throw new Error(`Integration tests only run against dev; this folder is linked to "${link.project_name}".`);
  }
  return { baseUrl: link.oss_host, adminKey: link.api_key };
}

export type ApiResult<T = unknown> = { status: number; body: T };

export async function api<T = unknown>(
  baseUrl: string,
  token: string,
  method: string,
  pathAndQuery: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const response = await fetch(baseUrl + pathAndQuery, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // keep raw text for error messages
  }
  return { status: response.status, body: parsed as T };
}

export function uniqueSuffix() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
