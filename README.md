# Void Pre-Inspection form (Supported Housing)

North Star's Supported Housing void pre-inspection, built from Laurie Edmondson's paper "Void Pre Inspection" form. Staff sign in with their North Star Microsoft account, pick the property, tick the repairs room by room (with NHF8 SOR codes and m² where the paper asks), add photos and submit. Each submission:

* creates a branded PDF report in the browser (photos included) and downloads a copy;
* saves the PDF to the **Void Pre-Inspection Records** SharePoint library;
* adds a row to the **Void Pre-Inspections** list, one row per SOR to **Void Pre-Inspection Works** and, if an inventory was completed, one row per item to **Void Pre-Inspection Inventory**;
* emails the person who submitted it, CC the supported officer, with the PDF attached and the SOR codes by room ready to paste into HMS.

It follows the same pattern as the Awaab's Law and Property Services inspection forms: Azure Static Web App with Entra sign-in, one Azure Function, and a Power Automate flow.

## How it fits together

```
site/            the form (static HTML, no build step); jsPDF is self-hosted in site/vendor because of the CSP
api/             Azure Function POST /api/submit: checks the signed-in user, validates, re-prices SORs, calls the flow
shared/          single source of truth: officers, questions, SOR tick lists by room, pricing (preinspection.js) and the NHF8 book (sors.json)
flow/            how to build the Power Automate flow, and its trigger schema
sharepoint/      the two lists and the library to create
scripts/         sync-shared.js (copies shared/ into site/ and api/shared/) and dev-server.js (local preview)
```

The browser never decides prices: the function looks every SOR up in `shared/sors.json` and works out quantities, totals, the email and the list rows itself.

Property search uses `site/properties.json` (Active Properties export, 7 Oct 2026, the same list as the other forms) and `site/property-details.json` (bedrooms, heating, build year, floor area and floor from the Feb 2023 stockdet export). Picking a property fills in the address, reference and type, and sets the bedroom rooms to match.

## Changing the form

* Who can complete the form (supported officers and the Property Services surveyors), the inventory rooms and items, Yes/No questions, the tick list for each kind of room, default rooms: `shared/preinspection.js`. Run `npm run sync` afterwards.
* Wording and layout: `site/index.html`.
* Property list: replace `site/properties.json` and `site/property-details.json` with newer exports in the same shape.

## Run it locally

Needs Node 20 or later.

```
npm install     # only needed to update jsPDF (npm run sync then copies it into site/vendor)
npm test        # syncs shared/ and runs the API tests
npm run dev     # http://localhost:4280, signed in as a fake user; submissions go to dev-submissions/
```

## Go live

1. **GitHub.** Create a private repository (for example `void-preinspection-form`) and push this folder to `main`.
2. **Static Web App.** In the Azure portal, create a Static Web App on the **Standard** plan (needed for custom Entra sign-in), source GitHub, this repository, branch `main`, build preset **Custom**, app location `site`, API location `api`, output location blank. Azure commits its own deploy workflow to the repository. `site/vendor`, `site/sors.json`, `site/preinspection.js` and `api/shared` are committed, so there is no build step; after changing anything in `shared/`, run `npm run sync` and commit the copies.
3. **Entra app registration.** Register an app (single tenant, North Star). Add the web redirect URI `https://<your-app>.azurestaticapps.net/.auth/login/aad/callback` and tick ID tokens. Create a client secret.
4. **SharePoint.** Create the library and the two lists in `sharepoint/list-schema.md` on the site you choose, and set their permissions.
5. **Flow.** Build it from `flow/README.md`, save, and copy its HTTP POST URL.
6. **App settings.** In the Static Web App → Environment variables add `AAD_CLIENT_ID`, `AAD_CLIENT_SECRET` and `FLOW_URL`.
7. **Restrict who can use it (optional).** In Entra → Enterprise applications → this app, set "Assignment required" to Yes and assign the Supported Housing group.
8. **Test.** Sign in, submit a test pre-inspection for a real property and check the PDF, both lists and the email. Delete the test rows.

## Go-live checklist

- [ ] Sign-in works and only North Star accounts get in
- [ ] A test submission lands in the library, both lists and the inbox, with the officer CC'd
- [ ] A "No repairs needed" submission arrives with "NO WORKS – close void" in the subject
- [ ] The SOR text pastes cleanly into HMS
- [ ] Laurie and the team managers have access to the lists
- [ ] The link is shared with the Supported Housing staff (it works on phones)

## Not included yet

Nothing outstanding from the paper forms. The optional **Inventory** section (from the paper "Property Inventory" sheet) is on the form: staff tick Stay / Remove / Clean per item, add free-text furniture and other items, and give access and clearance instructions. It appears in the PDF and the email, and the payload carries `hasInventory` and `inventoryText` for the flow. It is also saved to the **Void Pre-Inspection Inventory** SharePoint list, one row per item (see `sharepoint/list-schema.md` and step 5b in `flow/README.md`).
