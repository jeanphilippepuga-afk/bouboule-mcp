const http = require('http');
const WebSocket = require('ws');
const { TuyaContext } = require('@tuya/tuya-connector-nodejs');

// Mini serveur HTTP pour maintenir Render actif
const port = process.env.PORT || 10000;
http.createServer((req, res) => res.end('OK')).listen(port);

// Connexion API Tuya Cloud (Serveur Europe)
const tuya = new TuyaContext({
  baseUrl: 'https://openapi.tuyaeu.com',
  accessKey: process.env.TUYA_CLIENT_ID,
  secretKey: process.env.TUYA_SECRET,
});

// Table des appareils avec ton ID virtuel pour le ventilateur du salon
const DEVICE_IDS = {
  'Télé': 'ID_TELE',
  'Ampli': 'ID_AMPLI',
  'Ruban': 'ID_RUBAN',
  'Ventilateur salon': 'bf09710e9bb5de233dfltn',
  'Ventilateur chambre': 'ID_VENTILATEUR_CHAMBRE',
  'Spot cuisine': 'ID_SPOT_CUISINE',
  'Spot couloir': 'ID_SPOT_COULOIR'
};

const url = process.env.XIAOZHI_MCP_URL;

function connect() {
  if (!url) {
    console.error("Variable XIAOZHI_MCP_URL manquante !");
    return;
  }

  const ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('Connecté en continu au serveur MCP Xiaozhi !');
  });

  ws.on('message', async (data) => {
    console.log('Message reçu de Xiaozhi :', data.toString());

    try {
      const msg = JSON.parse(data.toString());

      // Initialisation du protocole MCP
      if (msg.method === 'initialize') {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'bouboule-mcp-bridge', version: '1.0.0' }
          }
        }));
      } 
      // Validation de l'initialisation
      else if (msg.method === 'notifications/initialized') {
        // Handshake OK
      }
      // Pings de maintien
      else if (msg.method === 'ping') {
        if (msg.id !== undefined) {
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {}
          }));
        }
      }
      // Liste des outils
      else if (msg.method === 'tools/list') {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            tools: [{
              name: 'control_tuya_device',
              description: 'Pilote les équipements domotiques de l\'appartement',
              inputSchema: {
                type: 'object',
                properties: {
                  device_name: {
                    type: 'string',
                    enum: Object.keys(DEVICE_IDS)
                  },
                  state: { type: 'string', enum: ['on', 'off'] }
                },
                required: ['device_name', 'state']
              }
            }]
          }
        }));
      } 
      // Appel de l'outil domotique
      else if (msg.method === 'tools/call' && msg.params?.name === 'control_tuya_device') {
        const { device_name, state } = msg.params.arguments;
        const deviceId = DEVICE_IDS[device_name];

        console.log(`Ordre reçu : ${device_name} -> ${state} (ID: ${deviceId})`);

        let resultText = '';

        if (!deviceId || deviceId.startsWith('ID_')) {
          resultText = `Erreur : l'ID Tuya pour ${device_name} n'est pas configuré.`;
        } else {
          try {
            const response = await tuya.request({
              path: `/v1.0/devices/${deviceId}/commands`,
              method: 'POST',
              body: {
                commands: [
                  { code: 'switch_1', value: state === 'on' }
                ]
              }
            });

            console.log('Réponse Tuya :', JSON.stringify(response));

            if (response && response.success) {
              resultText = `C'est fait, le ${device_name} est ${state === 'on' ? 'allumé' : 'éteint'}.`;
            } else {
              console.error('Échec Tuya API :', response);
              resultText = `Impossible d'actionner le ${device_name}.`;
            }
          } catch (tuyaErr) {
            console.error('Erreur Tuya catch :', tuyaErr);
            resultText = `Erreur lors de la commande du ${device_name}.`;
          }
        }

        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{ type: 'text', text: resultText }]
          }
        }));
      }
    } catch (e) {
      console.error('Erreur parsing JSON :', e);
    }
  });

  ws.on('close', () => {
    console.log('Connexion perdue. Reconnexion dans 5 secondes...');
    setTimeout(connect, 5000);
  });

  ws.on('error', (err) => {
    console.error('Erreur WebSocket :', err.message);
  });
}

connect();
