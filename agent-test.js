import readline from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { getClient, DEFAULT_MODEL } from "./ai-client/index.js";

const RATE_LIMIT_PER_MIN = 20;
const RATE_WINDOW_MS = 60_000;
const MAX_RETRIES = 5;

const SIGNS = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
];

// Lahiri ayanamsa, approximate for this era. Good enough for a demo chart.
const AYANAMSA = 24.1;
const OBLIQUITY = 23.4392911;

// Small local geocoding table so we never need an HTTP call.
const CITIES = {
  delhi: { name: "Delhi", lat: 28.6139, lon: 77.209, tz: 5.5 },
  "new delhi": { name: "New Delhi", lat: 28.6139, lon: 77.209, tz: 5.5 },
  mumbai: { name: "Mumbai", lat: 19.076, lon: 72.8777, tz: 5.5 },
  kolkata: { name: "Kolkata", lat: 22.5726, lon: 88.3639, tz: 5.5 },
  bengaluru: { name: "Bengaluru", lat: 12.9716, lon: 77.5946, tz: 5.5 },
  bangalore: { name: "Bangalore", lat: 12.9716, lon: 77.5946, tz: 5.5 },
  chennai: { name: "Chennai", lat: 13.0827, lon: 80.2707, tz: 5.5 },
  hyderabad: { name: "Hyderabad", lat: 17.385, lon: 78.4867, tz: 5.5 },
  pune: { name: "Pune", lat: 18.5204, lon: 73.8567, tz: 5.5 },
  jaipur: { name: "Jaipur", lat: 26.9124, lon: 75.7873, tz: 5.5 },
  lucknow: { name: "Lucknow", lat: 26.8467, lon: 80.9462, tz: 5.5 },
  ahmedabad: { name: "Ahmedabad", lat: 23.0225, lon: 72.5714, tz: 5.5 },
  surat: { name: "Surat", lat: 21.1702, lon: 72.8311, tz: 5.5 },
  kanpur: { name: "Kanpur", lat: 26.4499, lon: 80.3319, tz: 5.5 },
  nagpur: { name: "Nagpur", lat: 21.1458, lon: 79.0882, tz: 5.5 },
  indore: { name: "Indore", lat: 22.7196, lon: 75.8577, tz: 5.5 },
};

const SYSTEM_PROMPT = `You are a friendly Vedic astrology assistant.

Rules:
1. To make a D1 (Lagna) chart you need: birth date (YYYY-MM-DD), birth time (24h HH:MM) and birth place (city name).
2. If any of these are missing, ask the user for them in plain, natural language. Ask only for what is missing.
3. Once you have all three, call the "calculate_d1_chart" tool and then interpret the result and answer the user's question.
4. Keep answers concise and practical. Mention clearly that this is a simplified chart (only Ascendant and Sun are computed).
5. Reply in the same language the user used.`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(step, detail = "") {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`[${time}] ${step}${detail ? ` ${detail}` : ""}`);
}

function norm360(deg) {
  return ((deg % 360) + 360) % 360;
}

function toJulianDay(dateStr, timeStr, tzHours) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  if (!y || !m || !d || hh == null || mm == null) {
    throw new Error("Invalid date/time. Use YYYY-MM-DD and HH:MM.");
  }
  const utcMs = Date.UTC(y, m - 1, d, hh, mm) - tzHours * 3600 * 1000;
  return utcMs / 86400000 + 2440587.5;
}

function greenwichSiderealTime(jd) {
  const d = jd - 2451545.0;
  return norm360(280.46061837 + 360.98564736629 * d);
}

function sunLongitude(jd) {
  const n = jd - 2451545.0;
  const meanLon = norm360(280.46 + 0.9856474 * n);
  const meanAnomaly = norm360(357.528 + 0.9856003 * n);
  const g = (meanAnomaly * Math.PI) / 180;
  return norm360(meanLon + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
}

function ascendant(jd, lat, lon) {
  const lst = norm360(greenwichSiderealTime(jd) + lon);
  const ramc = (lst * Math.PI) / 180;
  const eps = (OBLIQUITY * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const asc = Math.atan2(
    Math.cos(ramc),
    -(Math.sin(ramc) * Math.cos(eps) + Math.tan(latRad) * Math.sin(eps))
  );
  return norm360((asc * 180) / Math.PI);
}

function signIndex(longitude) {
  return Math.floor(norm360(longitude) / 30);
}

function houseOf(signNumber, lagnaNumber) {
  return ((signNumber - lagnaNumber + 12) % 12) + 1;
}

export function calculateD1Chart(args) {
  const place = typeof args.place === "string" ? args.place.trim().toLowerCase() : "";
  const city = CITIES[place];

  if (!city) {
    return {
      error: `City "${args.place}" not in local database. Supported: ${Object.keys(CITIES).join(", ")}.`,
    };
  }

  try {
    const jd = toJulianDay(args.birthDate, args.birthTime, city.tz);
    const sunSidereal = norm360(sunLongitude(jd) - AYANAMSA);
    const ascSidereal = norm360(ascendant(jd, city.lat, city.lon) - AYANAMSA);

    const lagna = signIndex(ascSidereal) + 1;
    const sun = signIndex(sunSidereal) + 1;

    const houses = {};
    for (let h = 1; h <= 12; h += 1) {
      houses[h] = ((lagna - 1 + h - 1) % 12) + 1;
    }

    return {
      chartType: "Simplified D1 (whole-sign houses)",
      lagna: {
        sign: SIGNS[lagna - 1],
        degree: Math.round((ascSidereal % 30) * 10) / 10,
      },
      sun: {
        sign: SIGNS[sun - 1],
        degree: Math.round((sunSidereal % 30) * 10) / 10,
        house: houseOf(sun, lagna),
      },
      houses,
      place: `${city.name} (lat ${city.lat}, lon ${city.lon}, UTC+${city.tz})`,
      note: "Only Ascendant (Lagna) and Sun are computed. Moon and other planets are not included.",
    };
  } catch (err) {
    return { error: err.message };
  }
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "calculate_d1_chart",
      description:
        "Calculate a simplified Vedic D1 (Lagna/Rashi) chart from birth details. Returns Lagna sign, Sun sign and 12 whole-sign houses. No network access.",
      parameters: {
        type: "object",
        properties: {
          birthDate: {
            type: "string",
            description: "Date of birth in YYYY-MM-DD format",
          },
          birthTime: {
            type: "string",
            description: "Time of birth in 24-hour HH:MM format",
          },
          place: {
            type: "string",
            description: "City name, e.g. Delhi, Mumbai, Kolkata",
          },
        },
        required: ["birthDate", "birthTime", "place"],
      },
    },
  },
];

const callTimestamps = [];

async function waitForRateSlot() {
  while (true) {
    const now = Date.now();
    while (callTimestamps.length && now - callTimestamps[0] >= RATE_WINDOW_MS) {
      callTimestamps.shift();
    }
    if (callTimestamps.length < RATE_LIMIT_PER_MIN) {
      callTimestamps.push(now);
      return;
    }
    const wait = RATE_WINDOW_MS - (now - callTimestamps[0]) + 200;
    log("RATE-LIMIT", `reached (${callTimestamps.length}/${RATE_LIMIT_PER_MIN} per min), waiting ${Math.ceil(wait / 1000)}s`);
    await sleep(wait);
  }
}

function errorStatus(err) {
  return err?.statusCode ?? err?.status ?? err?.response?.status ?? 0;
}

function retryAfterMs(err, attempt) {
  const headers = err?.headers;
  if (headers) {
    const get = typeof headers.get === "function" ? headers.get.bind(headers) : (k) => headers[k] ?? headers[k.toLowerCase()];
    const raw = get("retry-after") ?? get("x-ratelimit-reset");
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n)) {
        // x-ratelimit-reset can be a unix timestamp in seconds
        if (String(raw).length >= 10 && n > 1_000_000_000) {
          return Math.max(0, n * 1000 - Date.now());
        }
        return n * 1000;
      }
    }
  }
  return Math.min(60_000, 2000 * 2 ** (attempt - 1));
}

async function callModel(messages) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    await waitForRateSlot();
    try {
      log("MODEL", `request (turn ${messages.filter((m) => m.role === "user").length}, messages=${messages.length})`);
      return await getClient().chat.send({
        chatRequest: {
          model: DEFAULT_MODEL,
          messages,
          tools: TOOLS,
          stream: false,
        },
      });
    } catch (err) {
      const status = errorStatus(err);
      if (status === 429 || /rate limit/i.test(err?.message || "")) {
        const wait = retryAfterMs(err, attempt);
        log("RATE-LIMIT", `429 hit, retrying in ${Math.ceil(wait / 1000)}s (attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Model call failed after retries due to rate limiting.");
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  return "";
}

async function executeTool(name, argsJson) {
  let args;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return { error: `Invalid JSON arguments: ${argsJson}` };
  }

  if (name === "calculate_d1_chart") {
    return calculateD1Chart(args);
  }
  return { error: `Unknown tool: ${name}` };
}

async function runAgent(initialQuestion) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];

  try {
    let question = initialQuestion;
    if (!question) {
      question = await rl.question("Aapka sawal kya hai? ");
    }
    if (!question?.trim()) return;
    messages.push({ role: "user", content: question.trim() });

    while (true) {
      const completion = await callModel(messages);
      const message = completion.choices?.[0]?.message;
      const toolCalls = message?.toolCalls;

      if (toolCalls?.length) {
        log("TOOL-CALL", `${toolCalls.length} call(s) requested`);
        messages.push({
          role: "assistant",
          ...(message.content ? { content: extractText(message.content) } : {}),
          toolCalls,
        });

        for (const call of toolCalls) {
          log("TOOL", `${call.function.name}(${call.function.arguments})`);
          const result = await executeTool(call.function.name, call.function.arguments);
          log("TOOL-RESULT", JSON.stringify(result).slice(0, 400));
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: JSON.stringify(result),
          });
        }
        continue;
      }

      const text = extractText(message?.content);
      if (text) {
        console.log(`\nAstro-bot: ${text}\n`);
        messages.push({ role: "assistant", content: text });
      }

      const next = await rl.question("> ");
      if (/^(exit|quit|bye|band)$/i.test(next.trim())) break;
      messages.push({ role: "user", content: next.trim() });
    }
  } finally {
    rl.close();
  }
}

export async function run(initialQuestion) {
  try {
    await runAgent(initialQuestion);
  } catch (err) {
    const status = errorStatus(err);
    log("ERROR", status ? `HTTP ${status}: ${err?.message || "failed"}` : err?.message || String(err));
    console.log("\nFlow stopped cleanly. Reason: " + (err?.message || "unknown error") + "\n");
  }
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  console.log("Agentic D1 chart test (tool calling).");
  console.log(`Model: ${DEFAULT_MODEL} | Rate limit: ${RATE_LIMIT_PER_MIN}/min | Type "exit" to stop.\n`);
  run();
}
