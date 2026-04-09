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
const aplDocument = require('./apl-shopping-list.json');

// --- APL helpers ---
function supportsAPL(handlerInput) {
  const interfaces = handlerInput.requestEnvelope.context?.System?.device?.supportedInterfaces;
  return !!interfaces?.['Alexa.Presentation.APL'];
}

function buildAPLData(manual, auto, total) {
  const allItems = [];

  if (manual.length > 0) {
    allItems.push({ isHeader: true, label: '📝 Manuell hinzugefügt', color: '#FF9800' });
    for (const i of manual) {
      allItems.push({
        isHeader: false,
        name: i.name,
        qty: i.quantity || 1,
        checked: !!i.checked,
        icon: i.checked ? '☑' : '☐',
      });
    }
  }

  if (auto.length > 0) {
    allItems.push({ isHeader: true, label: '🔄 Nachkaufen (Bestand niedrig)', color: '#2196F3' });
    for (const i of auto) {
      allItems.push({
        isHeader: false,
        name: i.name,
        qty: i.needed || 1,
        checked: false,
        icon: '•',
      });
    }
  }

  return {
    subtitle: `${total} Einträge`,
    allItems,
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
        document: aplDocument,
        datasources: { payload: buildAPLData(manual, auto, total) },
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
    items.push({ name: i.name, qty: i.quantity || 1, checked: !!i.checked, icon: i.checked ? '☑' : '☐' });
  }
  for (const i of auto) {
    items.push({ name: i.name, qty: i.needed || 1, checked: false, icon: '•' });
  }
  const moreCount = Math.max(0, items.length - MAX_WIDGET_ITEMS);
  return {
    total,
    items: items.slice(0, MAX_WIDGET_ITEMS),
    moreCount,
  };
}

async function pushWidgetData(handlerInput) {
  try {
    const apiEndpoint = handlerInput.requestEnvelope.context?.System?.apiEndpoint;
    const apiToken = handlerInput.requestEnvelope.context?.System?.apiAccessToken;
    const userId = handlerInput.requestEnvelope.context?.System?.user?.userId;
    if (!apiEndpoint || !apiToken || !userId) return;

    const listRes = await apiRequest('GET', '/api/external/shopping-list');
    if (listRes.status !== 200) return;

    const { manual, auto, total } = listRes.data;
    const widgetData = buildWidgetData(manual, auto, total);

    const url = new URL('/v1/datastore/commands', apiEndpoint);
    const payload = JSON.stringify({
      commands: [{
        type: 'PUT_OBJECT',
        namespace: 'SHOPPING_LIST',
        key: 'listData',
        content: widgetData,
      }],
      target: { type: 'USER', id: userId },
    });

    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          if (res.statusCode >= 400) console.error('DataStore push error:', res.statusCode, data);
          resolve();
        });
      });
      req.on('error', (e) => { console.error('DataStore push error:', e); resolve(); });
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
          document: aplDocument,
          datasources: { payload: buildAPLData(manual, auto, total) },
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
