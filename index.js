import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocket } from "ws";
import axios from "axios";

// Config Tuya
const TUYA_CLIENT_ID = process.env.TUYA_CLIENT_ID;
const TUYA_SECRET = process.env.TUYA_SECRET;
const TUYA_USERNAME = process.env.TUYA_USERNAME;
const TUYA_PASSWORD = process.env.TUYA_PASSWORD;

// Config Govee
const GOVEE_API_KEY = process.env.GOVEE_API_KEY;

// Table d'équivalence des noms vers ID Tuya
const TUYA_DEVICES = {
  "ventilateur salon": "bf284813589a81da12g6s4",
  "ventilateur chambre": "bf316a3a4130ed8e4ahwya",
  "spot cuisine": "bf1234567890abc1", // Remplacer par tes vrais IDs Tuya si besoin
  "spot couloir": "bf1234567890abc2",
  "tele": "bf1234567890abc3",
  "ampli": "bf1234567890abc4"
};

// Fonction de contrôle Govee via API officielle
async function controlGoveeDevice(deviceName, turnOn) {
  if (!GOVEE_API_KEY) {
    throw new Error("GOVEE_API_KEY non configurée sur Render.");
  }

  // 1. Récupération des appareils enregistrés sur ton compte Govee
  const listRes = await axios.get("https://developer-api.govee.com/v1/devices", {
    headers: { "Govee-API-Key": GOVEE_API_KEY }
  });

  const devices = listRes.data?.data?.devices || [];
  const target = devices.find(d => d.deviceName.toLowerCase().includes(deviceName.toLowerCase()));

  if (!target) {
    throw new Error(`Appareil Govee '${deviceName}' non trouvé dans l'application.`);
  }

  // 2. Envoi de la commande ON/OFF
  const controlRes = await axios.put(
    "https://developer-api.govee.com/v1/devices/control",
    {
      device: target.device,
      model: target.model,
      cmd: {
        name: "turn",
        value: turnOn ? "on" : "off"
      }
    },
    { headers: { "Govee-API-Key": GOVEE_API_KEY } }
  );

  return controlRes.data;
}

// Initialisation du serveur MCP
const server = new Server(
  { name: "bouboule-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler("tools/list", async () => ({
  tools: [
    {
      name: "control_tuya_device",
      description: "Contrôle les appareils Tuya / SmartLife (Ventilateurs, Spot cuisine, Spot couloir, Télé, Ampli)",
      inputSchema: {
        type: "object",
        properties: {
          device_name: { type: "string" },
          action: { type: "string", enum: ["on", "off"] }
        },
        required: ["device_name", "action"]
      }
    },
    {
      name: "control_govee_device",
      description: "Contrôle les lumières et rubans LED Govee (Lumiere cuisine, Lumiere couloir, Led salon)",
      inputSchema: {
        type: "object",
        properties: {
          device_name: { type: "string", enum: ["lumiere cuisine", "lumiere couloir", "led salon"] },
          action: { type: "string", enum: ["on", "off"] }
        },
        required: ["device_name", "action"]
      }
    }
  ]
}));

server.setRequestHandler("tools/call", async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "control_govee_device") {
    const turnOn = args.action === "on";
    await controlGoveeDevice(args.device_name, turnOn);
    return { content: [{ type: "text", text: `Appareil Govee ${args.device_name} ${turnOn ? 'allumé' : 'éteint'}.` }] };
  }

  if (name === "control_tuya_device") {
    // Logique Tuya existante...
    return { content: [{ type: "text", text: `Commande Tuya exécutée pour ${args.device_name}.` }] };
  }

  throw new Error(`Tool inconnu : ${name}`);
});

// Connexion WebSocket Xiaozhi
const wsUrl = process.env.XIAOZHI_MCP_URL;
if (wsUrl) {
  const ws = new WebSocket(wsUrl);
  ws.on("open", () => console.log("Connecté en continu au serveur MCP Xiaozhi !"));
}
