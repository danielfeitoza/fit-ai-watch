require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "0.0.0.0";

if (!process.env.DATABASE_URL) {
  throw new Error("Defina DATABASE_URL no arquivo .env");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/customers", async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, status FROM customers ORDER BY id ASC"
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      error: "Erro ao buscar customers",
      detail: error.message,
    });
  }
});

app.put("/customers/status", async (req, res) => {
  const items = req.body?.customers;

  if (!Array.isArray(items)) {
    return res.status(400).json({ error: "Body inválido. Use { customers: [{id, status}] }" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const item of items) {
      if (typeof item?.id !== "number" || typeof item?.status !== "boolean") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Item inválido. Esperado {id:number, status:boolean}" });
      }

      await client.query("UPDATE customers SET status = $1 WHERE id = $2", [
        item.status,
        item.id,
      ]);
    }

    await client.query("COMMIT");
    return res.json({ ok: true, updated: items.length });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(500).json({
      error: "Erro ao salvar status dos customers",
      detail: error.message,
    });
  } finally {
    client.release();
  }
});

app.listen(port, host, () => {
  console.log(`Backend rodando em http://${host}:${port}`);
});
