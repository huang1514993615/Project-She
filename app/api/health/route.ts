export async function GET() {
  return Response.json({
    chat: process.env.DEEPSEEK_API_KEY ? "configured" : "demo",
    image: process.env.IMAGE_API_KEY ? "configured" : "demo",
  });
}
