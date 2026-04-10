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

// --- APL helpers ---
function supportsAPL(handlerInput) {
  const interfaces = handlerInput.requestEnvelope.context?.System?.device?.supportedInterfaces;
  return !!interfaces?.['Alexa.Presentation.APL'];
}

// Build full APL document with items baked in — no data binding needed
function buildAPLDocument(manual, auto, total) {
  const itemComponents = [];

  if (manual.length > 0) {
    itemComponents.push({
      type: 'Text', text: '📝 Manuell hinzugefügt',
      fontSize: '20dp', fontWeight: 'bold', color: '#FF9800',
      paddingTop: '1vh', paddingBottom: '0.5vh'
    });
    for (const i of manual) {
      const icon = i.checked ? '☑ ' : '☐ ';
      const qty = (i.quantity || 1) > 1 ? `${i.quantity}× ` : '';
      itemComponents.push({
        type: 'Text', text: `${icon}${qty}${i.name}`,
        fontSize: '22dp', color: 'white',
        opacity: i.checked ? 0.4 : 1,
        paddingTop: '0.8vh', paddingBottom: '0.8vh'
      });
    }
  }

  if (auto.length > 0) {
    itemComponents.push({
      type: 'Text', text: '🔄 Nachkaufen (Bestand niedrig)',
      fontSize: '20dp', fontWeight: 'bold', color: '#2196F3',
      paddingTop: itemComponents.length > 0 ? '2vh' : '1vh', paddingBottom: '0.5vh'
    });
    for (const i of auto) {
      const qty = (i.needed || 1) > 1 ? `${i.needed}× ` : '';
      itemComponents.push({
        type: 'Text', text: `• ${qty}${i.name}`,
        fontSize: '22dp', color: 'white',
        paddingTop: '0.8vh', paddingBottom: '0.8vh'
      });
    }
  }

  if (itemComponents.length === 0) {
    itemComponents.push({
      type: 'Text', text: 'Die Einkaufsliste ist leer ✓',
      fontSize: '22dp', color: '#888', paddingTop: '4vh', textAlign: 'center'
    });
  }

  return {
    type: 'APL',
    version: '2024.1',
    import: [{ name: 'alexa-layouts', version: '1.7.0' }],
    mainTemplate: {
      items: [{
        type: 'Container',
        width: '100vw',
        height: '100vh',
        items: [
          {
            type: 'Text',
            text: `🛒 Einkaufsliste — ${total} Einträge`,
            fontSize: '24dp', fontWeight: 'bold',
            paddingLeft: '3vw', paddingTop: '2vh', paddingBottom: '1vh'
          },
          {
            type: 'ScrollView',
            width: '100vw',
            grow: 1,
            paddingLeft: '3vw',
            paddingRight: '3vw',
            paddingBottom: '2vh',
            item: {
              type: 'Container',
              items: itemComponents
            }
          }
        ]
      }]
    }
  };
}

async function addAPLShoppingList(responseBuilder, handlerInput) {
  if (!supportsAPL(handlerInput)) return;
  try {
    const res = await apiRequest('GET', '/api/external/shopping-list');
    if (res.status === 200) {
      const { manual, auto, total } = res.data;
      responseBuilder.addDirective({
        type: 'Alexa.Presentation.APL.RenderDocument',
        token: 'shoppingListToken',
        document: buildAPLDocument(manual, auto, total),
      });
    }
  } catch (e) {
    console.error('APL fetch error:', e);
  }
}

// --- Widget DataStore helpers ---
const MAX_WIDGET_ITEMS = 12;

function buildWidgetData(manual, auto, total) {
  const items = [];
  for (const i of manual) {
    const qty = (i.quantity || 1) > 1 ? `${i.quantity}x ` : '';
    items.push({ type: 'manual', id: String(i.id), name: qty + i.name, checked: i.checked ? 1 : 0 });
  }
  for (const i of auto) {
    const qty = (i.needed || 1) > 1 ? `${i.needed}x ` : '';
    items.push({ type: 'auto', id: i.identifier || '', name: qty + i.name, checked: 0 });
  }
  const moreCount = Math.max(0, items.length - MAX_WIDGET_ITEMS);
  const result = { total, lineCount: Math.min(items.length, MAX_WIDGET_ITEMS), moreCount };
  for (let idx = 0; idx < MAX_WIDGET_ITEMS; idx++) {
    if (idx < items.length) {
      result[`type${idx}`] = items[idx].type;
      result[`id${idx}`] = items[idx].id;
      result[`name${idx}`] = items[idx].name;
      result[`checked${idx}`] = items[idx].checked;
    } else {
      result[`type${idx}`] = '';
      result[`id${idx}`] = '';
      result[`name${idx}`] = '';
      result[`checked${idx}`] = 0;
    }
  }
  return result;
}

// Alexa Skill Messaging credentials (Build → Tools → Permissions)
const ALEXA_CLIENT_ID = '';
const ALEXA_CLIENT_SECRET = '';

function getDataStoreToken() {
  const postData = `grant_type=client_credentials&client_id=${encodeURIComponent(ALEXA_CLIENT_ID)}&client_secret=${encodeURIComponent(ALEXA_CLIENT_SECRET)}&scope=alexa::datastore`;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.amazon.com',
      port: 443,
      path: '/auth/o2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const parsed = JSON.parse(body);
          resolve(`${parsed.token_type} ${parsed.access_token}`);
        } else {
          console.error('DataStore token error:', res.statusCode, body);
          reject(new Error('Token request failed'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Token timeout')); });
    req.write(postData);
    req.end();
  });
}

async function pushWidgetData(handlerInput) {
  if (!ALEXA_CLIENT_ID || !ALEXA_CLIENT_SECRET) return;
  try {
    const userId = handlerInput.requestEnvelope.context?.System?.user?.userId;
    const apiEndpoint = handlerInput.requestEnvelope.context?.System?.apiEndpoint || 'https://api.eu.amazonalexa.com';
    if (!userId) return;

    // Register userId with backend so it can push widget updates independently
    apiRequest('POST', '/api/external/alexa-register', { userId, apiEndpoint }).catch(() => {});

    const listRes = await apiRequest('GET', '/api/external/shopping-list');
    if (listRes.status !== 200) return;

    const { manual, auto, total } = listRes.data;
    const widgetData = buildWidgetData(manual, auto, total);
    const authHeader = await getDataStoreToken();
    console.log('Widget data:', JSON.stringify(widgetData));

    const dsHost = new URL(apiEndpoint).hostname;
    console.log('DS target:', dsHost, 'userId:', userId.slice(-12));
    const payload = JSON.stringify({
      commands: [
        { type: 'PUT_OBJECT', namespace: 'SHOPPING_LIST', key: 'listData', content: widgetData },
      ],
      target: { type: 'USER', id: userId },
    });
    console.log('DS payload:', payload);

    await new Promise((resolve) => {
      const req = https.request({
        hostname: dsHost,
        port: 443,
        path: '/v1/datastore/commands',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          console.log('DS response:', res.statusCode, data);
          resolve();
        });
      });
      req.on('error', (e) => { console.error('DS request error:', e); resolve(); });
      req.setTimeout(5000, () => { req.destroy(); resolve(); });
      req.write(payload);
      req.end();
    });
  } catch (e) {
    console.error('Widget push error:', e);
  }
}

// --- HTTP helper ---
function apiRequest(method, path, body) {
  const baseUrl = "https://inventory.weidt.de";
  const apiKey = "73hBg367rgdhd47GBdusdb74bf8cx6db4p";

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

// Widget installed on home screen — push initial data
const WidgetInstalledHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.DataStore.PackageManager.UsagesInstalled';
  },
  async handle(handlerInput) {
    await pushWidgetData(handlerInput);
    return handlerInput.responseBuilder.getResponse();
  },
};

const WidgetRemovedHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.DataStore.PackageManager.UsagesRemoved';
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.getResponse();
  },
};

const WidgetUpdateHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.DataStore.PackageManager.UpdateRequest';
  },
  async handle(handlerInput) {
    await pushWidgetData(handlerInput);
    return handlerInput.responseBuilder.getResponse();
  },
};

const WidgetInstallationErrorHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.DataStore.PackageManager.InstallationError';
  },
  handle(handlerInput) {
    console.error('Widget installation error:', JSON.stringify(handlerInput.requestEnvelope.request));
    return handlerInput.responseBuilder.getResponse();
  },
};

// Handle touch events from the widget (e.g., checking off items)
const WidgetUserEventHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.Presentation.APL.UserEvent';
  },
  async handle(handlerInput) {
    const args = handlerInput.requestEnvelope.request.arguments || [];
    const action = args[0];
    const itemType = args[1];
    const itemId = args[2];

    console.log('Widget UserEvent:', JSON.stringify(args));

    if (action === 'checkItem' && itemId) {
      try {
        await apiRequest('POST', '/api/external/shopping-list/remove', { type: itemType, id: itemId });
      } catch (e) {
        console.error('Remove error:', e);
      }
    }

    // Push updated widget data after the action
    await pushWidgetData(handlerInput);
    return handlerInput.responseBuilder.getResponse();
  },
};

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  },
  async handle(handlerInput) {
    const rb = handlerInput.responseBuilder
      .speak('Inventar ist bereit. Was soll ich auf die Liste setzen?')
      .reprompt('Sag zum Beispiel: Füge Milch hinzu.');
    await addAPLShoppingList(rb, handlerInput);
    return rb.getResponse();
  },
};

const AddItemIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AddItemIntent';
  },
  async handle(handlerInput) {
    const slots = handlerInput.requestEnvelope.request.intent.slots;
    const itemName = cleanSlotText(slots.item?.value || '');
    const quantity = parseInt(slots.quantity?.value, 10) || 1;

    if (!itemName) {
      return handlerInput.responseBuilder
        .speak('Was soll ich auf die Liste setzen?')
        .reprompt('Sag zum Beispiel: Füge Milch hinzu.')
        .getResponse();
    }

    // AMAZON.Food sometimes captures "zucker und milch" as one item — split if needed
    const parsed = parseMultipleItems(itemName);
    if (parsed.length > 1) {
      try {
        const res = await apiRequest('POST', '/api/external/shopping-list/add-multiple', {
          items: parsed.map(name => ({ name })),
        });
        if (res.status === 200 && res.data.success) {
          const parts = res.data.items.map(i =>
            i.merged ? `${i.name} erhöht auf ${i.newQuantity}` : i.name
          );
          const rb = handlerInput.responseBuilder
            .speak(`${res.data.count} Artikel verarbeitet: ${parts.join(', ')}.`)
            .withShouldEndSession(true);
          await Promise.all([addAPLShoppingList(rb, handlerInput), pushWidgetData(handlerInput)]);
          return rb.getResponse();
        }
      } catch (error) {
        console.error('API error:', error);
      }
      return handlerInput.responseBuilder
        .speak('Beim Hinzufügen ist ein Fehler aufgetreten.')
        .getResponse();
    }

    try {
      const res = await apiRequest('POST', '/api/external/shopping-list/add', {
        name: itemName,
        quantity,
      });

      if (res.status === 200 && res.data.success) {
        let speech;
        if (res.data.merged) {
          speech = `${itemName} war bereits auf der Liste. Menge erhöht auf ${res.data.newQuantity}.`;
        } else {
          const qtyText = quantity > 1 ? `${quantity} mal ` : '';
          speech = `${qtyText}${itemName} wurde zur Liste hinzugefügt.`;
        }
        const rb = handlerInput.responseBuilder
          .speak(speech)
          .withShouldEndSession(true);
        await Promise.all([addAPLShoppingList(rb, handlerInput), pushWidgetData(handlerInput)]);
        return rb.getResponse();
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

// Clean AMAZON.SearchQuery values — Alexa sometimes leaks invocation name and
// carrier words into the captured slot text.
function cleanSlotText(text) {
  let cleaned = text;
  // Strip invocation prefix that sometimes leaks in
  cleaned = cleaned.replace(/^(sage|frage|öffne|starte|erzähle)\s+inventar\s+/i, '');
  cleaned = cleaned.replace(/^inventar\s+/i, '');
  // Strip carrier verbs at the start
  cleaned = cleaned.replace(/^(füge|notiere|schreib|setze|bitte)\s+/i, '');
  // Strip carrier suffixes
  cleaned = cleaned.replace(/\s+(hinzu|hinzufügen|eintragen|auf die liste|auf|bitte)$/i, '');
  return cleaned.trim();
}

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
    const rawText = cleanSlotText(slots.items?.value || '');

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
          let speech;
          if (res.data.merged) {
            speech = `${items[0]} war bereits auf der Liste. Menge erhöht auf ${res.data.newQuantity}.`;
          } else {
            speech = `${items[0]} wurde zur Liste hinzugefügt.`;
          }
          const rb = handlerInput.responseBuilder
            .speak(speech)
            .withShouldEndSession(true);
          await Promise.all([addAPLShoppingList(rb, handlerInput), pushWidgetData(handlerInput)]);
          return rb.getResponse();
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
        const parts = res.data.items.map(i =>
          i.merged ? `${i.name} erhöht auf ${i.newQuantity}` : i.name
        );
        const rb = handlerInput.responseBuilder
          .speak(`${res.data.count} Artikel verarbeitet: ${parts.join(', ')}.`)
          .withShouldEndSession(true);
        await Promise.all([addAPLShoppingList(rb, handlerInput), pushWidgetData(handlerInput)]);
        return rb.getResponse();
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

      const rb = handlerInput.responseBuilder.speak(speech);
      if (supportsAPL(handlerInput)) {
        rb.addDirective({
          type: 'Alexa.Presentation.APL.RenderDocument',
          token: 'shoppingListToken',
          document: buildAPLDocument(manual, auto, total),
        });
      }
      await pushWidgetData(handlerInput);
      return rb.getResponse();
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
    WidgetInstalledHandler,
    WidgetRemovedHandler,
    WidgetUpdateHandler,
    WidgetInstallationErrorHandler,
    WidgetUserEventHandler,
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
