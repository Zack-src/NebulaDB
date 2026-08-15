import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toSnakeCase, toCamelCase, toPascalCase, toKebabCase, toTitleCase } from "./case";

describe("String Case Utilities", () => {
  it("toSnakeCase converts identifiers properly", () => {
    assert.equal(toSnakeCase("userProfileDetails"), "user_profile_details");
    assert.equal(toSnakeCase("User_Order"), "user_order");
    assert.equal(toSnakeCase("order-item-id"), "order_item_id");
    assert.equal(toSnakeCase("CustomerID"), "customer_id");
  });

  it("toCamelCase converts snake, kebab, and spaced strings", () => {
    assert.equal(toCamelCase("user_profile_details"), "userProfileDetails");
    assert.equal(toCamelCase("order-item-id"), "orderItemId");
    assert.equal(toCamelCase("customer id"), "customerId");
  });

  it("toPascalCase capitalizes the first letter of camelCase", () => {
    assert.equal(toPascalCase("user_profile_details"), "UserProfileDetails");
    assert.equal(toPascalCase("order-item-id"), "OrderItemId");
    assert.equal(toPascalCase("customer"), "Customer");
  });

  it("toKebabCase converts to dash-separated format", () => {
    assert.equal(toKebabCase("userProfileDetails"), "user-profile-details");
    assert.equal(toKebabCase("User_Order"), "user-order");
  });

  it("toTitleCase converts to readable capitalized words", () => {
    assert.equal(toTitleCase("user_profile_details"), "User Profile Details");
    assert.equal(toTitleCase("order-item-id"), "Order Item Id");
  });
});
