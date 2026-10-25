import { z } from "zod";

function withoutDefault(schema: z.core.$ZodType): z.core.$ZodType {
  if (schema instanceof z.ZodDefault || schema instanceof z.ZodPrefault || schema instanceof z.ZodOptional) {
    return withoutDefault(schema.unwrap());
  }
  return schema;
}

/**
 * PATCH schemas must not populate defaults for omitted fields. Zod 4's
 * `.partial()` applies inner defaults, unlike Zod 3.
 */
export function partialWithoutDefaults<
  Shape extends z.ZodRawShape,
  Config extends z.core.$ZodObjectConfig,
>(schema: z.ZodObject<Shape, Config>) {
  type PartialShape = {
    [Key in keyof Shape]: z.ZodOptional<Shape[Key]>;
  };
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      z.optional(withoutDefault(field)),
    ]),
  ) as PartialShape;
  return schema.extend(shape);
}
