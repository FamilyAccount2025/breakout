// This is a Node.js function that will run on Vercel's servers.
module.exports = async (request, response) => {
  // 1. Get the user's message from the incoming request.
  const { message, context } = await request.json();

  // 2. Get the secret API key from Vercel's environment variables.
  const apiKey = process.env.GEMINI_API_KEY;
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

  // 3. Prepare the payload to send to the Google AI API.
  let chatHistory = [{ role: "user", parts: [{ text: context + "\n\nUser Question: " + message }] }];
  const payload = { contents: chatHistory };

  try {
    // 4. Securely call the Google AI API from the server.
    const fetchResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!fetchResponse.ok) {
      const errorBody = await fetchResponse.text();
      console.error("API Error Body:", errorBody);
      throw new Error(`API request failed with status ${fetchResponse.status}`);
    }

    const result = await fetchResponse.json();
    const aiText = result.candidates[0].content.parts[0].text;

    // 5. Send the AI's response back to the user's browser.
    response.status(200).json({ reply: aiText });

  } catch (error) {
    console.error("Server-side AI Error:", error);
    response.status(500).json({ error: "Failed to get response from AI." });
  }
};
