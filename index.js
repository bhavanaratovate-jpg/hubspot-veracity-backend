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

app.get("/oauth/callback", async (req, res) => {
  try {
    const code = req.query.code;

    if (!code) {
      return res.send("No code received");
    }

    console.log("Auth Code:", code);

    // 🔥 TOKEN EXCHANGE
    const tokenResponse = await fetch("https://api.hubapi.com/oauth/v1/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: process.env.HUBSPOT_CLIENT_ID,
        client_secret: process.env.HUBSPOT_CLIENT_SECRET,
        redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
        code: code,
      }),
    });

    const data = await tokenResponse.json();

    console.log("Token Response:", data);

    if (!data.access_token) {
      console.error("OAuth Failed:", data);
      return res.send("OAuth failed: " + JSON.stringify(data));
    }

    return res.json({
      message: "OAuth successful",
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("OAuth error");
  }
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
      return res.status(400).json({
        success: false,
        message: "contactId is required",
      });
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
      return res.status(400).json({
        success: false,
        message: "Phone not found in HubSpot",
      });
    }

    const normalizedPhone = normalizePhone(phone_number);

    console.log("Calling Veracity API...");

    // 🔥 Veracity API call
    const response = await fetch(
      "https://api.veracityhub.io/v2/verify/carrier",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-TOKEN": process.env.VERACITY_API_KEY,
        },
        body: JSON.stringify({
          phone_number: normalizedPhone,
          contactId: "123",
        }),
      },
    );

    let data = {};

    try {
      const text = await response.text();
      console.log("Veracity RAW:", text);

      data = text ? JSON.parse(text) : {};
    } catch (err) {
      console.error("Veracity parse error:", err);
      return res.status(500).json({
        success: false,
        message: "Invalid response from Veracity API",
      });
    }

    console.log("Veracity Response:", data);

    console.log("Veracity completed");

    if (!data?.success) {
      return res.status(400).json({
        success: false,
        message: data?.message || "Phone validation failed",
      });
    }

    // 🔥 HubSpot update start

    // const accessToken = await getAccessToken();

    console.log("Updating HubSpot properties...");

    const hubspotResponse = await fetch(
      `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
      {
        method: "PATCH",
        headers: {
          // Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: {
            veracity_validation_status: data.success ? "valid" : "invalid",
            veracity_carrier: data.data?.carrier_name || "",
            veracity_validated_at: new Date().toISOString(),
          },
        }),
      },
    );

    if (!hubspotResponse.ok) {
      const errorText = await hubspotResponse.text();

      console.error("HubSpot update failed:", errorText);

      return res.status(500).json({
        success: false,
        message: "Failed to update HubSpot properties",
      });
    }

    let hubspotData = {};

    try {
      const text = await hubspotResponse.text();
      console.log("HubSpot RAW:", text);

      hubspotData = text ? JSON.parse(text) : {};

      console.log("HubSpot update completed");
    } catch (err) {
      console.error("HubSpot parse error:", err);
    }

    console.log("===== REQUEST END =====");

    // ✅ Clean response
    return res.json({
      success: data?.success ?? false,
      message: data?.message || "No response",
      normalized_phone: normalizedPhone,
      carrier: data?.data?.carrier_name || "",
      type: data?.data?.carrier_type || "",
      status: data?.data?.line_status || "",
      risk: data?.data?.veracity_risk_score || "",
      request_id: data?.request_id || "",
    });
  } catch (error) {
    console.error("Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
