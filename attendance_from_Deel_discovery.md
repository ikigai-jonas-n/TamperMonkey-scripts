# Issue Briefing for Claude Code: Deel PTO Description Parsing & Dynamic Target Calculation

## 1. What the User Wants
The user wants our Tampermonkey userscript (`IKG Attendance Pro`) to automatically parse partial Paid Time Off (PTO) time windows (e.g., `17:00-18:00`, `1700-1800`, `5pm-6pm`, `13:00~17:00`) from Deel leave request descriptions. 

Using these parsed time windows, the script needs to dynamically adjust daily work target hours:
- **Evening PTO (e.g., 17:00–18:00):** Shortens the shift end time (Target = $9.0\text{h} - 1.0\text{h PTO} = 8.0\text{h}$ target).
- **Afternoon PTO (e.g., 13:00–18:00):** Adjusts shift for morning work ($09:00\text{ AM} \sim 11:45\text{ AM} = 2.75\text{h}$ target, exempt from lunch).
- **Morning PTO (e.g., 09:00–13:00):** Adjusts afternoon shift ($13:00 \sim 18:00\text{ PM} = 5.0\text{h}$ target).

Without this description parsing, the engine falls back to a simple $9.0\text{h} - \text{PTO Hours}$ deduction without shift-window awareness.

---

## 2. What We Discovered About Deel's API
1. **The Standard List Endpoint Strips Descriptions:**
   Calling `GET /deelapi/time_offs/profile/{profileId}/time_off` (with either `lightweight=true` or `lightweight=false`) returns an array of PTO records, but Deel **completely omits or nulls the `description` key** on every item to save bandwidth. `timeOffDailies` is also returned as an empty array `[]`.

2. **Where the Description Actually Lives:**
   Descriptions exist in Deel's **Approval Requests Feed**. When looking at an individual request in Deel, the raw curl shows that full details are returned under the approvals domain:
   ```http
   GET [https://ikg.deel.team/deelapi/approvals/requests/requester/](https://ikg.deel.team/deelapi/approvals/requests/requester/){approvalRequestId}
   ```
   A sample JSON response returned by this endpoint:
   ```json
   {
     "id": "e7afafd8-95fd-4f3f-b908-ed334d563748",
     "domain": "TIME_OFF",
     "details": {
       "status": "APPROVED",
       "requestDetails": [
         {
           "id": "8cf6a77a-2456-4008-a0f3-abf4238eac72",
           "startDate": "2026-05-19T00:00:00Z",
           "description": "Urgent matter at home, 17:00-18:00, Leave coverage: Kyle",
           "timeOffTypeName": "Personal Leave - Taiwan"
         }
       ]
     }
   }
   ```

---

## 3. What Failed / Didn't Work

We tried several endpoint variations, all of which failed with 400, 403, or 404 errors:

1. **`GET /deelapi/approvals/requests/requester/{profileId}`** $\to$ **`404 / 400 Bad Request`**
   - **Reason:** `{profileId}` is the Time-Off Profile ID (`7f8f8033-...`) or User Profile ID (`2206045`). However, Deel's `/approvals/requests/requester/{id}` endpoint strictly expects the **Parent Approval Request UUID** (e.g. `e7afafd8-95fd-4f3f-b908-ed334d563748`), NOT a user or profile ID. Passing a user/profile ID causes a 400/404.

2. **`GET /deelapi/time_offs/requests?contractOid={contractOid}`** $\to$ **`404 / 403 Forbidden`**
   - **Reason:** Deel requires organizational scope headers or contract-level session routing that fails when called via Tampermonkey's `GM_xmlhttpRequest`.

3. **`GET /deelapi/time_offs/profile/{profileId}/requests`** $\to$ **`404 Not Found`**
   - **Reason:** Path does not exist on Deel's public API router.

4. **`GET /deelapi/time_offs/{timeOffId}`** $\to$ **`404 Not Found`**
   - **Reason:** `8cf6a77a-2456-4008-a0f3-abf4238eac72` is the child `timeOffId`, not the parent approval request ID.

---

## 4. The Tricky Part
- **ID Disconnect:** Deel's primary list endpoint (`/time_offs/profile/{profileId}/time_off`) returns a list of child `timeOffId`s (e.g., `8cf6a77a...`), but **does not return the parent `approvalRequestId`** (e.g., `e7afafd8...`). Without the parent ID, we cannot directly query `/approvals/requests/requester/{id}` for individual items.
- **Unreliable Human Typing:** Users enter time in descriptions completely free-form (`1700-1800`, `17:00~18:30`, `5pm-6pm`, `1700 -1800`). The regex must normalize all these formats into decimal 24-hour floats (`ptoStartDec`, `ptoEndDec`).
- **Cookie & Auth Scope:** Deel uses Cloudflare protection (`cf_clearance`, `_cfuvid`) and JWT tokens (`x-auth-token`). Cross-origin XHR requests must maintain session context (`withCredentials: true`).

---

## 5. How Deel Opens Access to This Data & Recommended Next Steps

Deel exposes request descriptions in two ways:
1. **Via the Approval Request Feed endpoint:**
   `GET /deelapi/approvals/requests/requester/{approvalRequestId}` returns the full request object containing `details.requestDetails[0].description`.
2. **Via the User/Contract Time-Off Feed:**
   When navigating the Deel UI (`https://ikg.deel.team/profile/{hrisProfileId}/time-off/{contractOid}`), Deel calls an approval/time-off feed endpoint using contract parameters.

### Recommended Tasks for Claude Code:
1. Determine how to either:
   - Extract the parent `approvalRequestId` mapping from Deel's API so we can call `GET /deelapi/approvals/requests/requester/{approvalRequestId}` for partial PTO entries.
   - Intercept Deel's native page load fetch calls using a Tampermonkey `XHR/Fetch` listener on `ikg.deel.team` tabs to capture the full request objects including descriptions when the user visits Deel.
2. Ensure the regex parser (`parseTimeFromText`) handles uncoloned 4-digit numbers (`1700-1800`), 12-hour AM/PM (`5pm-6pm`), and variable spaces (`1700 -1800`).
3. Pass `ptoStartDec` and `ptoEndDec` down to `calculateDailyTarget` to ensure dynamic daily work target hour recalculations.