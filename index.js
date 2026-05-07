const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
require("dotenv").config();

const requiredEnvVars = [
  "VERACITY_API_KEY",
  "HUBSPOT_CLIENT_ID",
  "HUBSPOT_CLIENT_SECRET",
  "HUBSPOT_REFRESH_TOKEN",
  "HUBSPOT_REDIRECT_URI",
];

requiredEnvVars.forEach((key) => {
  if (!process.env[key]) {
    console.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
});

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

let cachedAccessToken = null;
let tokenExpiryTime = null;

// Test route
app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

// app.get("/oauth/callback", async (req, res) => {
//   try {
//     const code = req.query.code;

//     if (!code) {
//       return res.send("No code received");
//     }

//     console.log("Auth Code:", code);

//     // 🔥 TOKEN EXCHANGE
//     const tokenResponse = await fetch("https://api.hubapi.com/oauth/v1/token", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/x-www-form-urlencoded",
//       },
//       body: new URLSearchParams({
//         grant_type: "authorization_code",
//         client_id: process.env.HUBSPOT_CLIENT_ID,
//         client_secret: process.env.HUBSPOT_CLIENT_SECRET,
//         redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
//         code: code,
//       }),
//     });

//     const data = await tokenResponse.json();

//     if (!tokenResponse.ok) {
//       console.error("OAuth token refresh failed:", data);

//       throw new Error("Failed to refresh HubSpot access token");
//     }

//     console.log("Token Response:", data);

//     if (!data.access_token) {
//       console.error("OAuth Failed:", data);
//       return res.send("OAuth failed: " + JSON.stringify(data));
//     }

//     return res.json({
//       message: "OAuth successful",
//       access_token: data.access_token,
//       refresh_token: data.refresh_token,
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).send("OAuth error");
//   }
// });

app.get("/oauth/callback", (req, res) => {
  console.log("OAuth callback hit");

  const code = req.query.code;

  console.log("Auth Code:", code);

  res.send("OAuth connected successfully");
});

app.post("/validate-from-hubspot", (req, res) => {
  console.log("HubSpot Button Clicked ✅");
  console.log("Body:", req.body);

  res.json({
    message: "Received",
    success: true,
  });
});

// Normalize phone (E.164)
function normalizePhone(phone) {
  if (!phone) return null;

  phone = phone.replace(/[^0-9+]/g, "");

  if (phone.startsWith("+")) {
    return phone;
  }

  if (phone.length === 10) {
    return "+91" + phone;
  }

  return phone;
}

async function validatePhoneWithVeracity(phone, contactId) {
  const normalizedPhone = normalizePhone(phone);

  const response = await fetch("https://api.veracityhub.io/v2/verify/carrier", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-TOKEN": process.env.VERACITY_API_KEY,
    },
    body: JSON.stringify({
      phone_number: normalizedPhone,
      contactId: contactId,
    }),
  });

  if (!response.ok) {
    throw new Error("Veracity API request failed");
  }

  const data = await response.json();

  return {
    normalizedPhone,
    data,
  };
}

async function updateHubSpotContact(accessToken, contactId, properties) {
  const response = await fetch(
    `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`HubSpot update failed for contact ${contactId}`);
  }

  return response;
}

function sendError(res, statusCode, message) {
  return res.status(statusCode).json({
    success: false,
    message,
  });
}

function sendSuccess(res, message, data = {}) {
  return res.json({
    success: true,
    message,
    ...data,
  });
}

async function getAccessToken() {
  try {
    // ✅ token still valid
    if (cachedAccessToken && tokenExpiryTime && Date.now() < tokenExpiryTime) {
      console.log("Using cached access token");
      return cachedAccessToken;
    }

    console.log("Generating new access token");

    const response = await fetch("https://api.hubapi.com/oauth/v1/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.HUBSPOT_CLIENT_ID,
        client_secret: process.env.HUBSPOT_CLIENT_SECRET,
        refresh_token: process.env.HUBSPOT_REFRESH_TOKEN,
      }),
    });

    const data = await response.json();

    cachedAccessToken = data.access_token;

    // ✅ expire before actual expiry for safety
    tokenExpiryTime = Date.now() + (data.expires_in - 60) * 1000;

    console.log("New access token generated");

    return cachedAccessToken;
  } catch (error) {
    console.error("Token Refresh Error:", error.message);
    throw error;
  }
}

// MAIN API
app.post("/validate-phone", async (req, res) => {
  console.log("===== REQUEST START =====");

  try {
    console.log("Fetching contact from HubSpot...");

    console.log("BODY:", req.body);

    // ✅ Now using phone_number everywhere
    // const { phone_number, contactId } = req.body;

    const { contactId } = req.body;

    if (!contactId) {
      return sendError(res, 400, "contactId is required");
    }

    console.log("Contact ID:", contactId);

    console.log("Fetching contact from HubSpot...");

    // 🔥 HubSpot से phone fetch करो
    const accessToken = await getAccessToken();

    const contactRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=phone`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    const contactData = await contactRes.json();

    console.log("HubSpot Contact RAW:", contactData);

    const phone_number = contactData?.properties?.phone;

    console.log("Fetched Phone:", phone_number);

    if (!phone_number) {
      return sendError(res, 400, "Phone not found in HubSpot");
    }

    console.log("Calling Veracity API...");

    const { normalizedPhone, data } = await validatePhoneWithVeracity(
      phone_number,
      contactId,
    );

    console.log("Veracity completed");

    if (!data?.success) {
      return sendError(res, 400, data?.message || "Phone validation failed");
    }

    // 🔥 HubSpot update start

    console.log("Updating HubSpot properties...");

    await updateHubSpotContact(accessToken, contactId, {
      veracity_validation_status: data.success ? "valid" : "invalid",

      veracity_carrier: data.data?.carrier_name || "",

      veracity_validated_at: new Date().toISOString(),
    });

    console.log("===== REQUEST END =====");

    // ✅ Clean response
    return sendSuccess(res, data?.message || "Validation completed", {
      normalized_phone: normalizedPhone,
      carrier: data?.data?.carrier_name || "",
      type: data?.data?.carrier_type || "",
      status: data?.data?.line_status || "",
      risk: data?.data?.veracity_risk_score || "",
      request_id: data?.request_id || "",
    });
  } catch (error) {
    console.error("Error:", error.message);

    return sendError(res, 500, "Something went wrong");
  }
});

// Bulk/List
app.post("/bulk-validate", async (req, res) => {
  try {
    const { listId } = req.body;

    console.log("LIST ID RECEIVED:", listId);

    if (!listId) {
      return sendError(res, 400, "listId is required");
    }

    console.log("Bulk validation started for list:", listId);

    const batchJob = {
      id: Date.now().toString(),
      listId,
      status: "queued",
      total: 0,
      processed: 0,
      valid: 0,
      invalid: 0,
      failed: 0,
      startedAt: new Date().toISOString(),
    };

    console.log("Batch Job Created:", batchJob);

    const accessToken = await getAccessToken();

    console.log("Fetching list members from HubSpot...");

    const listResponse = await fetch(
      `https://api.hubapi.com/crm/v3/lists/${listId}/memberships/join-order`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!listResponse.ok) {
      const errorText = await listResponse.text();

      console.error("Failed to fetch list members:", errorText);

      return sendError(res, 500, "Failed to fetch HubSpot list members");
    }

    const listData = await listResponse.json();

    console.log(`Fetched ${listData.total} contacts from HubSpot`);

    batchJob.total = listData.total;

    batchJob.status = "running";

    for (const member of listData.results) {
      try {
        const contactId = member.recordId;

        console.log("Processing Contact:", contactId);

        // FETCH CONTACT
        const contactResponse = await fetch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=phone`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );

        const contactData = await contactResponse.json();

        const phone = contactData?.properties?.phone;

        console.log("Phone:", phone);

        if (!phone) {
          batchJob.failed++;

          console.log("No phone found");

          continue;
        }

        const { normalizedPhone, data: veracityData } =
          await validatePhoneWithVeracity(phone, contactId);

        console.log(
          `Validation completed for ${contactId} - ${
            veracityData.success ? "VALID" : "INVALID"
          }`,
        );

        // HUBSPOT UPDATE
        await updateHubSpotContact(accessToken, contactId, {
          veracity_validation_status: veracityData.success
            ? "valid"
            : "invalid",

          veracity_carrier: veracityData?.data?.carrier_name || "",

          veracity_validated_at: new Date().toISOString(),

          bulk_validation_status: "completed",

          bulk_validation_summary: veracityData.success
            ? "Phone validated successfully"
            : "Invalid phone number detected",

          bulk_validated_at: new Date().toISOString(),
        });

        // COUNTERS
        batchJob.processed++;

        if (veracityData.success) {
          batchJob.valid++;
        } else {
          batchJob.invalid++;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error(
          `Validation failed for contact ${contactId}:`,
          error.message,
        );

        batchJob.failed++;
      }
    }

    batchJob.status = "completed";

    return sendSuccess(res, "Bulk validation completed successfully", {
      summary: {
        total: batchJob.total,
        processed: batchJob.processed,
        valid: batchJob.valid,
        invalid: batchJob.invalid,
        failed: batchJob.failed,
        status: batchJob.status,
      },
    });
  } catch (error) {
    console.error("Bulk validation error:", error.message);

    return sendError(res, 500, "Bulk validation failed");
  }
});

app.get("/hubspot-lists", async (req, res) => {
  try {
    console.log("Fetching HubSpot lists...");

    const accessToken = await getAccessToken();

    // const response = await fetch("https://api.hubapi.com/contacts/v1/lists", {
    //   method: "GET",
    //   headers: {
    //     Authorization: `Bearer ${accessToken}`,
    //     "Content-Type": "application/json",
    //   },
    // });

    const response = await fetch("https://api.hubapi.com/crm/v3/lists", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();

      console.error("Failed to fetch lists:", errorText);

      return sendError(res, 500, "Failed to fetch HubSpot lists");
    }

    const data = await response.json();

    console.log("LIST RESPONSE:", data);

    // const formattedLists = (data.lists || []).map((list) => ({
    //   label: `${list.name} (${list.metaData?.size || 0})`,
    //   value: String(list.listId),
    // }));

    const formattedLists = (data.results || []).map((list) => ({
      label: `${list.name} (${list.processingStatus?.totalRecords || 0})`,
      value: String(list.listId),
    }));

    console.log("FORMATTED LISTS:", formattedLists);

    return sendSuccess(res, "Lists fetched successfully", {
      lists: formattedLists,
    });
  } catch (error) {
    console.error("List fetch error:", error.message);

    return sendError(res, 500, "Unable to fetch lists");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
