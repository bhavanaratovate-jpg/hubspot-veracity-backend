const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
require("dotenv").config();
const db = require("./database");
const crypto = require("crypto");

// function validatePortalAccess(req, res, next) {
//   const portalId = req.body?.portalId || req.query?.portalId;

//   if (!portalId) {
//     return sendError(res, 400, "portalId is required");
//   }

//   db.get(
//     `
//     SELECT *
//     FROM oauth_tokens
//     WHERE portalId = ?
//   `,
//     [portalId],
//     (err, row) => {
//       if (err || !row) {
//         return sendError(res, 403, "Unauthorized portal");
//       }

//       next();
//     },
//   );
// }

// const ENCRYPTION_KEY = crypto
//   .createHash("sha256")
//   .update(process.env.ENCRYPTION_KEY)
//   .digest();

async function validatePortalAccess(req, res, next) {
  try {
    const portalId = req.body?.portalId || req.query?.portalId;

    if (!portalId) {
      return sendError(res, 400, "portalId is required");
    }

    const result = await db.query(
      `
      SELECT *
      FROM oauth_tokens
      WHERE portalId = $1
      `,
      [portalId],
    );

    const row = result.rows[0];

    if (!row) {
      return sendError(res, 403, "Unauthorized portal");
    }

    next();
  } catch (error) {
    console.error("Portal validation error:", error.message);

    return sendError(res, 500, "Portal validation failed");
  }
}

// const encryptionSecret = process.env.ENCRYPTION_KEY || "test-encryption-key";

const encryptionSecret = process.env.ENCRYPTION_KEY;

const ENCRYPTION_KEY = crypto
  .createHash("sha256")
  .update(encryptionSecret)
  .digest();

function encrypt(text) {
  if (!text) return "";

  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);

  let encrypted = cipher.update(text, "utf8", "hex");

  encrypted += cipher.final("hex");

  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(text) {
  if (!text) return "";

  const parts = text.split(":");

  const iv = Buffer.from(parts.shift(), "hex");

  const encryptedText = parts.join(":");

  const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);

  let decrypted = decipher.update(encryptedText, "hex", "utf8");

  decrypted += decipher.final("utf8");

  return decrypted;
}

const metrics = {
  totalCalls: 0,

  successCount: 0,

  failureCount: 0,

  totalLatency: 0,
};

const ALERT_THRESHOLD = 0.3;

// const MAX_CONCURRENT_BATCHES = 5;

const requiredEnvVars = [
  // "VERACITY_API_KEY",
  "HUBSPOT_CLIENT_ID",
  "HUBSPOT_CLIENT_SECRET",
  // "HUBSPOT_REFRESH_TOKEN",
  "HUBSPOT_REDIRECT_URI",
  "ENCRYPTION_KEY",
];

// requiredEnvVars.forEach((key) => {
//   if (!process.env[key]) {
//     console.error(`Missing environment variable: ${key}`);
//     process.exit(1);
//   }
// });

if (process.env.NODE_ENV !== "test") {
  requiredEnvVars.forEach((key) => {
    if (!process.env[key]) {
      console.error(`Missing environment variable: ${key}`);

      process.exit(1);
    }
  });
}

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

let propertyMappings = {
  phoneProperty: "phone",

  validationStatusProperty: "veracity_validation_status",

  carrierProperty: "veracity_carrier",

  validatedAtProperty: "veracity_validated_at",

  failureReasonProperty: "veracity_failure_reason",

  storeNormalizedPhone: false,

  overwriteExisting: true,
};

let cachedAccessToken = null;
let tokenExpiryTime = null;

let requestCounter = {};

// Test route
app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

function maskPhone(phone) {
  if (!phone) return "";

  const cleaned = String(phone);

  if (cleaned.length <= 4) {
    return "****";
  }

  return (
    cleaned.slice(0, 4) + "*".repeat(cleaned.length - 6) + cleaned.slice(-2)
  );
}

app.get("/install", (req, res) => {
  const installUrl =
    `https://app.hubspot.com/oauth/authorize` +
    `?client_id=${process.env.HUBSPOT_CLIENT_ID}` +
    `&scope=crm.objects.contacts.read crm.objects.contacts.write crm.objects.companies.read crm.objects.companies.write crm.lists.read` +
    `&redirect_uri=${process.env.HUBSPOT_REDIRECT_URI}`;

  res.redirect(installUrl);
});

app.get("/oauth/callback", async (req, res) => {
  try {
    // console.log("OAuth callback hit");

    logInfo("OAuth callback hit");

    const { code } = req.query;

    // console.log("Auth Code:", code);

    // logInfo("OAuth auth code received", {
    //   code,
    // });

    logInfo("OAuth auth code received");

    const response = await fetch("https://api.hubapi.com/oauth/v1/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: process.env.HUBSPOT_CLIENT_ID,
        client_secret: process.env.HUBSPOT_CLIENT_SECRET,
        redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
        code,
      }),
    });

    const tokenResponse = await response.json();

    // console.log("TOKEN RESPONSE:", tokenResponse);

    console.log("OAuth token generated successfully");

    // db.run(
    //   `INSERT OR REPLACE INTO oauth_tokens
    //   (portalId, accessToken, refreshToken)
    //   VALUES (?, ?, ?)
    //   `,
    //   [
    //     tokenResponse.hub_id,
    //     // tokenResponse.access_token,
    //     // tokenResponse.refresh_token,

    //     encrypt(tokenResponse.access_token),
    //     encrypt(tokenResponse.refresh_token),
    //   ],
    //   (err) => {
    //     if (err) {
    //       console.log("TOKEN SAVE ERROR:", err.message);
    //     } else {
    //       // console.log("TOKEN SAVED SUCCESSFULLY");
    //       logInfo("OAuth token saved successfully", {
    //         portalId: tokenResponse.hub_id,
    //       });

    //       // db.all("SELECT * FROM oauth_tokens", [], (err, rows) => {
    //       //   console.log(rows);
    //       // });
    //     }
    //   },
    // );

    try {
      await db.query(
        `
    

    INSERT INTO oauth_tokens (
  portalid,
  accesstoken,
  refreshtoken
)
    VALUES ($1, $2, $3)

    ON CONFLICT (portalid)
    DO UPDATE SET
      accesstoken = EXCLUDED.accesstoken,
      refreshtoken = EXCLUDED.refreshtoken
    `,
        [
          tokenResponse.hub_id,
          encrypt(tokenResponse.access_token),
          encrypt(tokenResponse.refresh_token),
        ],
      );

      logInfo("OAuth token saved successfully", {
        portalId: tokenResponse.hub_id,
      });
    } catch (err) {
      console.log("TOKEN SAVE ERROR:", err.message);
    }

    res.send("OAuth token generated successfully");
  } catch (error) {
    console.error(error.response?.data || error.message);

    res.status(500).send("OAuth failed");
  }
});

app.get("/privacy-policy", (req, res) => {
  res.send(`
      <h1>
        Privacy Policy
      </h1>

      <p>
        This application stores
        phone validation status,
        carrier information,
        and timestamps for
        HubSpot CRM records.
      </p>

      <p>
        OAuth tokens are used
        only for authorized
        HubSpot access.
      </p>

      <p>
        Data older than the
        configured retention
        period may be
        automatically deleted.
      </p>
    `);
});

function sanitizeLogData(data = {}) {
  const cloned = { ...data };

  if (cloned.phone) {
    cloned.phone = maskPhone(cloned.phone);
  }

  return cloned;
}

function logInfo(message, data = {}) {
  console.log(
    JSON.stringify({
      level: "INFO",
      message,
      data: sanitizeLogData(data),
      timestamp: new Date().toISOString(),
    }),
  );
}

function logError(message, error = {}) {
  console.error(
    JSON.stringify({
      level: "ERROR",
      message,
      error: sanitizeLogData(
        error?.message ? { message: error.message } : error,
      ),
      timestamp: new Date().toISOString(),
    }),
  );
}

function getAverageLatency() {
  if (metrics.totalCalls === 0) {
    return 0;
  }

  return metrics.totalLatency / metrics.totalCalls;
}

function checkHighErrorRate() {
  if (metrics.totalCalls < 5) {
    return;
  }

  const errorRate = metrics.failureCount / metrics.totalCalls;

  if (errorRate >= ALERT_THRESHOLD) {
    logError("HIGH ERROR RATE ALERT", {
      totalCalls: metrics.totalCalls,

      failureCount: metrics.failureCount,

      errorRate: (errorRate * 100).toFixed(2) + "%",
    });
  }
}

app.post("/validate-from-hubspot", (req, res) => {
  console.log("HubSpot Button Clicked ✅");
  // console.log("Body:", req.body);

  console.log("Validation request received");

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

async function validatePhoneWithVeracity(phone, contactId, apiKey) {
  const normalizedPhone = normalizePhone(phone);

  const retryDelays = [1000, 2000, 5000];

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      console.log(`Veracity attempt ${attempt + 1}`);

      const response = await fetch(
        // "https://api.veracityhub.io/v2/verify/carrier",
        "https://dev.api.veracityhub.io/v2/verify/carrier",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // "X-API-TOKEN": apiKey || process.env.VERACITY_API_KEY,
            "X-API-TOKEN": apiKey,
          },
          body: JSON.stringify({
            phone_number: normalizedPhone,
            contactId: contactId,
          }),
        },
      );

      console.log("VERACITY STATUS:", response.status);

      const rawText = await response.text();

      console.log("VERACITY RAW RESPONSE:", rawText);

      // if (!response.ok) {
      //   if (response.status >= 500 || response.status === 429) {
      //     throw new Error(`Transient API failure: ${response.status}`);
      //   }

      //   throw new Error("Veracity API request failed");
      // }

      if (!response.ok) {
        let errorData = {};

        try {
          errorData = rawText ? JSON.parse(rawText) : {};
        } catch (e) {}

        const apiMessage =
          errorData?.message ||
          errorData?.error ||
          `Veracity API failed (${response.status})`;

        const classifiedError = classifyVeracityError(
          new Error(apiMessage),
          errorData,
        );

        throw new Error(classifiedError.userMessage);
      }

      // const data = await response.json();

      const data = rawText ? JSON.parse(rawText) : {};

      return {
        normalizedPhone,
        data,
      };
    } catch (error) {
      console.error(`Retry ${attempt + 1} failed:`, error.message);

      // const classifiedError = classifyVeracityError(error);

      const classifiedError = classifyVeracityError(error, {
        message: error.message,
      });

      console.log("Error classification:", classifiedError);

      // if (classifiedError.type === "permanent") {

      if (
        classifiedError.type === "permanent" ||
        classifiedError.type === "auth"
      ) {
        throw new Error(classifiedError.userMessage);
      }

      if (attempt === 2) {
        throw new Error(classifiedError.userMessage);
      }

      await wait(retryDelays[attempt]);
    }
  }
}

async function updateHubSpotObject(
  accessToken,
  objectType,
  recordId,
  properties,
) {
  const response = await fetch(
    // `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
    `https://api.hubapi.com/crm/v3/objects/${objectType}/${recordId}`,
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

  // if (!response.ok) {
  //   // throw new Error(`HubSpot update failed for contact ${contactId}`);
  //   throw new Error(`HubSpot update failed for ${objectType} ${recordId}`);
  // }

  if (!response.ok) {
    const errorText = await response.text();

    console.log("HUBSPOT UPDATE ERROR:", errorText);

    throw new Error(`HubSpot update failed for ${objectType} ${recordId}`);
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

// function getMappings(portalId) {
//   return new Promise((resolve, reject) => {
//     db.get(
//       `SELECT * FROM mappings WHERE portalId = ?`,
//       // ["default"],
//       [portalId],
//       (err, row) => {
//         if (err) {
//           reject(err);
//         } else {
//           resolve(
//             row || {
//               phoneProperty: "phone",
//               validationStatusProperty: "veracity_validation_status",
//               carrierProperty: "veracity_carrier",
//               validatedAtProperty: "veracity_validated_at",
//               veracityApiKey: "",
//               rateLimitPerHour: 100,
//               retentionDays: 30,
//               failureReasonProperty: "veracity_failure_reason",
//               normalizedPhoneProperty: "veracity_normalized_phone",
//               storeNormalizedPhone: false,
//               maxConcurrentWorkers: 5,
//             },
//           );
//         }
//       },
//     );
//   });
// }

async function getMappings(portalId) {
  try {
    const result = await db.query(
      // `SELECT * FROM mappings WHERE portalId = $1`,
      // [portalId],

      `
  SELECT
    id,
    portalid AS "portalId",
    phoneproperty AS "phoneProperty",
    validationstatusproperty AS "validationStatusProperty",
    carrierproperty AS "carrierProperty",
    validatedatproperty AS "validatedAtProperty",
    veracityapikey AS "veracityApiKey",
    ratelimitperhour AS "rateLimitPerHour",
    retentiondays AS "retentionDays",
    overwriteexisting AS "overwriteExisting",
    failurereasonproperty AS "failureReasonProperty",
    normalizedphoneproperty AS "normalizedPhoneProperty",
    storenormalizedphone AS "storeNormalizedPhone",
    bulkveracityapikey AS "bulkVeracityApiKey",
bulkratelimitperhour AS "bulkRateLimitPerHour",
bulkretentiondays AS "bulkRetentionDays",
bulkvalidationstatusproperty AS "bulkValidationStatusProperty",
bulkvalidationsummaryproperty AS "bulkValidationSummaryProperty",
bulkvalidatedatproperty AS "bulkValidatedAtProperty"
  FROM mappings
  WHERE portalid = $1
  `,
      [portalId],
    );

    const row = result.rows[0];

    return (
      row || {
        phoneProperty: "phone",
        validationStatusProperty: "veracity_validation_status",
        carrierProperty: "veracity_carrier",
        validatedAtProperty: "veracity_validated_at",
        veracityApiKey: "",
        rateLimitPerHour: 100,
        retentionDays: 30,
        failureReasonProperty: "veracity_failure_reason",
        normalizedPhoneProperty: "veracity_normalized_phone",
        storeNormalizedPhone: false,
        maxConcurrentWorkers: 5,
        bulkVeracityApiKey: "",
        bulkRateLimitPerHour: 100,
        bulkRetentionDays: 30,
      }
    );
  } catch (error) {
    console.error("Get mappings error:", error.message);
    throw error;
  }
}

async function getBulkMappings(portalId) {
  try {
    const result = await db.query(
      `
      SELECT
        portalid AS "portalId",
        bulkveracityapikey AS "bulkVeracityApiKey",
        bulkratelimitperhour AS "bulkRateLimitPerHour",
        bulkretentiondays AS "bulkRetentionDays",
        bulkvalidationstatusproperty AS "bulkValidationStatusProperty",
        bulkvalidationsummaryproperty AS "bulkValidationSummaryProperty",
        bulkvalidatedatproperty AS "bulkValidatedAtProperty"
      FROM bulk_mappings
      WHERE portalid = $1
      `,
      [portalId],
    );

    return (
      result.rows[0] || {
        bulkVeracityApiKey: "",
        bulkRateLimitPerHour: 100,
        bulkRetentionDays: 30,
      }
    );
  } catch (error) {
    console.error("Get bulk mappings error:", error.message);
    throw error;
  }
}

async function getAccessToken(portalId) {
  try {
    // ✅ token still valid
    if (cachedAccessToken && tokenExpiryTime && Date.now() < tokenExpiryTime) {
      console.log("Using cached access token");
      return cachedAccessToken;
    }

    console.log("Generating new access token");

    // const tokenData = await new Promise((resolve, reject) => {
    //   db.get(
    //     `SELECT * FROM oauth_tokens WHERE portalId = ?`,
    //     [portalId],
    //     (err, row) => {
    //       if (err) {
    //         reject(err);
    //       } else {
    //         resolve(row);
    //       }
    //     },
    //   );
    // });

    const result = await db.query(
      // `SELECT * FROM oauth_tokens WHERE portalId = $1`,

      //     `SELECT
      //   "portalId" AS "portalId",
      //   "accessToken" AS "accessToken",
      //   "refreshToken" AS "refreshToken"
      // FROM oauth_tokens
      // WHERE "portalId" = $1
      // `

      `SELECT
      portalid AS "portalId",
      accesstoken AS "accessToken",
      refreshtoken AS "refreshToken"
      FROM oauth_tokens
      WHERE portalid = $1
      `,
      [portalId],
    );

    const tokenData = result.rows[0];

    if (!tokenData) {
      throw new Error("No OAuth token found for portal");
    }

    const response = await fetch("https://api.hubapi.com/oauth/v1/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.HUBSPOT_CLIENT_ID,
        client_secret: process.env.HUBSPOT_CLIENT_SECRET,
        // refresh_token: process.env.HUBSPOT_REFRESH_TOKEN,
        // refresh_token: tokenData.refreshToken,
        refresh_token: decrypt(tokenData.refreshToken),
      }),
    });

    const data = await response.json();

    console.log("TOKEN RESPONSE:", data);

    if (!data.access_token) {
      throw new Error("Failed to generate access token");
    }

    cachedAccessToken = data.access_token;

    // ✅ expire before actual expiry for safety
    tokenExpiryTime = Date.now() + (data.expires_in - 60) * 1000;

    console.log("New access token generated");

    return cachedAccessToken;
  } catch (error) {
    // console.error("Token Refresh Error:", error.message);
    logError("Token refresh failed", error);
    throw error;
  }
}

// async function checkRateLimit(portalId, limitPerHour) {
//   return new Promise((resolve, reject) => {
//     db.get(
//       `
//       SELECT COUNT(*) as total
//       FROM validation_logs
//       WHERE portalId = ?
//       AND createdAt >= datetime('now', '-1 hour')
//       `,
//       [portalId],
//       (err, row) => {
//         if (err) {
//           reject(err);
//         } else {
//           resolve(row.total < Number(limitPerHour));
//         }
//       },
//     );
//   });
// }

async function checkRateLimit(portalId, limitPerHour) {
  try {
    const result = await db.query(
      `
      SELECT COUNT(*) as total
      FROM validation_logs
      WHERE portalId = $1
      AND createdat >= NOW() - INTERVAL '1 hour'
      `,
      [portalId],
    );

    const total = Number(result.rows[0].total);

    return total < Number(limitPerHour);
  } catch (error) {
    console.error("Rate limit check failed:", error.message);
    throw error;
  }
}

function checkRequestsPerSecond(portalId, limit) {
  const now = Math.floor(Date.now() / 1000);

  const key = `${portalId}-${now}`;

  requestCounter[key] = (requestCounter[key] || 0) + 1;

  return requestCounter[key] <= limit;
}

// function cleanupOldLogs() {
//   db.all(`SELECT portalId, retentionDays FROM mappings`, [], (err, rows) => {
//     if (err) {
//       console.error("Cleanup fetch failed:", err.message);
//       return;
//     }

//     rows.forEach((row) => {
//       db.run(
//         `
//           DELETE FROM validation_logs
//           db.run(`
//           DELETE FROM audit_logs
//           WHERE createdAt <
//           datetime(
//             'now',
//             '-' || ? || ' days'
//           )`,
//           [retentionDays]
//           );
//           WHERE portalId = ?
//           AND createdAt < datetime(
//             'now',
//             '-' || ? || ' days'
//           )
//         `,
//         [row.portalId, row.retentionDays],
//         (deleteErr) => {
//           if (deleteErr) {
//             console.error("Cleanup delete failed:", deleteErr.message);
//           } else {
//             console.log(`Old logs cleaned for portal ${row.portalId}`);
//           }
//         },
//       );
//     });
//   });
// }

// function cleanupOldLogs() {
//   db.all(`SELECT portalId, retentionDays FROM mappings`, [], (err, rows) => {
//     if (err) {
//       console.error("Cleanup fetch failed:", err.message);

//       return;
//     }

//     rows.forEach((row) => {
//       db.run(
//         `
//           DELETE FROM validation_logs
//           WHERE portalId = ?
//           AND createdAt < datetime(
//             'now',
//             '-' || ? || ' days'
//           )
//         `,
//         [row.portalId, row.retentionDays],
//       );

//       db.run(
//         `
//           DELETE FROM audit_logs
//           WHERE portalId = ?
//           AND createdAt < datetime(
//             'now',
//             '-' || ? || ' days'
//           )
//         `,
//         [row.portalId, row.retentionDays],
//         (deleteErr) => {
//           if (deleteErr) {
//             console.error("Cleanup delete failed:", deleteErr.message);
//           } else {
//             console.log(`Old logs cleaned for portal ${row.portalId}`);
//           }
//         },
//       );
//     });
//   });
// }

async function cleanupOldLogs() {
  try {
    const result = await db.query(`
      SELECT portalId, retentionDays
      FROM mappings
    `);

    const rows = result.rows;

    for (const row of rows) {
      await db.query(
        `
        DELETE FROM validation_logs
        WHERE portalId = $1
        AND createdat < NOW() - ($2 || ' days')::INTERVAL
        `,
        [row.portalId, row.retentionDays],
      );

      await db.query(
        `
        DELETE FROM audit_logs
        WHERE portalId = $1
        AND createdat < NOW() - ($2 || ' days')::INTERVAL
        `,
        [row.portalId, row.retentionDays],
      );

      console.log(`Old logs cleaned for portal ${row.portalId}`);
    }
  } catch (error) {
    console.error("Cleanup failed:", error.message);
  }
}

// function createAuditLog(
//   portalId,
//   contactId,
//   action,
//   status,
//   message,
//   carrier = "",
// ) {
//   db.run(
//     `
//     INSERT INTO audit_logs (
//       portalId,
//       contactId,
//       action,
//       status,
//       message,
//       carrier
//     )
//     VALUES (?, ?, ?, ?, ?, ?)
//   `,
//     [portalId, contactId, action, status, message, carrier],
//   );
// }

async function createAuditLog(
  portalId,
  contactId,
  action,
  status,
  message,
  carrier = "",
) {
  try {
    await db.query(
      `
      INSERT INTO audit_logs (
        portalId,
        contactId,
        action,
        status,
        message,
        carrier
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [portalId, contactId, action, status, message, carrier],
    );
  } catch (error) {
    console.error("Audit log insert failed:", error.message);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// async function processBatchChunk(
//   members,
//   accessToken,
//   propertyMappings,
//   portalId,
//   batchJob,
//   batchJobId,
// ) {
//   await Promise.all(
//     members.map(async (member) => {
//       const allowed = await checkRateLimit(
//         portalId,
//         propertyMappings.rateLimitPerHour,
//       );

//       if (!allowed) {
//         console.log("Bulk rate limit exceeded");
//         return;
//       }

//       try {
//         const contactId = member.recordId;

//         console.log("Processing Contact:", contactId);

//         const contactResponse = await fetch(
//           `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=${propertyMappings.phoneProperty}`,
//           {
//             headers: {
//               Authorization: `Bearer ${accessToken}`,
//             },
//           },
//         );

//         const contactData = await contactResponse.json();

//         const phone = contactData?.properties?.[propertyMappings.phoneProperty];

//         console.log("Phone:", maskPhone(phone));

//         if (!phone) {
//           batchJob.failed++;
//           return;
//         }

//         const { normalizedPhone, data: veracityData } =
//           await validatePhoneWithVeracity(
//             phone,
//             contactId,
//             decrypt(propertyMappings.veracityApiKey),
//           );

//         const hubspotProperties = {
//           [propertyMappings.validationStatusProperty]: veracityData.success
//             ? "valid"
//             : "invalid",

//           [propertyMappings.carrierProperty]:
//             veracityData?.data?.carrier_name || "",

//           [propertyMappings.validatedAtProperty]: new Date().toISOString(),

//           bulk_validation_status: "completed",

//           bulk_validation_summary: veracityData.success
//             ? "Phone validated successfully"
//             : "Invalid phone number detected",

//           bulk_validated_at: new Date().toISOString(),
//         };

//         if (
//           propertyMappings.storeNormalizedPhone &&
//           propertyMappings.normalizedPhoneProperty
//         ) {
//           hubspotProperties[propertyMappings.normalizedPhoneProperty] =
//             normalizedPhone;
//         }

//         await updateHubSpotObject(
//           accessToken,
//           "contacts",
//           contactId,
//           hubspotProperties,
//         );

//         db.run(
//           `INSERT INTO validation_logs (portalId)
//            VALUES (?)`,
//           [portalId],
//         );

//         batchJob.processed++;

//         if (veracityData.success) {
//           batchJob.valid++;
//         } else {
//           batchJob.invalid++;
//         }

//         db.run(
//           `UPDATE batch_jobs
//            SET
//            processed = ?,
//            valid = ?,
//            invalid = ?,
//            failed = ?
//            WHERE id = ?`,
//           [
//             batchJob.processed,
//             batchJob.valid,
//             batchJob.invalid,
//             batchJob.failed,
//             batchJobId,
//           ],
//         );
//       } catch (error) {
//         console.error(`Validation failed for contact:`, error.message);

//         batchJob.failed++;
//       }
//     }),
//   );
// }

// function classifyVeracityError(error, responseData = {}) {
//   const message = responseData?.message?.toLowerCase() || "";

//   if (message.includes("invalid") || message.includes("format")) {
//     return {
//       type: "permanent",
//       userMessage: "Invalid phone number format.",
//     };
//   }

//   if (message.includes("blocked")) {
//     return {
//       type: "permanent",
//       userMessage: "Phone number is blocked.",
//     };
//   }

//   if (message.includes("unsupported")) {
//     return {
//       type: "permanent",
//       userMessage: "Unsupported phone number country.",
//     };
//   }

//   if (
//     error.message.includes("429") ||
//     error.message.includes("500") ||
//     error.message.includes("timeout") ||
//     error.message.includes("Transient")
//   ) {
//     return {
//       type: "transient",
//       userMessage: "Temporary validation issue. Retrying...",
//     };
//   }

//   // return {
//   //   type: "unknown",
//   //   userMessage: "Phone validation failed. Please try again later.",
//   // };

//   if (error.message?.includes("Invalid API token")) {
//     return {
//       type: "auth",
//       userMessage: "Invalid Veracity API Key",
//     };
//   }
// }

function classifyVeracityError(error, responseData = {}) {
  const message =
    responseData?.message?.toLowerCase() ||
    responseData?.error?.toLowerCase() ||
    "";

  // if (message.includes("invalid api token")) {
  //   return {
  //     type: "auth",
  //     userMessage: "Invalid Veracity API Key",
  //   };
  // }

  if (
    message.includes("invalid api token") ||
    message.includes("invalid veracity api key")
  ) {
    return {
      type: "auth",
      userMessage: "Invalid Veracity API Key",
    };
  }

  // if (message.includes("invalid") || message.includes("format")) {
  // if (
  //   (message.includes("invalid") &&
  //     !message.includes("api token") &&
  //     !message.includes("api key")) ||
  //   message.includes("format")
  // )
  if (
    (message.includes("invalid") && !message.includes("api")) ||
    message.includes("format")
  ) {
    return {
      type: "permanent",
      userMessage: "Invalid phone number format.",
    };
  }

  if (message.includes("blocked")) {
    return {
      type: "permanent",
      userMessage: "Phone number is blocked.",
    };
  }

  if (message.includes("unsupported")) {
    return {
      type: "permanent",
      userMessage: "Unsupported phone number country.",
    };
  }

  if (
    error.message.includes("429") ||
    error.message.includes("500") ||
    error.message.includes("timeout") ||
    error.message.includes("Transient")
  ) {
    return {
      type: "transient",
      userMessage: "Temporary validation issue. Retrying...",
    };
  }

  return {
    type: "unknown",
    userMessage: "Phone validation failed. Please try again later.",
  };
}

// MAIN API
app.post("/validate-phone", async (req, res) => {
  console.log("===== REQUEST START =====");

  const requestStart = Date.now();

  const requestId = Date.now().toString();

  metrics.totalCalls++;

  let portalId = "";
  let contactId = "";
  let objectType = "";

  try {
    // console.log("Fetching contact from HubSpot...");

    // console.log("BODY:", req.body);

    console.log("Validation request received");

    contactId = req.body.contactId;

    objectType = req.body.objectType;

    portalId = req.body.portalId;

    logInfo("Fetching contact from HubSpot", {
      portalId,
      contactId,
    });

    // ✅ Now using phone_number everywhere
    // const { phone_number, contactId } = req.body;

    // const { contactId, objectType } = req.body;

    // const portalId = req.body.portalId;

    // const { objectType } = req.body;

    if (!contactId) {
      return sendError(res, 400, "contactId is required");
    }

    const hubspotObjectType =
      objectType === "companies" ? "companies" : "contacts";

    console.log("STEP 1");

    // const propertyMappings = await getMappings();
    // const propertyMappings = await getMappings(req.body.portalId);
    const propertyMappings = await getMappings(portalId);

    console.log("STEP 2", propertyMappings);

    const allowed = await checkRateLimit(
      portalId,
      propertyMappings.rateLimitPerHour,
      // propertyMappings.ratelimitperhour,
    );

    console.log("STEP 3", allowed);

    if (!allowed) {
      return sendError(res, 429, "Rate limit exceeded for this portal");
    }

    const allowedPerSecond = checkRequestsPerSecond(
      portalId,
      propertyMappings.maxRequestsPerSecond || 10,
    );

    if (!allowedPerSecond) {
      return sendError(res, 429, "Too many requests per second");
    }

    console.log("Contact ID:", contactId);

    console.log("Fetching contact from HubSpot...");

    // 🔥 HubSpot से phone fetch करो
    const accessToken = await getAccessToken(portalId);

    const contactRes = await fetch(
      // `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=phone`,
      // `https://api.hubapi.com/crm/v3/objects/${hubspotObjectType}/${contactId}?properties=${propertyMappings.phoneProperty}`,
      `https://api.hubapi.com/crm/v3/objects/${hubspotObjectType}/${contactId}?properties=${propertyMappings.phoneProperty}&properties=${propertyMappings.validationStatusProperty}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    const contactData = await contactRes.json();

    // console.log("HubSpot Contact RAW:", contactData);

    console.log("HubSpot Contact fetched successfully");

    console.log("HubSpot Contact:", {
      id: contactData.id,
    });

    // const phone_number = contactData?.properties?.phone;
    const phone_number =
      contactData?.properties?.[propertyMappings.phoneProperty];

    // const alreadyValidated =
    //   contactData?.properties?.[propertyMappings.validationStatusProperty];

    // if (!propertyMappings.overwriteExisting && alreadyValidated) {
    //   console.log(`Skipping ${contactId} because validation already exists`);

    //   return;
    // }

    const alreadyValidated =
      contactData?.properties?.[propertyMappings.validationStatusProperty];

    // if (propertyMappings.overwriteExisting === false && alreadyValidated) {

    // const overwriteEnabled = Boolean(propertyMappings.overwriteExisting);

    console.log("ALREADY VALIDATED:", alreadyValidated);

    // const overwriteEnabled = String(propertyMappings.overwriteExisting) === "1";

    // const overwriteEnabled = propertyMappings.overwriteExisting === true;

    const overwriteEnabled =
      String(propertyMappings.overwriteExisting) === "true" ||
      String(propertyMappings.overwriteExisting) === "1" ||
      propertyMappings.overwriteExisting === true;

    console.log("OVERWRITE:", overwriteEnabled);

    if (!overwriteEnabled && alreadyValidated) {
      console.log(`Skipping ${contactId} because validation already exists`);

      return sendSuccess(res, "Validation already exists", {
        skipped: true,
      });
    }

    // console.log("Fetched Phone:", phone_number);

    console.log("Fetched Phone:", maskPhone(phone_number));

    logInfo("Validation request started", {
      requestId,
      portalId,
      contactId,
      phone: maskPhone(phone_number),
    });

    if (!phone_number) {
      return sendError(res, 400, "Phone not found in HubSpot");
    }

    // console.log("Calling Veracity API...");

    // const { normalizedPhone, data } = await validatePhoneWithVeracity(
    //   phone_number,
    //   contactId,
    //   // propertyMappings.veracityApiKey,
    //   decrypt(propertyMappings.veracityApiKey),
    // );

    console.log("Calling Veracity API...");

    // const decryptedApiKey = decrypt(propertyMappings.veracityApiKey);

    let decryptedApiKey = "";

    try {
      decryptedApiKey = decrypt(propertyMappings.veracityApiKey);
    } catch (e) {
      return sendError(res, 400, "Invalid encrypted API key");
    }

    // if (!decryptedApiKey) {
    //   return sendError(res, 400, "Veracity API Key is required");
    // }

    if (!decryptedApiKey?.trim()) {
      // return sendError(res, 400, "Veracity API Key is required");
      throw new Error("Veracity API Key is required");
    }

    const { normalizedPhone, data } = await validatePhoneWithVeracity(
      phone_number,
      contactId,
      decryptedApiKey,
    );

    console.log("Veracity completed");

    if (!data?.success) {
      return sendError(res, 400, data?.message || "Phone validation failed");
    }

    // 🔥 HubSpot update start

    console.log("Updating HubSpot properties...");

    // console.log("VERACITY DATA:", data);

    console.log("Veracity validation completed successfully");

    console.log("FINAL HUBSPOT PROPERTIES:");

    console.log({
      [propertyMappings.validationStatusProperty]: data.success
        ? "valid"
        : "invalid",

      [propertyMappings.carrierProperty]: data.data?.carrier_name || "",

      [propertyMappings.validatedAtProperty]: new Date().toISOString(),
    });

    // if (!propertyMappings.overwriteExisting) {
    //   const alreadyValidated =
    //     contactData?.properties?.[propertyMappings.validationStatusProperty];

    //   if (alreadyValidated) {
    //     return sendError(res, 400, "Validation already exists");
    //   }
    // }

    const hubspotProperties = {
      [propertyMappings.validationStatusProperty]: data.success
        ? "valid"
        : "invalid",

      [propertyMappings.carrierProperty]: data.data?.carrier_name || "",

      [propertyMappings.validatedAtProperty]: new Date().toISOString(),

      [propertyMappings.failureReasonProperty]: "",
    };

    // if (
    //   propertyMappings.storeNormalizedPhone &&
    //   propertyMappings.normalizedPhoneProperty
    // ) {
    //   hubspotProperties[propertyMappings.normalizedPhoneProperty] =
    //     normalizedPhone;
    // }

    // if (
    //   propertyMappings.storeNormalizedPhone &&
    //   propertyMappings.normalizedPhoneProperty &&
    //   normalizedPhone
    // )

    // const shouldStoreNormalized =
    //   String(propertyMappings.storeNormalizedPhone) === "1" ||
    //   propertyMappings.storeNormalizedPhone === true;

    const shouldStoreNormalized =
      // propertyMappings.storeNormalizedPhone === true;

      String(propertyMappings.storeNormalizedPhone) === "true" ||
      String(propertyMappings.storeNormalizedPhone) === "1" ||
      propertyMappings.storeNormalizedPhone === true;

    console.log("STORE NORMALIZED:", propertyMappings.storeNormalizedPhone);

    // if (
    //   shouldStoreNormalized &&
    //   propertyMappings.normalizedPhoneProperty &&
    //   normalizedPhone
    // ) {
    //   const maskedPhone =
    //     normalizedPhone.length > 6
    //       ? `${normalizedPhone.slice(0, 4)}******${normalizedPhone.slice(-2)}`
    //       : normalizedPhone;

    //   hubspotProperties[propertyMappings.normalizedPhoneProperty] = maskedPhone;
    // }

    if (propertyMappings.normalizedPhoneProperty) {
      if (shouldStoreNormalized && normalizedPhone) {
        const maskedPhone =
          normalizedPhone.length > 6
            ? `${normalizedPhone.slice(0, 4)}******${normalizedPhone.slice(-2)}`
            : normalizedPhone;

        hubspotProperties[propertyMappings.normalizedPhoneProperty] =
          maskedPhone;
      } else {
        // clear old value when toggle OFF
        hubspotProperties[propertyMappings.normalizedPhoneProperty] = "";
      }
    }

    // await updateHubSpotObject(accessToken, hubspotObjectType, contactId,hubspotProperties, {
    //   [propertyMappings.validationStatusProperty]: data.success
    //     ? "valid"
    //     : "invalid",

    //   [propertyMappings.carrierProperty]: data.data?.carrier_name || "",

    //   [propertyMappings.validatedAtProperty]: new Date().toISOString(),
    // });

    await updateHubSpotObject(
      accessToken,
      hubspotObjectType,
      contactId,
      hubspotProperties,
    );

    createAuditLog(
      portalId,
      contactId,
      "validation",
      "success",
      "Phone validated successfully",
      data?.data?.carrier_name || "",
    );

    // db.run(
    //   `INSERT INTO validation_logs (portalId)
    //   VALUES (?)`,
    //   [portalId],
    // );

    await db.query(
      `
      INSERT INTO validation_logs (portalId)
      VALUES ($1)
       `,
      [portalId],
    );

    console.log("===== REQUEST END =====");

    metrics.successCount++;

    metrics.totalLatency += Date.now() - requestStart;

    checkHighErrorRate();

    logInfo("Validation success", {
      requestId,
      portalId,
      contactId,
      status: "success",
    });

    // ✅ Clean response
    return sendSuccess(res, data?.message || "Validation completed", {
      // normalized_phone: normalizedPhone,
      normalized_phone: maskPhone(normalizedPhone),
      carrier: data?.data?.carrier_name || "",
      type: data?.data?.carrier_type || "",
      status: data?.data?.line_status || "",
      risk: data?.data?.veracity_risk_score || "",
      request_id: data?.request_id || "",
    });
  } catch (error) {
    // console.error("Error:", error.message);

    metrics.failureCount++;

    metrics.totalLatency += Date.now() - requestStart;

    checkHighErrorRate();

    logError("Validation request failed", error);

    logError("Validation failed", {
      requestId,
      portalId,
      contactId,
      status: "failed",
      error: error.message,
    });

    // console.error("FULL ERROR:", error);

    console.error("FULL ERROR:", error.message);

    try {
      const accessToken = await getAccessToken(portalId);

      const propertyMappings = await getMappings(portalId);

      await updateHubSpotObject(
        accessToken,
        objectType === "companies" ? "companies" : "contacts",
        contactId,
        {
          [propertyMappings.failureReasonProperty]: error.message,
        },
      );
    } catch (hubspotError) {
      console.error("Failed to save failure reason:", hubspotError.message);
    }

    createAuditLog(
      portalId,
      contactId || "",
      "validation",
      "failed",
      error.message,
      "",
    );

    // return sendError(res, 500, "Something went wrong");

    return sendError(res, 500, error.message || "Phone validation failed");
  }
});

// Bulk/List
app.post("/bulk-validate", async (req, res) => {
  // const propertyMappings = await getMappings();
  // const propertyMappings = await getMappings(req.body.portalId);

  try {
    // const { listId } = req.body;

    const batchJobId = Date.now();

    const { listId, portalId } = req.body;

    const propertyMappings = await getMappings(portalId);

    const bulkMappings = await getBulkMappings(portalId);

    console.log("BULK MAPPINGS:", bulkMappings);

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
      skipped: 0,
      startedAt: new Date().toISOString(),
    };

    console.log("Batch Job Created:", batchJob);

    const accessToken = await getAccessToken(portalId);

    console.log("Fetching list members from HubSpot...");

    const listResponse = await fetch(
      `https://api.hubapi.com/crm/v3/lists/${listId}/memberships/join-order`,
      // `https://api.hubapi.com/contacts/v1/lists/${listId}/contacts/all`,
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

    batchJob.total = listData.total;

    batchJob.status = "running";

    // db.run(
    //   `INSERT INTO batch_jobs (
    //       id,
    //       portalId,
    //       listId,
    //       status,
    //       total
    //       )
    //       VALUES (?, ?, ?, ?, ?)
    //       `,
    //   [batchJobId, portalId, listId, "running", batchJob.total],
    // );

    await db.query(
      `
      INSERT INTO batch_jobs (
      id,
      portalId,
      listId,
      status,
      total
      )
      VALUES ($1, $2, $3, $4, $5)
      `,
      [batchJobId, portalId, listId, "running", batchJob.total],
    );

    const workerLimit = propertyMappings.maxConcurrentWorkers || 1;

    // const contacts = listData.contacts || [];
    const contacts = listData.results || [];

    console.log(`Fetched ${contacts.length} contacts from HubSpot`);

    batchJob.total = contacts.length;

    // for (let i = 0; i < listData.results.length; i += workerLimit) {
    //   const chunk = listData.results.slice(i, i + workerLimit);

    for (let i = 0; i < contacts.length; i += workerLimit) {
      const chunk = contacts.slice(i, i + workerLimit);

      await Promise.all(
        chunk.map(async (member) => {
          let contactId = "";
          // for (const member of listData.results) {
          const allowed = await checkRateLimit(
            portalId,
            // propertyMappings.rateLimitPerHour,
            bulkMappings.bulkRateLimitPerHour ||
              propertyMappings.rateLimitPerHour,
            // propertyMappings.ratelimitperhour,
          );

          if (!allowed) {
            console.log("Bulk rate limit exceeded");
            throw new Error("Bulk rate limit exceeded");
            // break;
          }
          try {
            // const contactId = member.recordId;

            // contactId = member.vid;

            contactId = member.recordId;

            // console.log("Processing Contact:", contactId);

            // const total = listData?.results?.length || 0;

            // FETCH CONTACT
            const contactResponse = await fetch(
              // `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=${propertyMappings.phoneProperty}`,
              `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=phone`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              },
            );

            const contactData = await contactResponse.json();

            console.log("CONTACT PROPERTIES:", contactData.properties);

            console.log("PHONE PROPERTY:", propertyMappings.phoneProperty);

            // const phone = contactData?.properties?.phone;
            // const phone =
            //   contactData?.properties?.[propertyMappings.phoneProperty];
            const phone = contactData?.properties?.phone;

            console.log("Phone:", maskPhone(phone));

            if (!phone) {
              batchJob.failed++;

              console.log("No phone found");

              // continue;

              return;
            }

            // const { normalizedPhone, data: veracityData } =
            //   await validatePhoneWithVeracity(
            //     phone,
            //     contactId,
            //     // propertyMappings.veracityApiKey,
            //     decrypt(propertyMappings.veracityApiKey),
            //   );

            // console.log(
            //   `Validation completed for ${contactId} - ${
            //     veracityData.success ? "VALID" : "INVALID"
            //   }`,
            // );

            // const decryptedApiKey = decrypt(propertyMappings.veracityApiKey);

            let decryptedApiKey = "";

            try {
              // decryptedApiKey = decrypt(propertyMappings.veracityApiKey);
              // decryptedApiKey = decrypt(propertyMappings.bulkVeracityApiKey);
              decryptedApiKey = decrypt(bulkMappings.bulkVeracityApiKey);
            } catch (e) {
              // return sendError(res, 400, "Invalid encrypted API key");

              throw new Error("Invalid encrypted API key");
            }

            // if (!decryptedApiKey) {
            //   throw new Error("Veracity API Key is required");
            // }

            if (!decryptedApiKey?.trim()) {
              // return sendError(res, 400, "Veracity API Key is required");
              throw new Error("Veracity API Key is required");
            }

            const { normalizedPhone, data: veracityData } =
              await validatePhoneWithVeracity(
                phone,
                contactId,
                decryptedApiKey,
              );

            // HUBSPOT UPDATE
            // await updateHubSpotObject(accessToken, "contacts", contactId, {
            //   [propertyMappings.validationStatusProperty]: veracityData.success
            //     ? "valid"
            //     : "invalid",

            //   [propertyMappings.carrierProperty]:
            //     veracityData?.data?.carrier_name || "",

            //   [propertyMappings.validatedAtProperty]: new Date().toISOString(),

            //   bulk_validation_status: "completed",

            //   bulk_validation_summary: veracityData.success
            //     ? "Phone validated successfully"
            //     : "Invalid phone number detected",

            //   bulk_validated_at: new Date().toISOString(),
            // });

            // const hubspotProperties = {
            //   [propertyMappings.validationStatusProperty]: veracityData.success
            //     ? "valid"
            //     : "invalid",

            //   [propertyMappings.carrierProperty]:
            //     veracityData?.data?.carrier_name || "",

            //   [propertyMappings.validatedAtProperty]: new Date().toISOString(),

            //   //  [propertyMappings.failureReasonProperty]: "",

            //   // bulk_validation_status: "completed",

            //   // bulk_validation_summary: veracityData.success
            //   //   ? "Phone validated successfully"
            //   //   : "Invalid phone number detected",

            //   // bulk_validated_at: new Date().toISOString(),

            //   [propertyMappings.bulkValidationStatusProperty]: "completed",

            //   [propertyMappings.bulkValidationSummaryProperty]:
            //     veracityData.success
            //       ? "Phone validated successfully"
            //       : "Invalid phone number detected",

            //   [propertyMappings.bulkValidatedAtProperty]:
            //     new Date().toISOString(),
            // };

            // const hubspotProperties = {
            //   [propertyMappings.validationStatusProperty]: veracityData.success
            //     ? "valid"
            //     : "invalid",

            //   [propertyMappings.carrierProperty]:
            //     veracityData?.data?.carrier_name || "",

            //   [propertyMappings.validatedAtProperty]: new Date().toISOString(),
            // };

            // if (bulkMappings.bulkValidationStatusProperty) {
            //   hubspotProperties[bulkMappings.bulkValidationStatusProperty] =
            //     "completed";
            // }

            // if (bulkMappings.bulkValidationSummaryProperty) {
            //   hubspotProperties[
            //     bulkMappings.bulkValidationSummaryProperty
            //   ] = veracityData.success
            //     ? "Phone validated successfully"
            //     : "Invalid phone number detected";
            // }

            // if (bulkMappings.bulkValidatedAtProperty) {
            //   hubspotProperties[bulkMappings.bulkValidatedAtProperty] =
            //     new Date().toISOString();
            // }

            // const hubspotProperties = {
            //   [propertyMappings.validationStatusProperty]: veracityData.success
            //     ? "valid"
            //     : "invalid",

            //   [propertyMappings.carrierProperty]:
            //     veracityData?.data?.carrier_name || "",

            //   [propertyMappings.validatedAtProperty]: new Date().toISOString(),
            // };

            const hubspotProperties = {};

            if (propertyMappings?.validationStatusProperty) {
              hubspotProperties[propertyMappings.validationStatusProperty] =
                veracityData.success ? "valid" : "invalid";
            }

            if (propertyMappings?.carrierProperty) {
              hubspotProperties[propertyMappings.carrierProperty] =
                veracityData?.data?.carrier_name || "";
            }

            if (propertyMappings?.validatedAtProperty) {
              hubspotProperties[propertyMappings.validatedAtProperty] =
                new Date().toISOString();
            }

            if (bulkMappings.bulkValidationStatusProperty) {
              hubspotProperties[bulkMappings.bulkValidationStatusProperty] =
                "completed";
            }

            if (bulkMappings.bulkValidationSummaryProperty) {
              hubspotProperties[bulkMappings.bulkValidationSummaryProperty] =
                veracityData.success
                  ? "Phone validated successfully"
                  : "Invalid phone number detected";
            }

            if (bulkMappings.bulkValidatedAtProperty) {
              hubspotProperties[bulkMappings.bulkValidatedAtProperty] =
                new Date().toISOString();
            }

            console.log("FINAL HUBSPOT PROPERTIES:", hubspotProperties);

            // if (
            //   propertyMappings.storeNormalizedPhone &&
            //   propertyMappings.normalizedPhoneProperty
            // ) {
            //   hubspotProperties[propertyMappings.normalizedPhoneProperty] =
            //     normalizedPhone;
            // }

            // if (
            //   propertyMappings.storeNormalizedPhone &&
            //   propertyMappings.normalizedPhoneProperty &&
            //   normalizedPhone
            // )

            // const shouldStoreNormalized =
            //   String(propertyMappings.storeNormalizedPhone) === "1" ||
            //   propertyMappings.storeNormalizedPhone === true;

            const shouldStoreNormalized =
              propertyMappings.storeNormalizedPhone === true;

            if (
              shouldStoreNormalized &&
              propertyMappings.normalizedPhoneProperty &&
              normalizedPhone
            ) {
              const maskedPhone =
                normalizedPhone.length > 6
                  ? `${normalizedPhone.slice(0, 4)}******${normalizedPhone.slice(-2)}`
                  : normalizedPhone;

              hubspotProperties[propertyMappings.normalizedPhoneProperty] =
                maskedPhone;
            }

            console.log("FINAL HUBSPOT PROPERTIES OBJECT:");
            console.log(hubspotProperties);

            await updateHubSpotObject(
              accessToken,
              "contacts",
              contactId,
              hubspotProperties,
            );

            // db.run(
            //   `INSERT INTO validation_logs (portalId)
            //   VALUES (?)`,
            //   [portalId],
            // );

            await db.query(
              `
              INSERT INTO validation_logs (portalId)
              VALUES ($1)
              `,
              [portalId],
            );

            // COUNTERS
            batchJob.processed++;

            if (veracityData.success) {
              batchJob.valid++;
            } else {
              batchJob.invalid++;
            }

            // db.run(
            //   `UPDATE batch_jobs
            //   SET
            //   processed = ?,
            //   valid = ?,
            //   invalid = ?,
            //   failed = ?
            //   WHERE id = ?
            //   `,
            //   [
            //     batchJob.processed,
            //     batchJob.valid,
            //     batchJob.invalid,
            //     batchJob.failed,
            //     batchJobId,
            //   ],
            // );

            await db.query(
              `
              UPDATE batch_jobs
              SET
              processed = $1,
              valid = $2,
              invalid = $3,
              failed = $4
              WHERE id = $5
              `,
              [
                batchJob.processed,
                batchJob.valid,
                batchJob.invalid,
                batchJob.failed,
                batchJobId,
              ],
            );

            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch (error) {
            console.error(
              `Validation failed for contact ${contactId}:`,
              error.message,
            );

            batchJob.failed++;
            // }
          }
        }),
      );
    }

    batchJob.status = "completed";

    // db.run(
    //   `UPDATE batch_jobs
    //   SET status = ?
    //   WHERE id = ?
    //   `,
    //   ["completed", batchJobId],
    // );

    await db.query(
      `
      UPDATE batch_jobs
      SET status = $1
      WHERE id = $2
      `,
      ["completed", batchJobId],
    );

    if (batchJob.processed === 0) {
      return sendError(
        res,
        400,
        "No contacts processed. Phone property missing.",
      );
    }

    return sendSuccess(res, "Bulk validation completed successfully", {
      summary: {
        total: batchJob.total,
        processed: batchJob.processed,
        valid: batchJob.valid,
        invalid: batchJob.invalid,
        failed: batchJob.failed,
        skipped: batchJob.skipped,
        status: batchJob.status,
      },
    });
  } catch (error) {
    // console.error("Bulk validation error:", error.message);
    logError("Bulk validation failed", error);

    return sendError(res, 500, "Bulk validation failed");
  }
});

app.get("/settings", validatePortalAccess, async (req, res) => {
  try {
    // db.get(
    //   `SELECT * FROM mappings WHERE portalId = ?`,
    //   // ["default"],
    //   [req.query.portalId],
    //   (err, row) => {
    //     if (err) {
    //       console.error(err);

    //       return sendError(res, 500, "Database error");
    //     }

    //     if (!row) {
    //       return sendSuccess(res, "No settings found", {
    //         mappings: {
    //           phoneProperty: "phone",
    //           validationStatusProperty: "veracity_validation_status",
    //           carrierProperty: "veracity_carrier",
    //           validatedAtProperty: "veracity_validated_at",
    //           overwriteExisting: true,
    //           veracityApiKey: "",
    //           rateLimitPerHour: 100,
    //           retentionDays: 30,
    //           failureReasonProperty: "veracity_failure_reason",
    //           normalizedPhoneProperty: "veracity_normalized_phone",
    //           storeNormalizedPhone: false,
    //         },
    //       });
    //     }

    //     if (row?.veracityApiKey) {
    //       row.veracityApiKey = decrypt(row.veracityApiKey);
    //     }

    //     return sendSuccess(res, "Settings fetched successfully", {
    //       mappings: row,
    //     });
    //   },
    // );

    const result = await db.query(
      // `SELECT * FROM mappings WHERE portalId = $1`,

      `
  SELECT
    id,
    portalid AS "portalId",
    phoneproperty AS "phoneProperty",
    validationstatusproperty AS "validationStatusProperty",
    carrierproperty AS "carrierProperty",
    validatedatproperty AS "validatedAtProperty",
    veracityapikey AS "veracityApiKey",
    ratelimitperhour AS "rateLimitPerHour",
    retentiondays AS "retentionDays",
    overwriteexisting AS "overwriteExisting",
    failurereasonproperty AS "failureReasonProperty",
    normalizedphoneproperty AS "normalizedPhoneProperty",
    storenormalizedphone AS "storeNormalizedPhone",
    bulkveracityapikey AS "bulkVeracityApiKey",
bulkratelimitperhour AS "bulkRateLimitPerHour",
bulkretentiondays AS "bulkRetentionDays",
bulkvalidationstatusproperty AS "bulkValidationStatusProperty",

bulkvalidationsummaryproperty AS "bulkValidationSummaryProperty",

bulkvalidatedatproperty AS "bulkValidatedAtProperty" FROM mappings
  WHERE portalid = $1
  `,
      [req.query.portalId],
    );

    const row = result.rows[0];

    const bulkResult = await db.query(
      `
  SELECT
    bulkveracityapikey AS "bulkVeracityApiKey",
    bulkratelimitperhour AS "bulkRateLimitPerHour",
    bulkretentiondays AS "bulkRetentionDays",
    bulkvalidationstatusproperty AS "bulkValidationStatusProperty",
    bulkvalidationsummaryproperty AS "bulkValidationSummaryProperty",
    bulkvalidatedatproperty AS "bulkValidatedAtProperty"
  FROM bulk_mappings
  WHERE portalid = $1
  `,
      [req.query.portalId],
    );

    const bulkRow = bulkResult.rows[0] || {};

    if (!row) {
      return sendSuccess(res, "No settings found", {
        mappings: {
          phoneProperty: "phone",
          validationStatusProperty: "veracity_validation_status",
          carrierProperty: "veracity_carrier",
          validatedAtProperty: "veracity_validated_at",
          overwriteExisting: true,
          veracityApiKey: "",
          rateLimitPerHour: 100,
          retentionDays: 30,
          failureReasonProperty: "veracity_failure_reason",
          normalizedPhoneProperty: "veracity_normalized_phone",
          storeNormalizedPhone: false,
          bulkVeracityApiKey: "",
          bulkRateLimitPerHour: 100,
          bulkRetentionDays: 30,
        },
      });
    }

    if (row?.veracityApiKey) {
      row.veracityApiKey = decrypt(row.veracityApiKey);
    }

    // if (row?.bulkVeracityApiKey) {
    //   row.bulkVeracityApiKey = decrypt(row.bulkVeracityApiKey);
    // }

    if (bulkRow?.bulkVeracityApiKey) {
      bulkRow.bulkVeracityApiKey = decrypt(bulkRow.bulkVeracityApiKey);
    }

    return sendSuccess(res, "Settings fetched successfully", {
      mappings: {
        ...row,
        ...bulkRow,
      },
    });
  } catch (error) {
    console.error(error);

    return sendError(res, 500, "Unable to fetch settings");
  }
});

app.post("/settings", validatePortalAccess, async (req, res) => {
  // console.log(req.body);

  console.log("Settings update request received");

  try {
    const {
      portalId,
      phoneProperty,
      validationStatusProperty,
      carrierProperty,
      validatedAtProperty,
      overwriteExisting,
      veracityApiKey,
      rateLimitPerHour,
      retentionDays,
      failureReasonProperty,
      normalizedPhoneProperty,
      storeNormalizedPhone,
      maxRequestsPerSecond,
      maxConcurrentWorkers,
      bulkVeracityApiKey,
      bulkRateLimitPerHour,
      bulkRetentionDays,
      bulkValidationStatusProperty,
      bulkValidationSummaryProperty,
      bulkValidatedAtProperty,
    } = req.body;

    console.log("BULK/SINGLE SETTINGS BODY:", {
      bulkValidationStatusProperty,
      bulkValidationSummaryProperty,
      bulkValidatedAtProperty,
      validationStatusProperty,
      carrierProperty,
      validatedAtProperty,
    });

    // db.run(
    //   `
    //   INSERT INTO mappings (
    //     portalId,
    //     phoneProperty,
    //     validationStatusProperty,
    //     carrierProperty,
    //     validatedAtProperty,
    //     overwriteExisting,
    //     veracityApiKey,
    //     rateLimitPerHour,
    //     retentionDays,
    //     failureReasonProperty,
    //     normalizedPhoneProperty,
    //     storeNormalizedPhone,
    //     maxRequestsPerSecond,
    //     maxConcurrentWorkers
    //   )
    //   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

    //   ON CONFLICT(portalId)
    //   DO UPDATE SET
    //     phoneProperty = excluded.phoneProperty,
    //     validationStatusProperty =
    //       excluded.validationStatusProperty,
    //     carrierProperty = excluded.carrierProperty,
    //     validatedAtProperty =
    //       excluded.validatedAtProperty,
    //       overwriteExisting = excluded.overwriteExisting,
    //       veracityApiKey =
    //       excluded.veracityApiKey,
    //       rateLimitPerHour =
    //       excluded.rateLimitPerHour,
    //       retentionDays =
    //       excluded.retentionDays,
    //       failureReasonProperty =
    //       excluded.failureReasonProperty,
    //       normalizedPhoneProperty =
    //       excluded.normalizedPhoneProperty,
    //       storeNormalizedPhone =
    //       excluded.storeNormalizedPhone,
    //       maxRequestsPerSecond =
    //       excluded.maxRequestsPerSecond,
    //       maxConcurrentWorkers =
    //       excluded.maxConcurrentWorkers
    //   `,
    //   [
    //     // "default",
    //     portalId,
    //     phoneProperty,
    //     validationStatusProperty,
    //     carrierProperty,
    //     validatedAtProperty,
    //     overwriteExisting === true ? 1 : 0,
    //     // veracityApiKey,
    //     encrypt(veracityApiKey),
    //     rateLimitPerHour,
    //     retentionDays,
    //     failureReasonProperty,
    //     normalizedPhoneProperty,
    //     storeNormalizedPhone === true ? 1 : 0,
    //     maxRequestsPerSecond,
    //     maxConcurrentWorkers,
    //   ],
    //   function (err) {
    //     if (err) {
    //       console.error(err);

    //       return sendError(res, 500, "Failed to save settings");
    //     }

    //     console.log("DB SAVE SUCCESS");
    //     console.log(this.changes);
    //     console.log(this.lastID);

    //     return sendSuccess(res, "Settings saved successfully");
    //   },
    // );

    try {
      await db.query(
        `
    INSERT INTO mappings (
      portalId,
      phoneProperty,
      validationStatusProperty,
      carrierProperty,
      validatedAtProperty,
      overwriteExisting,
      veracityApiKey,
      rateLimitPerHour,
      retentionDays,
      failureReasonProperty,
      normalizedPhoneProperty,
      storeNormalizedPhone,
      maxRequestsPerSecond,
      maxConcurrentWorkers,
      bulkVeracityApiKey,
bulkRateLimitPerHour,
bulkRetentionDays,
bulkValidationStatusProperty,
bulkValidationSummaryProperty,
bulkValidatedAtProperty
    )
    VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
    )

    ON CONFLICT (portalid)
    DO UPDATE SET
      phoneProperty = EXCLUDED.phoneProperty,
      validationStatusProperty =
        EXCLUDED.validationStatusProperty,
      carrierProperty = EXCLUDED.carrierProperty,
      validatedAtProperty =
        EXCLUDED.validatedAtProperty,
      overwriteExisting =
        EXCLUDED.overwriteExisting,
      veracityApiKey =
        EXCLUDED.veracityApiKey,
      rateLimitPerHour =
        EXCLUDED.rateLimitPerHour,
      retentionDays =
        EXCLUDED.retentionDays,
      failureReasonProperty =
        EXCLUDED.failureReasonProperty,
      normalizedPhoneProperty =
        EXCLUDED.normalizedPhoneProperty,
      storeNormalizedPhone =
        EXCLUDED.storeNormalizedPhone,
      maxRequestsPerSecond =
        EXCLUDED.maxRequestsPerSecond,
      maxConcurrentWorkers =
        EXCLUDED.maxConcurrentWorkers,
        bulkVeracityApiKey =
  EXCLUDED.bulkVeracityApiKey,
bulkRateLimitPerHour =
  EXCLUDED.bulkRateLimitPerHour,
bulkRetentionDays =
  EXCLUDED.bulkRetentionDays,
  bulkValidationStatusProperty =
 EXCLUDED.bulkValidationStatusProperty,
bulkValidationSummaryProperty =
 EXCLUDED.bulkValidationSummaryProperty,
bulkValidatedAtProperty =
 EXCLUDED.bulkValidatedAtProperty
    `,
        [
          portalId,
          phoneProperty,
          validationStatusProperty,
          carrierProperty,
          validatedAtProperty,

          overwriteExisting === true,

          encrypt(veracityApiKey),

          rateLimitPerHour,
          retentionDays,

          failureReasonProperty,
          normalizedPhoneProperty,

          storeNormalizedPhone === true,

          maxRequestsPerSecond,
          maxConcurrentWorkers,
          encrypt(bulkVeracityApiKey),

          bulkRateLimitPerHour,

          bulkRetentionDays,
          bulkValidationStatusProperty,
          bulkValidationSummaryProperty,
          bulkValidatedAtProperty,
        ],
      );

      await db.query(
        `
  INSERT INTO bulk_mappings (
    portalid,
    bulkveracityapikey,
    bulkratelimitperhour,
    bulkretentiondays,
    bulkvalidationstatusproperty,
    bulkvalidationsummaryproperty,
    bulkvalidatedatproperty
  )
  VALUES (
    $1, $2, $3, $4, $5, $6, $7
  )

  ON CONFLICT (portalid)
  DO UPDATE SET
    bulkveracityapikey = EXCLUDED.bulkveracityapikey,
    bulkratelimitperhour = EXCLUDED.bulkratelimitperhour,
    bulkretentiondays = EXCLUDED.bulkretentiondays,
    bulkvalidationstatusproperty = EXCLUDED.bulkvalidationstatusproperty,
    bulkvalidationsummaryproperty = EXCLUDED.bulkvalidationsummaryproperty,
    bulkvalidatedatproperty = EXCLUDED.bulkvalidatedatproperty
  `,
        [
          portalId,
          encrypt(bulkVeracityApiKey),
          bulkRateLimitPerHour,
          bulkRetentionDays,
          bulkValidationStatusProperty,
          bulkValidationSummaryProperty,
          bulkValidatedAtProperty,
        ],
      );

      console.log("DB SAVE SUCCESS");

      return sendSuccess(res, "Settings saved successfully");
    } catch (err) {
      console.error(err);

      return sendError(res, 500, "Failed to save settings");
    }
  } catch (error) {
    console.error(error);

    return sendError(res, 500, "Unable to save settings");
  }
});

app.get("/hubspot-lists", async (req, res) => {
  try {
    console.log("Fetching HubSpot lists...");

    const portalId = req.query.portalId;

    const accessToken = await getAccessToken(portalId);

    // const response = await fetch("https://api.hubapi.com/contacts/v1/lists", {
    const response = await fetch(
      "https://api.hubapi.com/crm/v3/lists?count=100",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    console.log("HUBSPOT RAW LISTS", response.data);

    // const data = await response.json();

    // console.log("ACTUAL HUBSPOT DATA:", data);

    // const lists = data.results || [];

    // if (!response.ok) {
    //   const errorText = await response.text();

    //   console.error("Failed to fetch lists:", errorText);

    //   return sendError(res, 500, "Failed to fetch HubSpot lists");
    // }

    const rawText = await response.text();

    console.log("RAW HUBSPOT RESPONSE:", rawText);

    const data = rawText ? JSON.parse(rawText) : {};

    if (!response.ok) {
      console.error("Failed to fetch lists:", data);

      return sendError(res, 500, "Failed to fetch HubSpot lists");
    }

    const lists = data.results || [];

    // const data = await response.json();

    // console.log("LIST RESPONSE:", data);

    console.log("HubSpot lists fetched successfully");

    // console.log("FULL LIST OBJECT:", data.results?.[0]);

    // console.log(
    //   "FULL HUBSPOT RESPONSE:",
    //   JSON.stringify(response.data, null, 2),
    // );

    console.log("ACTUAL HUBSPOT DATA:", JSON.stringify(data, null, 2));

    // const lists = data.lists || [];

    // const lists = data.results || [];

    // const lists = data.lists || data.results || [];

    // console.log("RAW HUBSPOT LISTS:", JSON.stringify(lists, null, 2));

    const formattedLists = lists.map((list) => {
      console.log("LIST IDS:", {
        listId: list.listId,
        objectId: list.objectId,
        id: list.id,
      });

      return {
        label: `${list.name} (${list.metaData?.size || 0})`,
        // value: String(list.listId),
        value: String(list.listId || list.id),
      };
    });

    // console.log("FORMATTED LISTS:", formattedLists);

    return sendSuccess(res, "Lists fetched successfully", {
      lists: formattedLists,
    });
  } catch (error) {
    console.error("List fetch error:", error.message);

    return sendError(res, 500, "Unable to fetch lists");
  }
});

app.get("/batch-job/:id", async (req, res) => {
  // db.get(
  //   `
  //   SELECT *
  //   FROM batch_jobs
  //   WHERE id = ?
  // `,
  //   [req.params.id],
  //   (err, row) => {
  //     if (err) {
  //       return sendError(res, 500, "Failed to fetch batch job");
  //     }

  //     return sendSuccess(res, "Batch job fetched", row);
  //   },
  // );

  try {
    const result = await db.query(
      `
    SELECT *
    FROM batch_jobs
    WHERE id = $1
    `,
      [req.params.id],
    );

    const row = result.rows[0];

    return sendSuccess(res, "Batch job fetched", row);
  } catch (error) {
    console.error(error);

    return sendError(res, 500, "Failed to fetch batch job");
  }
});

app.get("/metrics", (req, res) => {
  res.json({
    totalCalls: metrics.totalCalls,

    successCount: metrics.successCount,

    failureCount: metrics.failureCount,

    averageLatency: getAverageLatency(),
  });
});

if (process.env.NODE_ENV !== "test") {
  cleanupOldLogs();

  setInterval(
    () => {
      console.log("Running scheduled cleanup...");

      cleanupOldLogs();
    },
    60 * 60 * 1000,
  );
}

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = { app, normalizePhone };
