/**
 * Alexa Skill Lambda — Inventar
 * 
 * Handles:
 *  - AddItemIntent: adds an item to the shopping list
 *  - AddMultipleItemsIntent: adds multiple items at once
 *  - ListItemsIntent: reads back the current shopping list
 * 
 * Environment variables (set in Lambda console):
 *  - API_BASE_URL: your server URL, e.g. https://inventory.example.com
 *  - API_KEY: the EXTERNAL_API_KEY from your backend .env
 */

const Alexa = require('ask-sdk-core');
const https = require('https');
const http = require('http');

// --- HTTP helper ---
function apiRequest(method, path, body) {
  const baseUrl = process.env.API_BASE_URL;
  const apiKey = process.env.API_KEY;

  if (!baseUrl || !apiKey) {
    return Promise.reject(new Error('API_BASE_URL or API_KEY not configured'));
  }

  const url = new URL(path, baseUrl);
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;

  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'User-Agent': 'Alexa-Inventar/1.0',
      'X-Device-Name': 'Alexa',
    },
  };

  const payload = body ? JSON.stringify(body) : null;
  if (payload) {
    options.headers['Content-Length'] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

// --- Intent Handlers ---

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak('Inventar ist bereit. Was soll ich auf die Liste setzen?')
      .reprompt('Sag zum Beispiel: Füge Milch hinzu.')
      .getResponse();
  },
};

const AddItemIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AddItemIntent';
  },
  async handle(handlerInput) {
    const slots = handlerInput.requestEnvelope.request.intent.slots;
    const itemName = slots.item?.value;
    const quantity = parseInt(slots.quantity?.value, 10) || 1;

    if (!itemName) {
      return handlerInput.responseBuilder
        .speak('Was soll ich auf die Liste setzen?')
        .reprompt('Sag zum Beispiel: Füge Milch hinzu.')
        .getResponse();
    }

    try {
      const res = await apiRequest('POST', '/api/external/shopping-list/add', {
        name: itemName,
        quantity,
      });

      if (res.status === 200 && res.data.success) {
        const qtyText = quantity > 1 ? `${quantity} mal ` : '';
        return handlerInput.responseBuilder
          .speak(`${qtyText}${itemName} wurde zur Liste hinzugefügt.`)
          .reprompt('Möchtest du noch etwas hinzufügen?')
          .getResponse();
      } else {
        return handlerInput.responseBuilder
          .speak(`Beim Hinzufügen von ${itemName} ist ein Fehler aufgetreten.`)
          .getResponse();
      }
    } catch (error) {
      console.error('API error:', error);
      return handlerInput.responseBuilder
        .speak('Die Verbindung zum Server ist fehlgeschlagen. Versuche es später erneut.')
        .getResponse();
    }
  },
};

// Parse multi-item text: "Milch, Brot und Eier" → ["Milch", "Brot", "Eier"]
function parseMultipleItems(text) {
  return text
    .split(/\s*(?:,|(?:\s+und\s+)|(?:\s+sowie\s+))\s*/i)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

const AddMultipleItemsIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AddMultipleItemsIntent';
  },
  async handle(handlerInput) {
    const slots = handlerInput.requestEnvelope.request.intent.slots;
    const rawText = slots.items?.value;

    if (!rawText) {
      return handlerInput.responseBuilder
        .speak('Was soll ich auf die Liste setzen?')
        .reprompt('Sag zum Beispiel: Milch, Brot und Eier.')
        .getResponse();
    }

    const items = parseMultipleItems(rawText);

    if (items.length === 0) {
      return handlerInput.responseBuilder
        .speak('Ich konnte keine Artikel erkennen. Versuche es erneut.')
        .reprompt('Sag zum Beispiel: Milch, Brot und Eier.')
        .getResponse();
    }

    // Single item → use the simple endpoint
    if (items.length === 1) {
      try {
        const res = await apiRequest('POST', '/api/external/shopping-list/add', {
          name: items[0],
        });
        if (res.status === 200 && res.data.success) {
          return handlerInput.responseBuilder
            .speak(`${items[0]} wurde zur Liste hinzugefügt.`)
            .reprompt('Möchtest du noch etwas hinzufügen?')
            .getResponse();
        }
      } catch (error) {
        console.error('API error:', error);
      }
      return handlerInput.responseBuilder
        .speak('Beim Hinzufügen ist ein Fehler aufgetreten.')
        .getResponse();
    }

    // Multiple items → use bulk endpoint
    try {
      const res = await apiRequest('POST', '/api/external/shopping-list/add-multiple', {
        items: items.map(name => ({ name })),
      });

      if (res.status === 200 && res.data.success) {
        const count = res.data.count;
        const names = items.join(', ');
        return handlerInput.responseBuilder
          .speak(`${count} Artikel wurden hinzugefügt: ${names}.`)
          .reprompt('Möchtest du noch etwas hinzufügen?')
          .getResponse();
      }
    } catch (error) {
      console.error('API error:', error);
    }

    return handlerInput.responseBuilder
      .speak('Beim Hinzufügen ist ein Fehler aufgetreten.')
      .getResponse();
  },
};

const ListItemsIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'ListItemsIntent';
  },
  async handle(handlerInput) {
    try {
      const res = await apiRequest('GET', '/api/external/shopping-list');

      if (res.status !== 200) {
        return handlerInput.responseBuilder
          .speak('Beim Laden der Liste ist ein Fehler aufgetreten.')
          .getResponse();
      }

      const { manual, auto, total } = res.data;

      if (total === 0) {
        return handlerInput.responseBuilder
          .speak('Die Liste ist leer. Alles auf Lager!')
          .getResponse();
      }

      const allItems = [];

      for (const item of manual) {
        allItems.push(item.quantity > 1 ? `${item.quantity} mal ${item.name}` : item.name);
      }

      for (const item of auto) {
        allItems.push(item.needed > 1 ? `${item.needed} mal ${item.name}` : item.name);
      }

      const maxItems = 15;
      let speech;
      if (allItems.length <= maxItems) {
        speech = `Auf der Liste stehen ${total} Einträge: ${allItems.join(', ')}.`;
      } else {
        speech = `Auf der Liste stehen ${total} Einträge. Die ersten ${maxItems}: ${allItems.slice(0, maxItems).join(', ')}. Und ${total - maxItems} weitere.`;
      }

      return handlerInput.responseBuilder
        .speak(speech)
        .getResponse();
    } catch (error) {
      console.error('API error:', error);
      return handlerInput.responseBuilder
        .speak('Die Verbindung zum Server ist fehlgeschlagen.')
        .getResponse();
    }
  },
};

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak('Du kannst sagen: Füge Milch hinzu, oder: Was steht auf der Liste?')
      .reprompt('Was möchtest du tun?')
      .getResponse();
  },
};

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
        || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak('Tschüss!')
      .getResponse();
  },
};

const FallbackIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent';
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak('Das habe ich nicht verstanden. Sag zum Beispiel: Füge Brot hinzu.')
      .reprompt('Was möchtest du hinzufügen?')
      .getResponse();
  },
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.getResponse();
  },
};

const ErrorHandler = {
  canHandle() { return true; },
  handle(handlerInput, error) {
    console.error('Error:', error);
    return handlerInput.responseBuilder
      .speak('Ein Fehler ist aufgetreten. Versuche es erneut.')
      .getResponse();
  },
};

// --- Skill Builder ---
exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    AddMultipleItemsIntentHandler,
    AddItemIntentHandler,
    ListItemsIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    FallbackIntentHandler,
    SessionEndedRequestHandler,
  )
  .addErrorHandlers(ErrorHandler)
  .lambda();
