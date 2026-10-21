# SharePoint lists and library

Create these on the SharePoint site that will hold the records (for example the Supported Housing or Property Services site). Column names must match exactly, because the flow writes to their internal names. Create each column with the name shown first, and rename it afterwards if you want a friendlier label.

## Library: Void Pre-Inspection Records

A document library. Each submission adds one PDF named `VPI-yyyymmdd-XXXX - <address> - Void Pre-Inspection - dd-mm-yyyy.pdf`. No extra columns needed.

## List: Void Pre-Inspections

One row per submitted pre-inspection. Title holds the reference (`VPI-20261015-D632`).

| Column | Type | Notes |
|---|---|---|
| Title | Single line (built in) | Reference |
| SubmittedAt | Date and time | |
| InspectionDate | Date only | |
| Officer | Single line | Supported officer |
| OfficerEmail | Single line | |
| Address | Multiple lines (plain) | |
| PropertyRef | Single line | HMS property reference |
| PropertyType | Single line | |
| StockRecord | Single line | Bedrooms, heating, year, m², floor |
| VoidDuration | Single line | |
| Keysafe | Single line | |
| Access | Multiple lines (plain) | |
| GasCap | Choice: Yes, No | |
| EPCRequired | Choice: Yes, No | |
| UtilitiesSwap | Choice: Yes, No | |
| ElectricOn | Choice: Yes, No | |
| WhiteGoodsPAT | Choice: Yes, No | |
| Redecoration | Single line | Full, Part, No or "Other: …" |
| Colour | Single line | |
| HSIssues | Multiple lines (plain) | |
| Notes | Multiple lines (plain) | |
| ExternalWorks | Multiple lines (plain) | |
| NoWorks | Yes/No | Yes means close the void |
| SORText | Multiple lines (plain) | SOR codes by room, ready to paste into HMS |
| WorksCount | Number | |
| WorksValue | Currency (£) | Estimate at NHF8 base rates |
| PhotoCount | Number | Photos are inside the PDF |
| SubmittedBy | Single line | From the Microsoft sign-in |
| SubmittedByEmail | Single line | |
| SubmissionId | Single line | |
| RecordLink | Hyperlink | Link to the PDF, set by the flow |

## List: Void Pre-Inspection Works

One row per SOR line, so the works can be filtered and totalled in Power BI or Excel. Title holds the reference, which links back to the Void Pre-Inspections row.

| Column | Type |
|---|---|
| Title | Single line (built in), reference |
| Room | Single line |
| SORCode | Single line |
| Repair | Single line |
| SORDescription | Multiple lines (plain) |
| Where | Single line |
| UOM | Single line |
| Quantity | Number (2 decimals) |
| Rate | Currency (£) |
| LineValue | Currency (£) |
| AddedFromBook | Yes/No |

## List: Void Pre-Inspection Inventory

One row per inventory item, only when the optional inventory is completed. Title holds the reference, which links back to the Void Pre-Inspections row. The access and clearance instructions repeat on each row so the list can be filtered on its own.

| Column | Type |
|---|---|
| Title | Single line (built in), reference |
| Room | Single line |
| Item | Single line |
| Decision | Single line: Stay, Remove, or blank (Clean only) |
| Clean | Yes/No |
| Address | Multiple lines (plain) |
| PropertyRef | Single line |
| AccessInstructions | Multiple lines (plain) |
| ClearanceInstructions | Multiple lines (plain) |

## Permissions

Break inheritance on all three lists and the library and give access to the owners plus whoever reviews voids (for example the Supported Housing team managers and the voids team). Staff using the form do not need access to these lists: the flow writes as its owner, and they get their copy by email. The flow owner needs Edit on all four.
