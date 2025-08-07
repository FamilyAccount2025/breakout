// api/generate-questions.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { topic = 'mixed', difficulty = 'easy', count = 8 } = req.body || {};
  const prompt = `You are an expert in US employee benefits. Create ${count} multiple-choice quiz questions on the topic "${topic}" with difficulty "${difficulty}".
Return strict JSON: {"questions":[{"q":"...","choices":["A","B","C","D"],"answer":0-3,"explain":"..."}]}. Keep choices plausible and explanations concise.`;

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Return only JSON. No preface.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
      }),
    });

    if (!resp.ok) {
      const details = await resp.text();
      return res.status(500).json({ error: 'OpenAI error', details });
    }

    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content?.trim?.() || '{}';
    let payload;
    try { payload = JSON.parse(raw); } catch { payload = { questions: [] }; }

    if (!Array.isArray(payload.questions)) payload.questions = [];

    return res.status(200).json({ questions: payload.questions });
  } catch (e) {
    return res.status(200).json({ questions: [] }); // quiz falls back to local bank
  }
}
