// packages/rule-api/src/defineBridge.ts
import type { BridgeFunctionDefinition } from "./types.js";

/** Helper for authoring custom lint functions with type inference. */
export function defineBridgeFunction<Input = unknown, Options = unknown>(
  def: BridgeFunctionDefinition<Input, Options>
): BridgeFunctionDefinition<Input, Options> {
  return def;
}
