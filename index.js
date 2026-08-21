const http = require('http');
const crypto = require('crypto');
const axios = require('axios');
const WebSocket = require('ws');

// Mini serveur HTTP pour maintenir Render actif
const port = process.env.PORT || 10000;
http.createServer((req, res) => res.end('OK')).listen(port);

// Nettoyage des variables
const CLIENT_ID = (process.env.TUYA_CLIENT_ID || '').trim().replace(/['"]/g, '');
const SECRET = (process.env.TUYA_SECRET || '').trim().replace(/['"]/g, '');
const XIAOZHI_URL = (process.env.XIAOZHI_MCP_URL || '').trim();

// Table des appareils
const DEVICE_IDS = {
  'Ventilateur salon': 'bf09710e9bb5de233dfltn',
  'Neon salon': 'bfe70cfada2d079843d2sm',
  'Ruban': 'bfe70cfada2d079843d2sm',
  'Hi-fi': 'bff13ef303c235bff5ctrs',
  'Ventilateur chambre': 'bf6cedea4ebc7d8f5eh9di'
};

// Signature Tuya officielle v2.0
function calcSign(clientId, secret, timestamp, accessToken = '', method = 'GET', url = '/v1.0/token?grant_type=1', body = '') {
  const contentHash = crypto.createHash('sha256').update(body).digest('hex');
  const stringToSign = [method, contentHash, '', url].join('\n');
  const str = clientId + accessToken + timestamp + stringToSign;
  return crypto.createHmac('sha256', secret).update(str).digest('hex').toUpperCase();
}

async function getTuyaToken(baseUrl) {
  const timestamp = Date.now().toString();
  const path = '/v1.0/token?grant_type=1';
  const sign = calcSign(CLIENT_ID, SECRET, timestamp, '', 'GET', path, '');

  const res = await axios.get(`${baseUrl}${path}`, {
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
  throw new Error(`Token Tuya (${res.data.code}): ${res.data.msg}`);
}

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
        const path = `/v1.0/devices/${deviceId}/commands`;
        const bodyObj = { commands: [{ code: code, value: isTurnOn }] };
        const bodyStr = JSON.stringify(bodyObj);

        const sign = calcSign(CLIENT_ID, SECRET, timestamp, token, 'POST', path, bodyStr);

        const cmdRes = await axios.post(`${baseUrl}${path}`, bodyObj, {
          headers: {
            'client_id': CLIENT_ID,
            'access_token': token,
            'sign': sign,
            't': timestamp,
            'sign_method': 'HMAC-SHA256',
            'Content-Type': 'application/json'
          }
        });

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
