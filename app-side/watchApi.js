export const API_BASE_URLS = ["https://www.fitaiapi.cidadeladocodigo.com.br"];

function parseBody(body) {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (_error) {
      return body;
    }
  }

  return body;
}

function buildError(message, status = 0, data = null) {
  const error = new Error(message);
  error.status = status;
  error.data = data;
  return error;
}

export async function requestApi(service, path, method = "GET", body = undefined, expectedStatus = []) {
  let lastError = null;
  const accepted = Array.isArray(expectedStatus) ? expectedStatus : [];

  for (const baseUrl of API_BASE_URLS) {
    try {
      const response = await service.fetch({
        url: `${baseUrl}${path}`,
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      const status = Number(response?.status || 0);
      const data = parseBody(response?.body);

      if (accepted.length && accepted.includes(status)) {
        return { status, data };
      }

      if (!accepted.length && status >= 200 && status < 300) {
        return { status, data };
      }

      const message = data?.message || data?.error || `HTTP ${status}`;
      throw buildError(message, status, data);
    } catch (error) {
      lastError = error;
    }
  }

  throw buildError(lastError?.message || "Sem conexao com a API", lastError?.status || 0);
}

function respondWithPromise(promise, res, fallbackMessage) {
  promise
    .then((result) => {
      res(null, result);
    })
    .catch((error) => {
      res(error?.message || fallbackMessage);
    });
}

export function handleWatchRequest(service, req, res) {
  if (req.method === "watch.getToday") {
    const date = req.params?.date;
    const deviceCode = req.params?.deviceCode;

    if (!date || !deviceCode) {
      res("Parametros obrigatorios ausentes");
      return true;
    }

    const path = `/watch/today/${encodeURIComponent(date)}?deviceCode=${encodeURIComponent(deviceCode)}`;
    respondWithPromise(requestApi(service, path, "GET", undefined, [200, 404, 500]), res, "Falha ao consultar treino do dia");
    return true;
  }

  if (req.method === "watch.getUserId") {
    const deviceCode = req.params?.deviceCode;

    if (!deviceCode) {
      res("Parametros obrigatorios ausentes");
      return true;
    }

    const path = `/watch/user-id?deviceCode=${encodeURIComponent(deviceCode)}`;
    respondWithPromise(requestApi(service, path, "GET", undefined, [200, 404, 500]), res, "Falha ao consultar userId do device");
    return true;
  }

  if (req.method === "watch.getActiveSession") {
    const date = req.params?.date;
    const userId = req.params?.userId;

    if (!date || !userId) {
      res("Parametros obrigatorios ausentes");
      return true;
    }

    const path = `/watch/sessions/active/${encodeURIComponent(date)}?userId=${encodeURIComponent(userId)}`;
    respondWithPromise(requestApi(service, path, "GET", undefined, [200, 404, 500]), res, "Falha ao consultar sessao ativa");
    return true;
  }

  if (req.method === "watch.startSession") {
    respondWithPromise(requestApi(service, "/watch/sessions/start", "POST", req.params || {}, [201, 404, 500]), res, "Falha ao iniciar treino");
    return true;
  }

  if (req.method === "watch.finishSession") {
    const sessionId = req.params?.sessionId;

    if (!sessionId) {
      res("Parametros obrigatorios ausentes");
      return true;
    }

    const body = {
      deviceCode: req.params?.deviceCode,
      workoutPlanId: req.params?.workoutPlanId,
      workoutDayId: req.params?.workoutDayId,
      completedAt: req.params?.completedAt,
    };

    const path = `/watch/sessions/${encodeURIComponent(sessionId)}/finish`;
    respondWithPromise(requestApi(service, path, "PATCH", body, [200, 204, 404, 500]), res, "Falha ao finalizar treino");
    return true;
  }

  return false;
}
