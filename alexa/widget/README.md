# Alexa Widget — Einkaufsliste

Shows the shopping list as a persistent widget on the Echo Show 15 home screen.

## Setup in Alexa Developer Console

### 1. Enable Required Interfaces

Go to **Build → Interfaces** and enable:
- ✅ Alexa Presentation Language
- ✅ Alexa.DataStore
- ✅ Alexa.DataStore.PackageManager

### 2. Create a Widget Package

Go to **Build → Multimodal Responses → Widget Packages** and create a new package:

- **Package Name**: `shopping_list_widget`
- **Widget Name (de-DE)**: `Einkaufsliste`
- **Widget Description (de-DE)**: `Zeigt die aktuelle Einkaufsliste`
- **Widget Size**: Medium
- **APL Document**: Upload `alexa/widget/apl-widget.json`

### 3. Deploy Lambda

Include `apl-shopping-list.json` in the Lambda zip alongside `index.js`.

The Lambda automatically:
- Pushes data to the widget DataStore on every add/list action
- Handles `UsagesInstalled` event when the widget is first added

### 4. Add Widget on Echo Show 15

On your Echo Show 15:
1. Swipe down from the top
2. Open **Widget Gallery**
3. Find **Inventar → Einkaufsliste**
4. Tap to add it to your home screen

The widget updates automatically when you add items via voice or the web app.
