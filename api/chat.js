// This is a Node.js function that will run on Vercel's servers.
// Re-engineered for maximum compatibility and robust logging.
module.exports = async (request, response) => {
  // Log that the function was invoked
  console.log("Function invoked. Request received.");

  // Check if the request method is POST
  if (request.method !== 'POST') {
    console.log("Request method was not POST.");
    return response.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // 1. Get the user's message from the incoming request.
    const { message, context } = request.body;
    console.log("Received message:", message);

    if (!message || !context) {
        console.error("Missing message or context in request body.");
        return response.status(400).json({ error: "Bad Request: Missing message or context." });
    }

    // 2. Get the secret API key from Vercel's environment variables.
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("GEMINI_API_KEY environment variable not found.");
        return response.status(500).json({ error: "Server configuration error." });
    }
    console.log("API Key found.");

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    // 3. Prepare the payload to send to the Google AI API.
    const chatHistory = [{ role: "user", parts: [{ text: context + "\n\nUser Question: " + message }] }];
    const payload = { contents: chatHistory };
    console.log("Sending payload to Google AI.");

    // 4. Securely call the Google AI API from the server.
    const fetchResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    console.log("Received response from Google AI with status:", fetchResponse.status);

    if (!fetchResponse.ok) {
      const errorBody = await fetchResponse.text();
      console.error("Google AI API Error Body:", errorBody);
      throw new Error(`API request failed with status ${fetchResponse.status}`);
    }

    const result = await fetchResponse.json();
    
    if (!result.candidates || result.candidates.length === 0) {
        console.error("Invalid response from Google AI:", result);
        throw new Error("No candidates in response from AI.");
    }

    const aiText = result.candidates[0].content.parts[0].text;
    console.log("Successfully extracted AI reply.");

    // 5. Send the AI's response back to the user's browser.
    return response.status(200).json({ reply: aiText });

  } catch (error) {
    console.error("Server-side AI Error:", error.message);
    return response.status(500).json({ error: "Failed to get response from AI." });
  }
};
