const http = require('http');
const crypto = require('crypto');
const axios = require('axios');
const WebSocket = require('ws');

// Mini serveur HTTP pour maintenir Render actif
const port = process.env.PORT || 10000;
http.createServer((req, res) => res.end('OK')).listen(port);

// Nettoyage strict des variables d'environnement
const CLIENT_ID = (process.env.TUYA_CLIENT_ID || '').trim().replace(/['"]/g, '');
const SECRET = (process.env.TUYA_SECRET || '').trim().replace(/['"]/g, '');
const XIAOZHI_URL = (process.env.XIAOZHI_MCP_URL || '').trim();

// Table des appareils actuellement EN LIGNE
const DEVICE_IDS = {
  'Ventilateur salon': 'bf09710e9bb5de233dfltn',
  'Neon salon': 'bfe70cfada2d079843d2sm',
  'Ruban': 'bfe70cfada2d079843d2sm',
  'Hi-fi': 'bff13ef303c235bff5ctrs',
  'Ventilateur chambre': 'bf6cedea4ebc7d8f5eh9di'
};

// Génération de signature Tuya v1.0
function calcSign(clientId, secret, timestamp, accessToken = '', nonce = '') {
  const str = clientId + accessToken + timestamp + nonce;
  return crypto.createHmac('sha256', secret).update(str).digest('hex').toUpperCase();
}

// Fonction pour récupérer un Access Token
async function getTuyaToken(baseUrl) {
  const timestamp = Date.now().toString();
  const sign = calcSign(CLIENT_ID, SECRET, timestamp);

  const res = await axios.get(`${baseUrl}/v1.0/token?grant_type=1`, {
    headers: {
      'client_id': CLIENT_ID,
      'sign': sign,
      't': timestamp,
      'sign_method': 'HMAC-SHA256'
    }
  });

  if (res.data && res.data.success) {
    return res.data.result.access_token;
  }
  throw new Error(`Erreur Token Tuya (${res.data.code}): ${res.data.msg}`);
}

// Envoi de commande à un appareil Tuya
async function sendTuyaCommand(deviceId, isTurnOn) {
  const endpoints = [
    'https://openapi.tuyaeu.com',
    'https://openapi.tuyacn.com'
  ];

  const possibleCodes = ['switch_led', 'switch', 'switch_1', 'light'];

  for (const baseUrl of endpoints) {
    try {
      console.log(`Tentative obtention Token sur ${baseUrl}...`);
      const token = await getTuyaToken(baseUrl);
      console.log(`Token obtenu avec succès !`);

      for (const code of possibleCodes) {
        const timestamp = Date.now().toString();
        const bodyStr = JSON.stringify({ commands: [{ code: code, value: isTurnOn }] });
        
        // Calculation de la signature pour la requête POST
        const contentHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
        const stringToSign = ['POST', contentHash, '', `/v1.0/devices/${deviceId}/commands`].join('\n');
        const signStr = CLIENT_ID + token + timestamp + stringToSign;
        const sign = crypto.createHmac('sha256', SECRET).update(signStr).digest('hex').toUpperCase();

        const cmdRes = await axios.post(`${baseUrl}/v1.0/devices/${deviceId}/commands`, 
          { commands: [{ code: code, value: isTurnOn }] },
          {
            headers: {
              'client_id': CLIENT_ID,
              'access_token': token,
              'sign': sign,
              't': timestamp,
              'sign_method': 'HMAC-SHA256',
              'Content-Type': 'application/json'
            }
          }
        );

        console.log(`Réponse Tuya (${code}) :`, cmdRes.data);
        if (cmdRes.data && cmdRes.data.success) {
          return true;
        }
      }
    } catch (err) {
      console.error(`Échec sur ${baseUrl} :`, err.response?.data || err.message);
    }
  }
  return false;
}

// Boucle principale WebSocket pour Xiaozhi MCP
function connect() {
  if (!XIAOZHI_URL) {
    console.error("Variable XIAOZHI_MCP_URL manquante !");
    return;
  }

  const ws = new WebSocket(XIAOZHI_URL);

  ws.on('open', () => {
    console.log('Connecté en continu au serveur MCP Xiaozhi !');
  });

  ws.on('message', async (data) => {
    console.log('Message reçu de Xiaozhi :', data.toString());

    try {
      const msg = JSON.parse(data.toString());

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
      else if (msg.method === 'ping' && msg.id !== undefined) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }));
      }
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
                  device_name: { type: 'string', description: 'Nom exact de l\'appareil' },
                  state: { type: 'string', enum: ['on', 'off'] }
                },
                required: ['device_name', 'state']
              }
            }]
          }
        }));
      } 
      else if (msg.method === 'tools/call' && msg.params?.name === 'control_tuya_device') {
        const { device_name, state } = msg.params.arguments;

        const matchedKey = Object.keys(DEVICE_IDS).find(
          k => k.toLowerCase() === device_name?.toLowerCase()
        ) || device_name;

        const deviceId = DEVICE_IDS[matchedKey];
        const isTurnOn = state === 'on';

        console.log(`Ordre exécuté : ${matchedKey} -> ${state} (ID: ${deviceId})`);

        let resultText = '';

        if (!deviceId) {
          resultText = `Erreur : l'appareil ${matchedKey} n'est pas reconnu.`;
        } else {
          const success = await sendTuyaCommand(deviceId, isTurnOn);
          if (success) {
            resultText = `C'est fait, le ${matchedKey} est ${isTurnOn ? 'allumé' : 'éteint'}.`;
          } else {
            resultText = `Impossible d'actionner le ${matchedKey}.`;
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
      console.error('Erreur traitement message :', e);
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
