import { createApp } from "./app.js";

const PORT = Number(process.env.PORT) || 3001;

const app = createApp({
  token: process.env.GARDENER_TOKEN,
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(","),
});

app.listen(PORT, () => {
  console.log(`Gardener backend listening on port ${PORT}`);
});
