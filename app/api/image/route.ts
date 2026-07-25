export async function POST() {
  return Response.json(
    { error: "Image generation is currently disabled." },
    { status: 410 },
  );
}
