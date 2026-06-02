require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const QRCode = require("qrcode");

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;
const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || "").replace(/\/$/, "");
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || "";
const BLAST_DELAY_MS = Number(process.env.BLAST_DELAY_MS || 3500);

function headers() {
  return {
    "Content-Type": "application/json",
    "apikey": EVOLUTION_API_KEY
  };
}

function cleanNumber(number) {
  let n = String(number || "").replace(/\D/g, "");
  if (!n.startsWith("55")) n = "55" + n;
  return n;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    app: "Dellapiani CRM Backend",
    evolutionConfigured: Boolean(EVOLUTION_API_URL && EVOLUTION_API_KEY)
  });
});

app.post("/instance/create", async (req, res) => {
  try {
    const { instanceName } = req.body;
    if (!instanceName) return res.status(400).json({ success: false, message: "instanceName obrigatório" });

    const payload = {
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS"
    };

    const response = await axios.post(`${EVOLUTION_API_URL}/instance/create`, payload, { headers: headers() });
    res.json({ success: true, message: "Instância criada", data: response.data });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao criar instância",
      error: error.response?.data || error.message
    });
  }
});

app.get("/instance/qrcode/:instanceName", async (req, res) => {
  try {
    const { instanceName } = req.params;

    let response;
    try {
      response = await axios.get(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, { headers: headers() });
    } catch (e) {
      response = await axios.get(`${EVOLUTION_API_URL}/instance/qrcode/${instanceName}`, { headers: headers() });
    }

    const data = response.data;
    let qrText =
      data?.base64 ||
      data?.qrcode?.base64 ||
      data?.qrcode ||
      data?.code ||
      data?.pairingCode ||
      null;

    if (!qrText) {
      return res.json({
        success: false,
        message: "QR Code não encontrado no retorno da Evolution API",
        data
      });
    }

    let qrcode;
    if (String(qrText).startsWith("data:image")) {
      qrcode = qrText;
    } else {
      qrcode = await QRCode.toDataURL(String(qrText));
    }

    res.json({ success: true, qrcode, raw: data });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao gerar QR Code",
      error: error.response?.data || error.message
    });
  }
});

app.get("/instance/status/:instanceName", async (req, res) => {
  try {
    const { instanceName } = req.params;
    const response = await axios.get(`${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`, { headers: headers() });
    res.json({ success: true, data: response.data });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao consultar status",
      error: error.response?.data || error.message
    });
  }
});

app.post("/message/send", async (req, res) => {
  try {
    const { instanceName, number, message } = req.body;

    if (!instanceName || !number || !message) {
      return res.status(400).json({ success: false, message: "instanceName, number e message são obrigatórios" });
    }

    const payload = {
      number: cleanNumber(number),
      text: message
    };

    const response = await axios.post(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, payload, { headers: headers() });

    res.json({
      success: true,
      message: "Mensagem enviada",
      data: response.data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao enviar mensagem",
      error: error.response?.data || error.message
    });
  }
});

app.post("/blast/send", async (req, res) => {
  const results = [];

  try {
    const { instanceName, list, message, title, audience } = req.body;

    if (!instanceName || !Array.isArray(list) || !message) {
      return res.status(400).json({ success: false, message: "instanceName, list e message são obrigatórios" });
    }

    for (const client of list) {
      const finalMessage = String(message).replaceAll("{nome}", client.nome || "cliente");

      try {
        const payload = {
          number: cleanNumber(client.telefone),
          text: finalMessage
        };

        const response = await axios.post(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, payload, { headers: headers() });

        results.push({
          client: client.nome,
          number: client.telefone,
          success: true,
          data: response.data
        });
      } catch (error) {
        results.push({
          client: client.nome,
          number: client.telefone,
          success: false,
          error: error.response?.data || error.message
        });
      }

      await sleep(BLAST_DELAY_MS);
    }

    res.json({
      success: true,
      title,
      audience,
      total: list.length,
      sent: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro geral no disparo",
      error: error.message,
      results
    });
  }
});

app.listen(PORT, () => {
  console.log(`Dellapiani CRM backend rodando na porta ${PORT}`);
});
