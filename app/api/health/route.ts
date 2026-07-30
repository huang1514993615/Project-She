export async function GET() {
  const imageModel = process.env.IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  const imageApiKey = imageModel === "gpt-image-2"
    ? process.env.GPT_IMAGE_API_KEY
    : process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY;
  const grokApiKey = process.env.GROK_API_KEY;
  return Response.json({
    chat: process.env.DEEPSEEK_API_KEY ? "configured" : "demo",
    deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    grok: grokApiKey ? "configured" : "disabled",
    grokModel: process.env.GROK_MODEL || "gpt-5.6-luna",
    image: imageApiKey ? "configured" : "disabled",
    imageModel,
  });
}
