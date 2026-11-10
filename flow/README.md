# Power Automate flow: Void Pre-Inspection submit

The Azure Function at `/api/submit` does all the checking, pricing and formatting, then POSTs one JSON body to this flow. The flow only copies fields into SharePoint and Outlook. Build it as a new **Instant cloud flow** named `Void Pre-Inspection submit`.

Replace `<SITE>` below with the SharePoint site holding the lists, for example `https://northstarhg.sharepoint.com/sites/SupportedHousing`. Create the lists first (see `../sharepoint/list-schema.md`).

## 1. When an HTTP request is received

* Who can trigger the flow: **Anyone** (the URL carries a signature; it only lives in the Static Web App settings).
* Request Body JSON Schema: paste `trigger-schema.json`.
* Save the flow, then copy the **HTTP POST URL**. That is the `FLOW_URL` app setting.

## 2. Create file (SharePoint)

* Site Address: `<SITE>`
* Folder Path: `/Void Pre-Inspection Records`
* File Name: `triggerBody()?['recordFileName']`
* File Content: `base64ToBinary(triggerBody()?['pdfBase64'])`

## 2b. Create file (SharePoint): the form data, for surveyor review

Add this straight after step 2. It saves the whole form, photos included, so a surveyor can open it again from the link in the email (see "Surveyor review" below).

* Site Address: `<SITE>`
* Folder Path: `/Void Pre-Inspection Records/Data` (create the **Data** folder in the library first)
* File Name: `triggerBody()?['dataFileName']`
* File Content: `triggerBody()?['recordJson']`

## 3. Compose: RecordLink

```
concat('<SITE>', replace(body('Create_file')?['Path'], ' ', '%20'))
```

## 4. Send an HTTP request to SharePoint: create the pre-inspection row

* Site Address: `<SITE>`
* Method: `POST`
* Uri: `_api/web/lists/getbytitle('Void Pre-Inspections')/items`
* Headers: `Accept` = `application/json;odata=nometadata`, `Content-Type` = `application/json;odata=nometadata`
* Body (expression):

```
setProperty(triggerBody()?['sharepointItem'], 'RecordLink', json(concat('{"Url":"', outputs('Compose:_RecordLink'), '","Description":"', triggerBody()?['reference'], '"}')))
```

(If the Compose step has a different name, pick it from the dynamic content list instead of typing it.)

## 5. Apply to each: `triggerBody()?['worksItems']`

Settings → Concurrency control on, degree **20**. Inside it, one **Send an HTTP request to SharePoint**:

* Method `POST`, Uri `_api/web/lists/getbytitle('Void Pre-Inspection Works')/items`
* Same two headers as step 4
* Body: `item()`

A no-works void sends an empty array, so this step does nothing for it.

## 5b. Apply to each: `triggerBody()?['inventoryItems']` (optional inventory)

Same as step 5 but Uri `_api/web/lists/getbytitle('Void Pre-Inspection Inventory')/items`, Body `item()`. Add it straight after step 5. It does nothing when no inventory was completed (empty array).

## 6. Get file content (SharePoint)

* Site Address: `<SITE>`, File Identifier: `body('Create_file')?['Id']`

## 7. Send an email (V2) (Office 365 Outlook)

The email goes out from whichever account owns the flow's Outlook connection, so with **Send an email (V2)** every submission looks as if it came from the flow's owner. To send from a team mailbox instead (for example a Voids or no-reply mailbox), use **Send an email from a shared mailbox (V2)**, put that mailbox's address in *Original Mailbox Address*, and fill in the same fields below. The flow owner needs **Send As** permission on the mailbox (Exchange admin centre → Mailboxes → the mailbox → Delegation).

* To: `triggerBody()?['emailTo']`
* CC: `triggerBody()?['emailCc']` (semicolon separated; already includes the supported officer and the property's surveyor from `shared/surveyors.json`, or the Property Services team mailbox when HMS has no surveyor for the property)
* Subject: `triggerBody()?['emailSubject']`
* Body: switch to code view `</>` and put `triggerBody()?['emailHtml']` as an expression
* Attachments Name: `triggerBody()?['recordFileName']`, Content: `body('Get_file_content')`
* Importance: Normal

## 8. Response

* Status code `200`, Body: `{"reference": "@{triggerBody()?['reference']}"}`

Add a second **Response** with status `500` after a scope or a "run after has failed" branch if you want failures to show straight away; otherwise the function reports any non-2xx as "could not be saved, submit again".

## Testing the flow on its own

`npm run dev` with `FLOW_URL` set sends the real payload from your local copy, so you can test end to end before deploying:

```
FLOW_URL="https://prod-...logic.azure.com/..." npm run dev
```

# Surveyor review flows

A surveyor (anyone in `shared/surveyors.json`, plus Amy Rose, Fiona McCulloch, the Property Services team mailbox and Sean; add more with the `REVIEWERS` app setting, comma separated) opens a submitted pre-inspection from the **Surveyor: review or change this pre-inspection** button in the email, or from the box at the bottom of the form, which takes the reference. The page is `https://<site>/?review=VPI-...`. They change anything on the form and press **Save review and update PDF**. The Azure Function then works out what changed and calls the save flow, which:

* saves the new PDF next to the original as `<reference> - <address> - Void Pre-Inspection - <date> - Review 1.pdf` (the original PDF is kept);
* replaces `Data/<reference>.json` with the new version (SharePoint keeps the old one in version history);
* updates the row in **Void Pre-Inspections** (works, totals, SOR text and the review columns) and points RecordLink at the new PDF;
* replaces that reference's rows in **Void Pre-Inspection Works** and **Void Pre-Inspection Inventory**;
* emails the surveyor, CC the person who submitted it, the officer, the property's surveyor, anyone who reviewed it before and (until 1 Dec 2026) Sean, with the updated PDF and the list of changes.

If two people review the same one at once, the second save is refused with "X saved a review after you opened it, reload", so nobody overwrites anyone.

Only pre-inspections submitted after step 2b is in place can be reviewed; older ones have no saved form, and the page says so.

Two flows do the SharePoint work. Build both as **Instant cloud flows**, then put their HTTP POST URLs in the Static Web App's environment variables as `REVIEW_LOAD_URL` and `REVIEW_SAVE_URL`. Until both are set, the review page says "Surveyor review is not switched on yet". Optionally set `SITE_URL` (for example `https://inspections.northstarhg.co.uk/void` or the Static Web App address) if the link in the email ever points at the wrong address; otherwise the function uses the address the form was opened on.

## Flow A: Void Pre-Inspection review load

1. **When an HTTP request is received.** Who can trigger: **Anyone**. Request Body JSON Schema: paste `review-load-schema.json`.
2. **Get file content using path (SharePoint).** Site Address `<SITE>`, File Path `/Void Pre-Inspection Records/Data/@{triggerBody()?['dataFileName']}`, Infer Content Type **No**.
3. **Response.** Status code `200`, Headers `Content-Type` = `application/json`, Body: `body('Get_file_content_using_path')`.
4. **Response** (a second one). Status code `404`, Body `{"error":"not found"}`. On its ⋯ menu → **Settings / Configure run after**, tick only **has failed** for step 2.

The function accepts the file either as plain JSON or in SharePoint's `{"$content": "<base64>"}` wrapper, so either form of step 3's body works.

## Flow B: Void Pre-Inspection review save

1. **When an HTTP request is received.** Who can trigger: **Anyone**. Request Body JSON Schema: paste `review-save-schema.json`.
2. **Create file (SharePoint): the updated PDF.** Site Address `<SITE>`, Folder Path `/Void Pre-Inspection Records`, File Name `triggerBody()?['recordFileName']`, File Content `base64ToBinary(triggerBody()?['pdfBase64'])`. Rename the step **Create PDF**.
3. **Create file (SharePoint): the form data.** Folder Path `/Void Pre-Inspection Records/Data`, File Name `triggerBody()?['dataFileName']`, File Content `triggerBody()?['recordJson']`. This replaces the existing file of the same name. (If your tenant ever says the file already exists, swap it for **Update file** with File Identifier `/Void Pre-Inspection Records/Data/@{triggerBody()?['dataFileName']}`.)
4. **Send an HTTP request to SharePoint: find the row.** Method `GET`, Uri `_api/web/lists/getbytitle('Void Pre-Inspections')/items?$select=Id&$filter=Title eq '@{triggerBody()?['reference']}'`, Header `Accept` = `application/json;odata=nometadata`. Rename it **Find row**.
5. **Send an HTTP request to SharePoint: update the row.** Method `POST`, Uri `_api/web/lists/getbytitle('Void Pre-Inspections')/items(@{first(body('Find_row')?['value'])?['Id']})`. Headers: `Accept` and `Content-Type` = `application/json;odata=nometadata`, `IF-MATCH` = `*`, `X-HTTP-Method` = `MERGE`. Body (expression):

```
setProperty(triggerBody()?['listUpdate'], 'RecordLink', json(concat('{"Url":"', concat('<SITE>', replace(body('Create_PDF')?['Path'], ' ', '%20')), '","Description":"', triggerBody()?['reference'], ' review ', string(triggerBody()?['revision']), '"}')))
```

6. **Send an HTTP request to SharePoint: find the old works rows.** Method `GET`, Uri `_api/web/lists/getbytitle('Void Pre-Inspection Works')/items?$select=Id&$top=500&$filter=Title eq '@{triggerBody()?['reference']}'`, Header `Accept` = `application/json;odata=nometadata`. Rename it **Find works**.
7. **Apply to each: `body('Find_works')?['value']`.** Inside: **Send an HTTP request to SharePoint**, Method `POST`, Uri `_api/web/lists/getbytitle('Void Pre-Inspection Works')/items(@{items('Apply_to_each')?['Id']})`, Headers `IF-MATCH` = `*`, `X-HTTP-Method` = `DELETE`. (Pick the loop's own name from dynamic content if it isn't `Apply_to_each`.)
8. **Apply to each: `triggerBody()?['worksItems']`.** Same as step 5 of the submit flow: POST `_api/web/lists/getbytitle('Void Pre-Inspection Works')/items`, the two headers, Body `item()`. Concurrency 20.
9. **Inventory.** Repeat steps 6 to 8 for `Void Pre-Inspection Inventory` with `triggerBody()?['inventoryItems']`.
10. **Get file content (SharePoint).** File Identifier `body('Create_PDF')?['Id']`.
11. **Send an email (V2)** (or from the shared mailbox, as in the submit flow). To `triggerBody()?['emailTo']`, CC `triggerBody()?['emailCc']`, Subject `triggerBody()?['emailSubject']`, Body (code view) `triggerBody()?['emailHtml']`, Attachments Name `triggerBody()?['recordFileName']`, Content `body('Get_file_content')`.
12. **Response.** Status code `200`, Body `{"reference": "@{triggerBody()?['reference']}", "revision": @{triggerBody()?['revision']}}`.

Leave concurrency off on the two delete loops. The flow owner needs Edit on the lists and library, as for the submit flow.

## Testing the review flows locally

`npm run dev` mocks both flows (records live in `dev-submissions/data/`). Submit one, then open `http://localhost:4280/?review=<reference>`. To test against the real flows, deploy a pull request: Azure builds a preview site for it, which uses the same environment variables.
