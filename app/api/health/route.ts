export async function GET() {
  return Response.json({
    chat: process.env.DEEPSEEK_API_KEY ? "configured" : "demo",
    image: "disabled",
  });
}
