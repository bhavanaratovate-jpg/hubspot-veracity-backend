const request = require("supertest");

const fetchMock = require("jest-fetch-mock");

fetchMock.enableMocks();

const { app } = require("../index");

describe("Integration Tests", () => {
  test("GET / should return server status", async () => {
    const response = await request(app).get("/");

    expect(response.statusCode).toBe(200);

    expect(response.text).toContain("Server is running");
  });

  test("POST /validate-phone without contactId", async () => {
    const response = await request(app).post("/validate-phone").send({});

    expect(response.statusCode).toBe(400);

    expect(response.body.success).toBe(false);

    expect(response.body.message).toBe("contactId is required");
  });

  test("should mock Veracity API response", async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        success: true,
        data: {
          carrier_name: "Verizon",
          carrier_type: "mobile",
          line_status: "active",
          veracity_risk_score: "low",
        },
      }),
    );
    const response = await fetch(
      "https://api.veracityhub.io/v2/verify/carrier",
    );
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.carrier_name).toBe("Verizon");
  });
});
