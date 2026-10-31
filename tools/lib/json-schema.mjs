// A small JSON Schema (2020-12) checker for the keywords schema/*.schema.json use, and no more.
// `unsupportedKeywords` lists any other keyword, so a schema that grows past this checker fails its test
// instead of being half-checked.

const ANNOTATIONS = new Set(["$schema", "$id", "$comment", "title", "description", "examples", "default", "format"]);
const KEYWORDS = new Set([
  "type", "enum", "const", "pattern", "minLength", "minimum", "items", "minItems", "uniqueItems",
  "required", "properties", "additionalProperties", "propertyNames", "minProperties", "$ref", "$defs", "if", "then",
]);
const SCHEMA_MAPS = new Set(["properties", "$defs"]);
const SCHEMAS = new Set(["items", "additionalProperties", "propertyNames", "if", "then"]);

/** Paths (as "properties.a.contains") of keywords this checker does not implement. */
export function unsupportedKeywords(schema, at = "") {
  if (schema === true || schema === false) return [];
  const found = [];
  for (const [key, value] of Object.entries(schema)) {
    const here = at ? `${at}.${key}` : key;
    if (ANNOTATIONS.has(key)) continue;
    if (!KEYWORDS.has(key)) { found.push(here); continue; }
    if (SCHEMA_MAPS.has(key)) {
      for (const [name, sub] of Object.entries(value)) found.push(...unsupportedKeywords(sub, `${here}.${name}`));
    } else if (SCHEMAS.has(key) && typeof value === "object") {
      found.push(...unsupportedKeywords(value, here));
    }
  }
  return found;
}

/** The value's JSON type, with "integer" for whole numbers the app can hold in an Int. */
function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) && value >= -(2 ** 63) && value < 2 ** 63 ? "integer" : "number";
  return typeof value; // string, boolean, object
}

function hasType(value, type) {
  const actual = typeOf(value);
  return actual === type || (type === "number" && actual === "integer");
}

const describe = (value) => {
  const type = typeOf(value);
  return type === "integer" ? "a number" : type === "array" ? "an array" : type === "object" ? "an object" : type === "null" ? "null" : `a ${type}`;
};

const join = (parent, key) => (typeof key === "number" ? `${parent}[${key}]` : parent ? `${parent}.${key}` : key);

function equal(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]));
}

function resolve(root, ref) {
  if (!ref.startsWith("#/")) throw new Error(`only local $ref is supported: ${ref}`);
  return ref.slice(2).split("/").reduce((node, part) => node?.[part.replaceAll("~1", "/").replaceAll("~0", "~")], root);
}

/**
 * Checks `value` against `schema`. Returns one entry per problem: { field, keyword, message, expected? }, where
 * `field` is written as the app writes it ("contributes.actions[0].hint"; "" for the value itself).
 */
export function checkSchema(schema, value) {
  const errors = [];
  check(schema, value, "", schema, errors);
  return errors;
}

function check(schema, value, field, root, errors) {
  if (schema === true) return;
  if (schema === false) { errors.push({ field, keyword: "false", message: "is not allowed here" }); return; }
  const fail = (keyword, message, expected) => errors.push(expected === undefined ? { field, keyword, message } : { field, keyword, message, expected });

  if (schema.$ref) check(resolve(root, schema.$ref), value, field, root, errors);

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => hasType(value, type))) {
      const wanted = types.map((type) => (type === "integer" ? "a whole number" : type === "array" ? "an array" : type === "object" ? "an object"
        : type === "null" ? "null" : type === "boolean" ? "true or false" : `a ${type}`)).join(" or ");
      fail("type", `must be ${wanted}, not ${describe(value)}`, wanted);
      return;
    }
  }
  if (schema.const !== undefined && !equal(value, schema.const)) fail("const", `must be ${JSON.stringify(schema.const)}`, JSON.stringify(schema.const));
  if (schema.enum !== undefined && !schema.enum.some((option) => equal(value, option))) {
    fail("enum", `${JSON.stringify(value)} is not one of the allowed values`, schema.enum.map((option) => JSON.stringify(option)).join(", "));
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) {
      fail("minLength", schema.minLength === 1 ? "must not be empty" : `must be at least ${schema.minLength} characters`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) {
      fail("pattern", `${JSON.stringify(value)} does not have the expected form`, `a match for ${schema.pattern}`);
    }
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    fail("minimum", `must be at least ${schema.minimum}`, `${schema.minimum} or more`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      fail("minItems", schema.minItems === 1 ? "must not be empty" : `must have at least ${schema.minItems} entries`);
    }
    if (schema.uniqueItems && value.some((item, index) => value.findIndex((other) => equal(other, item)) !== index)) {
      fail("uniqueItems", "has the same entry twice");
    }
    if (schema.items !== undefined) value.forEach((item, index) => check(schema.items, item, join(field, index), root, errors));
  }

  if (typeOf(value) === "object") {
    for (const name of schema.required ?? []) {
      if (!Object.hasOwn(value, name)) errors.push({ field: join(field, name), keyword: "required", message: `"${name}" is missing` });
    }
    for (const [name, child] of Object.entries(value)) {
      if (schema.propertyNames !== undefined) {
        const before = errors.length;
        check(schema.propertyNames, name, join(field, name), root, errors);
        if (errors.length > before) continue;
      }
      if (schema.properties && Object.hasOwn(schema.properties, name)) check(schema.properties[name], child, join(field, name), root, errors);
      else if (schema.additionalProperties === false) {
        errors.push({ field: join(field, name), keyword: "additionalProperties", message: `"${name}" is not a field here` });
      } else if (schema.additionalProperties !== undefined) check(schema.additionalProperties, child, join(field, name), root, errors);
    }
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
      fail("minProperties", schema.minProperties === 1 ? "must not be empty" : `must have at least ${schema.minProperties} fields`);
    }
  }

  if (schema.if !== undefined && schema.then !== undefined && checkSchema.quiet(schema.if, value, root)) {
    check(schema.then, value, field, root, errors);
  }
}

/** Whether `value` passes `schema` (for "if"). */
checkSchema.quiet = (schema, value, root) => {
  const errors = [];
  check(schema, value, "", root, errors);
  return errors.length === 0;
};
