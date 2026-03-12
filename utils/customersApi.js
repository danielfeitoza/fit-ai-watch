const API_BASE_URL = "http://192.168.1.7:3001";

function normalizeCustomers(payload) {
  if (!Array.isArray(payload)) return [];

  return payload.map((item) => ({
    id: Number(item.id),
    name: String(item.name || ""),
    status: !!item.status,
  }));
}

async function parseJson(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

export async function getCustomers() {
  if (typeof fetch !== "function") {
    throw new Error("HTTP indisponível no runtime atual do relógio.");
  }

  const response = await fetch(`${API_BASE_URL}/customers`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Falha no GET /customers (${response.status})`);
  }

  const data = await parseJson(response);
  return normalizeCustomers(data);
}

export async function saveCustomersStatus(customers) {
  if (typeof fetch !== "function") {
    throw new Error("HTTP indisponível no runtime atual do relógio.");
  }

  const payload = customers.map((item) => ({
    id: Number(item.id),
    status: !!item.status,
  }));

  const response = await fetch(`${API_BASE_URL}/customers/status`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ customers: payload }),
  });

  if (!response.ok) {
    throw new Error(`Falha no PUT /customers/status (${response.status})`);
  }

  return parseJson(response);
}
