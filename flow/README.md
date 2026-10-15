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

## 6. Get file content (SharePoint)

* Site Address: `<SITE>`, File Identifier: `body('Create_file')?['Id']`

## 7. Send an email (V2) (Office 365 Outlook)

Use **Send an email from a shared mailbox (V2)** instead if the emails should come from a team mailbox.

* To: `triggerBody()?['emailTo']`
* CC: `triggerBody()?['emailCc']` (semicolon separated; already includes the supported officer)
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
