import { createApp } from "./app.js";

const PORT = Number(process.env.PORT) || 3001;

const trustProxy = Number(process.env.TRUST_PROXY ?? 1);

const app = createApp({
  token: process.env.GARDENER_TOKEN,
  trustProxy: Number.isInteger(trustProxy) && trustProxy >= 0 ? trustProxy : 1,
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(","),
});

app.listen(PORT, () => {
  console.log(`Gardener backend listening on port ${PORT}`);
});
