const origin = request.headers.get("Origin") || "";
const allowedOrigin = env.ALLOWED_ORIGIN || "";

if (request.method === "OPTIONS") {
  if (!allowedOrigin || origin !== allowedOrigin) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders(allowedOrigin)
  });
}

const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
});

const allowedModes = new Set(["video", "client", "ad", "calendar"]);

const trim = (value, max = 1200) =>
  String(value ?? "").trim().slice(0, max);

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "";
    console.log("CORS diagnostic", {
  method: request.method,
  origin: JSON.stringify(origin),
  allowedOrigin: JSON.stringify(allowedOrigin)
});

    // Обрабатываем предварительный запрос браузера.
    if (request.method === "OPTIONS") {
      if (!allowedOrigin || origin !== allowedOrigin) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowedOrigin)
      });
    }

    if (!allowedOrigin || origin !== allowedOrigin) {
      return new Response(
        JSON.stringify({ error: "Источник запроса не разрешён." }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Vary": "Origin"
          }
        }
      );
    }

    const cors = corsHeaders(allowedOrigin);

    if (request.method !== "POST") {
      return json({ error: "Разрешён только POST." }, 405, cors);
    }

    if (!env.GEMINI_API_KEY) {
      return json({ error: "На сервере не настроен ключ нейросети." }, 500, cors);
    }

    let body;
    try {
      const raw = await request.text();
      if (raw.length > 10000) {
        return json({ error: "Запрос слишком большой." }, 413, cors);
      }
      body = JSON.parse(raw);
    } catch {
      return json({ error: "Некорректный JSON." }, 400, cors);
    }

    const mode = trim(body.mode, 20);
    if (!allowedModes.has(mode)) {
      return json({ error: "Неизвестный тип задачи." }, 400, cors);
    }

    const niche = trim(body.niche, 160) || "малый бизнес";
    const audience = trim(body.audience, 240) || "потенциальные клиенты";
    const offer = trim(body.offer, 240) || "услуги компании";
    const style = trim(body.style, 80) || "Дружелюбный и понятный";
    const extra = trim(body.extra, 1200) || "Дополнительных деталей нет.";

    const tasks = {
      video: "Напиши сценарий вертикального видео на 20–35 секунд: зацепка, полезная часть, пример, призыв к действию и подсказки по кадрам.",
      client: "Составь уважительное первое сообщение потенциальному бизнес-клиенту об услугах контента. Не выдумывай факты о компании. Добавь место для личного наблюдения.",
      ad: "Создай 2 варианта рекламы: заголовок, текст и призыв к действию. Не выдумывай цены, отзывы и гарантии.",
      calendar: "Составь контент-план на 7 дней. Для каждого дня укажи формат, тему, заголовок, содержание и призыв к действию."
    };

    const prompt = `Ты — русскоязычный контент-маркетолог для малого бизнеса.
Пиши конкретно, естественно и без воды. Не обещай гарантированные результаты.
Задача: ${tasks[mode]}
Ниша: ${niche}
Аудитория: ${audience}
Продукт или услуга: ${offer}
Стиль: ${style}
Дополнительные детали: ${extra}
Ответь на русском языке в удобном для копирования формате.`;

    const model = env.GEMINI_MODEL || "gemini-2.5-flash";
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    let apiResponse;
    try {
      apiResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 1400
          }
        })
      });
    } catch {
      return json({ error: "Не удалось подключиться к Gemini API." }, 502, cors);
    }

    const result = await apiResponse.json().catch(() => ({}));

    if (!apiResponse.ok) {
      console.error("Gemini API error", apiResponse.status, result.error?.message);
      return json({
        error: `Gemini API вернул ошибку ${apiResponse.status}. Проверь модель и доступ к API.`
      }, 502, cors);
    }

    const text = (result.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || "")
      .join("\n")
      .trim();

    if (!text) {
      return json({ error: "Gemini не вернул текст." }, 502, cors);
    }

    return json({ text }, 200, cors);
  }
};
