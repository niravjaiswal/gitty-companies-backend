import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3001);
const app = createApp();

app.listen(port, () => {
  console.log(`Northstar Support Hub API listening on http://127.0.0.1:${port}`);
});
