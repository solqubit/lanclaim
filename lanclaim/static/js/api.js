// Cliente de la API. Cada mutación devuelve el estado completo.
import { t } from "./i18n.js";

let csrf = "";

async function readJson(response) {
  return response.json();
}

async function request(path, options) {
  let response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    response = await fetch(path, { cache: "no-store", ...options, signal: controller.signal });
    const data = await readJson(response);
    return { response, data };
  } catch {
    throw new Error(t("No se pudo conectar con el servidor."));
  } finally {
    clearTimeout(timer);
  }
}

export async function load() {
  const { response, data } = await request("/api/state");
  if (!response.ok) throw new Error(data.error || t("No se pudo conectar con el servidor."));
  csrf = data.csrf;
  return data;
}

export async function suggestions() {
  const { response, data } = await request("/api/suggestions");
  return response.ok ? data.networks || [] : [];
}

export async function post(path, body = {}, retry = true) {
  const { response, data } = await request(`/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify(body),
  });
  if (response.status === 403 && retry) {
    // El servidor se reinició y cambió el token: recargar y reintentar una vez.
    await load();
    return post(path, body, false);
  }
  if (!response.ok) {
    const error = new Error(data.error ? t(data.error) : t("La operación falló."));
    error.status = response.status;
    throw error;
  }
  csrf = data.csrf || csrf;
  return data;
}
