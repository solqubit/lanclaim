// Cliente de la API. Cada mutación devuelve el estado completo.
import { t } from "./i18n.js";

let csrf = "";

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function request(path, options) {
  let response;
  try {
    response = await fetch(path, { cache: "no-store", ...options });
  } catch {
    throw new Error(t("No se pudo conectar con el servidor."));
  }
  const data = await readJson(response);
  return { response, data };
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
  if (!response.ok) throw new Error(data.error ? t(data.error) : t("La operación falló."));
  csrf = data.csrf || csrf;
  return data;
}
