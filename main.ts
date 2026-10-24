import express from "express";

const port = Number(process.env.PORT ?? 3000);
const app = express();

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "Server is running!" });
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

const server = app.listen(port, () => {
  const address = server.address();
  if (address && typeof address !== "string") {
    console.log(`Server listening on http://localhost:${address.port}`);
  }
});
