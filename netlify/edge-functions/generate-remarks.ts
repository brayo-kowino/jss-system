import { verifyFirebaseIdToken, jsonResponse } from "./lib/firestore-rest.ts";

export default async function handler(req: Request) {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const token = authHeader.split("Bearer ")[1];
    
    // Verify user is authenticated
    const uid = await verifyFirebaseIdToken(token);
    if (!uid) {
      return jsonResponse({ error: "Invalid token" }, 401);
    }

    const { studentName, meanGrade, average, subjects } = await req.json();

    if (!studentName || !subjects || !Array.isArray(subjects)) {
      return jsonResponse({ error: "Invalid payload" }, 400);
    }

    // Build prompt for AI
    const prompt = `You are a professional class teacher. Write a 1-2 sentence report card remark for the student named ${studentName}. 
Their overall mean grade is ${meanGrade} (${average}%).
Here is their subject performance:
${subjects.map((s: any) => `- ${s.name}: ${s.grade} (${s.average}%)`).join('\n')}

Instructions:
1. Write a 'Teacher Remark' (encouraging, highlights strengths, gently notes areas for improvement).
2. Write a 'Principal Remark' (slightly more formal, congratulatory or constructive).
Return EXACTLY a JSON object with two keys: "teacherRemark" and "principalRemark". Do not include markdown formatting or any other text.`;

    const apiKey = Deno.env.get("MISTRAL_API_KEY");
    if (!apiKey) {
      throw new Error("MISTRAL_API_KEY not configured on server.");
    }

    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "mistral-small-latest", // Lightweight Mistral model
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.7
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Mistral API Error:", errText);
      throw new Error("Failed to generate remarks from AI provider.");
    }

    const data = await res.json();
    const textOutput = data.choices?.[0]?.message?.content;
    if (!textOutput) throw new Error("Empty response from AI.");

    const parsed = JSON.parse(textOutput);

    return jsonResponse(parsed, 200);

  } catch (err: any) {
    console.error("Generate remarks error:", err);
    return jsonResponse({ error: err.message || "Internal server error" }, 500);
  }
}

export const config = {
  path: "/generate-remarks",
};
