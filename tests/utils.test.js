const {
  normalizePhone,
} = require("../index");

describe("normalizePhone", () => {
  test("should add India country code", () => {
    expect(
      normalizePhone("9876543210")
    ).toBe("+919876543210");
  });

  test("should keep existing country code", () => {
    expect(
      normalizePhone("+14155552671")
    ).toBe("+14155552671");
  });

  test("should remove spaces/dashes", () => {
    expect(
      normalizePhone("(987) 654-3210")
    ).toBe("+919876543210");
  });
});