import crypto from "node:crypto";

// Netlify serverless function: API kalit faqat shu yerda (serverda) turadi.
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const LEVELS = {
  1: "Mehribon ustoz. Maqtaydi, xatoni muloyim va rag'batlantirib aytadi.",
  2: "Hazilkash ustoz. Yengil kinoya va hazil, lekin hurmat bilan.",
  3: "Qattiqqo'l ustoz. Quruq, talabchan, chaqib gapiradi. Yengil so'kinish yo'q.",
  4: "Jahldor ustoz. Baqiradi, 'tentak', 'miyang bormi?', 'uyat!' kabi qo'pol iboralar ishlatadi.",
  5: "Roast ustasi. Juda qo'pol, 18+ ohang, so'kinish so'zlari (ahmoq, jinni, 'nima bu axlat?') ishlatadi, ayovsiz kuladi.",
  6: "Jahannam ustoz. Eng og'ir, qora hazil va qattiq so'kinishlar, ayovsiz roast. Sahnadagi shafqatsiz komediyachi kabi.",
};

const MODES = {
  writing: "Foydalanuvchi IELTS Writing matni yuboradi. Taxminiy band ball (0-9) ber, eng muhim 3-5 xatoni ko'rsat va to'g'ri variantini yoz.",
  speaking: "Foydalanuvchi IELTS Speaking javobini matn qilib yozadi. Fluency, vocabulary, grammar bo'yicha baho ber, xatolarini tuzat va yaxshiroq javob namunasini ber.",
  vocab: "Foydalanuvchi lug'at yoki grammatika savoli beradi yoki mashq so'raydi. Savol ber, javobini tekshir, 3 ta yangi IELTS so'zi o'rgat.",
};

function systemPrompt(level, mode) {
  return `Sen IELTS ingliz tili ustozisan. Foydalanuvchi o'zbek tilida gaplashadi, shuning uchun tushuntirishlarni o'zbekcha yoz, inglizcha misollarni inglizcha qoldir.

XARAKTER (${level}/6): ${LEVELS[level]}
REJIM: ${MODES[mode]}

QOIDALAR:
1. Haqorat va kinoya FAQAT foydalanuvchining xatolari, dangasaligi va ingliz tili haqida bo'lsin.
2. HECH QACHON millat, irq, din, jins, jinsiy yo'nalish, oila, tashqi ko'rinish, nogironlik haqida haqorat qilma. Jinsiy kontent yozma.
3. Har javob oxirida "✅ To'g'ri variant:" bo'limi bo'lsin: xatolar aniq tuzatilgan holda. Roast o'qitishdan muhimroq emas.
4. Foydalanuvchi o'zini o'ldirish yoki o'ziga zarar haqida yozsa, xarakterdan chiq, mehribon bo'l va yordam so'rashni maslahat ber.
5. Javob 250 so'zdan oshmasin. Rol haqida izoh berma, shunchaki rolda gapir.`;
}

// Telegram imzosini tekshiradi (faqat BOT_TOKEN qo'yilgan bo'lsa ishlaydi)
function checkTelegram(initData, botToken) {
  if (!initData) return false;
  const p = new URLSearchParams(initData);
  const hash = p.get("hash");
  p.delete("hash");
  const str = [...p.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => k + "=" + v)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secret).update(str).digest("hex");
  const age = Date.now() / 1000 - Number(p.get("auth_date"));
  return calc === hash && age < 86400;
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: "Serverda GEMINI_API_KEY topilmadi." }, { status: 500 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Noto'g'ri so'rov." }, { status: 400 }); }

  if (process.env.BOT_TOKEN && !checkTelegram(body.initData, process.env.BOT_TOKEN))
    return Response.json({ error: "Faqat Telegram bot orqali ishlaydi." }, { status: 401 });

  const level = Math.min(6, Math.max(1, parseInt(body.level) || 3));
  const mode = MODES[body.mode] ? body.mode : "writing";
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

  const contents = history
    .filter((m) => m && typeof m.text === "string" && (m.role === "user" || m.role === "model"))
    .map((m) => ({ role: m.role, parts: [{ text: m.text.slice(0, 3000) }] }));

  if (!contents.length || contents[contents.length - 1].role !== "user")
    return Response.json({ error: "Xabar bo'sh." }, { status: 400 });

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt(level, mode) }] },
          contents,
          generationConfig: { temperature: 0.4 + level * 0.1, maxOutputTokens: 1200 },
        }),
      }
    );
    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ;
    if (!text) {
      const why = data?.error?.message || data?.promptFeedback?.blockReason || "AI javob bermadi.";
      return Response.json({ error: `AI xatosi: ${why}. Darajani pasaytirib ko'r.` }, { status: 502 });
    }
    return Response.json({ reply: text });
  } catch {
    return Response.json({ error: "AI bilan ulanishda xato." }, { status: 502 });
  }
};
