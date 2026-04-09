# Alexa Skill — Einkaufsliste

Voice commands to add items to your shopping list and read it back.

## Voice Commands

| Phrase | Action |
|---|---|
| *"Alexa, öffne Einkaufsliste"* | Opens the skill |
| *"Füge Milch hinzu"* | Adds Milch to the list |
| *"Füge drei Eier hinzu"* | Adds 3× Eier |
| *"Ich brauche Milch, Brot und Eier"* | Adds 3 separate items |
| *"Was steht auf der Liste?"* | Reads back the list |

## Setup

### 1. Generate an API Key

Add a random API key to your backend `.env`:

```
EXTERNAL_API_KEY=your-random-secret-key-here
```

Generate one with: `openssl rand -hex 32`

Restart the backend after adding it.

### 2. Create the Alexa Skill

1. Go to [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask)
2. **Create Skill** → Name: `Einkaufsliste` → Language: **German (DE)** → Type: **Custom** → Hosting: **Alexa-Hosted (Node.js)**
3. In the skill editor, go to **JSON Editor** (left sidebar under Interaction Model)
4. Paste the contents of `interaction-model-de.json`
5. Click **Save Model** → **Build Model**

### 3. Deploy the Lambda Code

**If using Alexa-Hosted:**
1. Go to the **Code** tab in the Alexa Developer Console
2. Replace the contents of `lambda/index.js` with the file from `lambda/index.js`
3. Replace `lambda/package.json` with the one from `lambda/package.json`
4. Go to the **Code** tab → click the **Variables** icon (or find it under the environment section)
5. Add environment variables:
   - `API_BASE_URL` = `https://your-domain.com` (your inventory server URL)
   - `API_KEY` = the same key you set in `EXTERNAL_API_KEY`
6. Click **Deploy**

**If using your own AWS Lambda:**
1. `cd alexa/lambda && npm install`
2. Zip the folder: `zip -r ../lambda.zip .`
3. Upload to AWS Lambda (Node.js 18.x or 20.x runtime)
4. Set environment variables `API_BASE_URL` and `API_KEY`
5. In the Alexa skill config, set the endpoint to the Lambda ARN

### 4. Test

1. Go to the **Test** tab in the Alexa Developer Console
2. Enable testing in **Development** mode
3. Type or say: *"Öffne Einkaufsliste"*
4. Then: *"Füge Milch hinzu"*
5. Check your web app — the item should appear on the shopping list

### 5. Use on Your Devices

Since this is a development skill, it will automatically be available on all Alexa devices linked to the same Amazon account you used to create the skill. No need to publish it.

## API Endpoints

The skill uses these backend endpoints (authenticated via `X-API-Key` header):

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/external/shopping-list/add` | Add item (`{ name, quantity }`) |
| `POST` | `/api/external/shopping-list/add-multiple` | Add multiple items (`{ items: [{ name }, ...] }`) |
| `GET` | `/api/external/shopping-list` | Get combined shopping list |

## Troubleshooting

- **"Verbindung fehlgeschlagen"**: Check that your server is accessible via HTTPS from the internet
- **401 errors**: Verify the API key matches between Lambda env vars and backend `.env`
- **Skill not found on device**: Make sure you're using the same Amazon account
